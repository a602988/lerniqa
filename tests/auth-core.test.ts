import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    createSessionToken,
    hashAccountPassword,
    hashSessionToken,
    verifyAccountPassword,
} from "../app/lib/auth-crypto.ts";
import {
    ACCOUNT_PASSWORD_MAX_LENGTH,
    ACCOUNT_PASSWORD_MIN_LENGTH,
    ACCOUNT_ROLES,
    AuthInputError,
    isCredentialRequestTransportAllowed,
    normalizeAccountEmail,
    parseCreateAccountLearnerInput,
    parseLoginAccountInput,
    parseRegisterAccountInput,
    parseSwitchAccountRoleInput,
    parseUpdateAccountLearnerInput,
    parseUpdateLearnerSubjectSettingInput,
    validateAccountPassword,
    validateNewAccountPassword,
} from "../app/lib/auth-input.ts";

const authServiceSource = await readFile(
    new URL("../app/lib/auth-service.ts", import.meta.url),
    "utf8",
);
const authSharedSource = await readFile(
    new URL("../app/api/v1/auth/_shared.ts", import.meta.url),
    "utf8",
);
const authRoleRouteSource = await readFile(
    new URL("../app/api/v1/auth/role/route.ts", import.meta.url),
    "utf8",
);
const authIdentityRouteSource = await readFile(
    new URL("../app/api/v1/auth/identity/route.ts", import.meta.url),
    "utf8",
);
const authLearnersRouteSource = await readFile(
    new URL("../app/api/v1/auth/learners/route.ts", import.meta.url),
    "utf8",
);
const learnerSubjectSettingsRouteSource = await readFile(
    new URL("../app/api/v1/auth/learners/subject-settings/route.ts", import.meta.url),
    "utf8",
);

function assertAuthInputError(action: () => unknown, expectedCode: string): void {
    assert.throws(action, (error: unknown) => {
        assert.ok(error instanceof AuthInputError);
        assert.equal(error.code, expectedCode);
        assert.equal(error.status, 400);
        return true;
    });
}

test("uses one account reader for newly issued and restored sessions", () => {
    const readerSource = authServiceSource.match(
        /const AUTH_ACCOUNT_SELECT[\s\S]*?export function sessionTokenFromRequest/u,
    )?.[0];

    assert.ok(readerSource, "shared account reader should remain present");
    assert.match(readerSource, /async function readSessionAccount/u);
    assert.match(readerSource, /return readSessionAccount\(client, "id", sessionId\)/u);
    assert.match(authServiceSource, /readSessionAccount\(client, "token_hash", tokenHash\)/u);
    assert.match(readerSource, /readAccessibleLearners\(client, row\.user_id\)/u);
    assert.match(readerSource, /access\.accepted_at IS NOT NULL/u);
    assert.match(readerSource, /access\.revoked_at IS NULL/u);
    assert.match(readerSource, /learner\.status = 'active'/u);
});

test("grants every registration an active learner role without replacing the selected role", () => {
    const registrationSource = authServiceSource.match(
        /export async function registerAccount[\s\S]*?export async function loginAccount/u,
    )?.[0];

    assert.ok(registrationSource, "registerAccount source should remain present");
    assert.match(
        registrationSource,
        /const grantedRoles:[\s\S]*?input\.role === "learner"[\s\S]*?\["learner"\][\s\S]*?\["learner", input\.role\]/u,
    );
    assert.match(registrationSource, /SELECT lerniqa_lock_auth_user\(\$1::uuid\)/u);
    assert.match(registrationSource, /for \(const role of grantedRoles\)[\s\S]*?INSERT INTO user_roles/u);
    assert.match(
        registrationSource,
        /issueSession\(client, \{ userId, role: input\.role, learnerId \}\)/u,
    );
    assert.match(registrationSource, /INSERT INTO users \(id, display_name, account_role, status\)/u);
    assert.match(registrationSource, /input\.role === "learner"\s+\? input\.displayName\s+: input\.learnerName/u);
});

test("selects login role deterministically from learner access without coupling session validity", () => {
    const loginSource = authServiceSource.match(
        /export async function loginAccount[\s\S]*?export async function logoutAccount/u,
    )?.[0];

    assert.ok(loginSource, "loginAccount source should remain present");
    assert.match(loginSource, /return withLocalPostgresTransaction/u);
    assert.match(loginSource, /SELECT lerniqa_lock_auth_user\(\$1::uuid\)/u);
    assert.match(loginSource, /CASE WHEN role\.role = app_user\.account_role THEN 0 ELSE 1 END/u);
    assert.match(loginSource, /CASE WHEN access\.access_role = app_user\.account_role THEN 0 ELSE 1 END/u);
    assert.match(loginSource, /CASE WHEN role\.role = access\.access_role THEN 0 ELSE 1 END/u);
    assert.doesNotMatch(
        loginSource,
        /JOIN learner_access AS access[\s\S]*?ON[\s\S]*?AND\s+(?:access\.access_role\s*=\s*role\.role|role\.role\s*=\s*access\.access_role)/u,
    );
});

test("attaches only the approved system-owned Hanlin question bank", () => {
    const attachFunction = authServiceSource.match(
        /async function attachHanlinQuestionBanks[\s\S]*?\n\}\n\nasync function lockAuthenticatedSession/u,
    )?.[0];

    assert.ok(attachFunction, "attachHanlinQuestionBanks should remain present");
    assert.match(
        authServiceSource,
        /const HANLIN_SYSTEM_QUESTION_BANK_ID = "af207056-08e6-554a-a405-ab6f8440d6ce";/u,
    );
    assert.match(attachFunction, /bank\.id = \$2::uuid/u);
    assert.match(attachFunction, /bank\.origin = 'system'/u);
    assert.match(attachFunction, /bank\.owner_user_id IS NULL/u);
    assert.match(attachFunction, /bank\.status = 'active'/u);
    assert.match(attachFunction, /\[learnerId, HANLIN_SYSTEM_QUESTION_BANK_ID\]/u);
    assert.doesNotMatch(attachFunction, /bank\.name/u);
    assert.doesNotMatch(attachFunction, /question_bank_items|publishers/u);
});

test("loads all active accepted learners with profiles and stable relationship metadata", () => {
    const learnerReader = authServiceSource.match(
        /async function readAccessibleLearners[\s\S]*?async function readSessionAccount/u,
    )?.[0];

    assert.ok(learnerReader, "accessible learner reader should remain present");
    assert.match(learnerReader, /LEFT JOIN learner_preferences AS preference ON preference\.learner_id = learner\.id/u);
    assert.match(learnerReader, /WHEN preference\.learner_id IS NULL THEN NULL/u);
    assert.match(learnerReader, /WHERE setting\.learner_id = learner\.id\s+AND setting\.enabled = true/u);
    assert.match(learnerReader, /'lockVersion', setting\.lock_version/u);
    assert.match(learnerReader, /'availableBookVersions'/u);
    assert.match(learnerReader, /available_book\.grade_id IS NULL\s+OR available_book\.grade_id = learner\.grade_id/u);
    assert.match(learnerReader, /available_book\.origin = 'system'\s+OR available_book\.owner_user_id = \$1/u);
    assert.match(learnerReader, /bool_or\(access\.can_manage_settings\) AS can_manage_settings/u);
    assert.match(learnerReader, /bool_or\(access\.access_role = 'learner'\) AS is_self/u);
    assert.match(learnerReader, /ORDER BY effective_access\.first_accepted_at, learner\.created_at, learner\.id/u);
});

test("loads a stable self-service role list without exposing system_admin", () => {
    const accountProjection = authServiceSource.match(
        /const AUTH_ACCOUNT_SELECT[\s\S]*?async function readAccessibleLearners/u,
    )?.[0];
    const roleProjection = /ARRAY\(\s+SELECT granted_role\.role[\s\S]*?\) AS roles,/u;

    assert.ok(accountProjection, "account projection should remain present");
    const roles = accountProjection.match(roleProjection)?.[0];
    assert.ok(roles, "account projection should load granted roles");
    assert.match(roles, /role IN \('parent', 'learner', 'tutor'\)/u);
    assert.match(roles, /granted_role\.revoked_at IS NULL/u);
    assert.match(roles, /WHEN 'parent' THEN 1[\s\S]*?WHEN 'learner' THEN 2[\s\S]*?WHEN 'tutor' THEN 3/u);
    assert.doesNotMatch(roles, /system_admin/u);
});

test("publishes only the learner profile display contract", () => {
    const publicContractSource = authSharedSource.match(
        /export interface PublicLearnerProfile[\s\S]*?export function publicAccount/u,
    )?.[0];
    const publicAccountSource = authSharedSource.match(
        /function publicLearnerProfile[\s\S]*?export function authenticatedResponse/u,
    )?.[0];

    assert.ok(publicContractSource, "public learner profile contract should remain present");
    assert.ok(publicAccountSource, "publicAccount should remain present");
    assert.match(publicContractSource, /learner:\s*PublicLearnerProfile/u);
    assert.match(publicContractSource, /learners:\s*PublicLearnerProfile\[\]/u);
    assert.match(publicContractSource, /accountRole:\s*AuthenticatedAccount\["accountRole"\]/u);
    assert.match(publicContractSource, /roles:\s*AuthenticatedAccount\["roles"\]/u);
    assert.match(publicAccountSource, /const managedLearnerMode = account\.activeRole === "learner"/u);
    assert.match(publicAccountSource, /const learnerScopedMode = account\.activeRole === "learner"/u);
    assert.match(publicAccountSource, /email: managedLearnerMode \? null : account\.email/u);
    assert.match(publicAccountSource, /emailVerified: managedLearnerMode \? null : account\.emailVerified/u);
    assert.match(publicAccountSource, /learners: learnerScopedMode[\s\S]*?\? \[currentLearner\][\s\S]*?: account\.learners\.map\(publicLearnerProfile\)/u);
    for (const field of [
        "gradeCode",
        "gradeName",
        "semesterCode",
        "semesterName",
        "questionLimitOptions",
        "defaultQuestionLimit",
        "defaultCheckMode",
        "subjectSettings",
        "lockVersion",
        "availableBookVersions",
        "bookVersion",
        "publisher",
        "accessRole",
        "canManageSettings",
        "isSelf",
    ]) {
        assert.match(publicAccountSource, new RegExp(`\\b${field}\\b`, "u"));
    }
    assert.doesNotMatch(publicAccountSource, /\b(?:school|avatar|asset|sessionId|userId)\b/u);
});

test("sets a host-only no-store session cookie for both login and logout", () => {
    const secureCookieSource = authServiceSource.match(
        /export function secureCookieForRequest[\s\S]*?export async function getAuthenticatedAccount/u,
    )?.[0];
    const authenticatedResponseSource = authSharedSource.match(
        /export function authenticatedResponse[\s\S]*?export function clearSessionCookie/u,
    )?.[0];
    const clearCookieSource = authSharedSource.match(
        /export function clearSessionCookie[\s\S]*?\n\}/u,
    )?.[0];

    assert.ok(secureCookieSource, "secure cookie decision should remain present");
    assert.ok(authenticatedResponseSource, "login cookie response should remain present");
    assert.ok(clearCookieSource, "logout cookie response should remain present");
    assert.match(secureCookieSource, /new URL\(request\.url\)\.protocol === "https:"/u);
    for (const source of [authenticatedResponseSource, clearCookieSource]) {
        assert.match(source, /httpOnly:\s*true/u);
        assert.match(source, /sameSite:\s*"lax"/u);
        assert.match(source, /secure:\s*secureCookieForRequest\(request\)/u);
        assert.match(source, /path:\s*"\/"/u);
        assert.doesNotMatch(source, /domain:/u);
    }
    assert.match(authenticatedResponseSource, /maxAge:\s*AUTH_SESSION_MAX_AGE_SECONDS/u);
    assert.match(clearCookieSource, /value:\s*""/u);
    assert.match(clearCookieSource, /maxAge:\s*0/u);
});

test("switches only the current locked session to an already granted role", () => {
    const roleSwitchSource = authServiceSource.match(
        /export async function switchAccountRole[\s\S]*?export async function updateAccountIdentity/u,
    )?.[0];

    assert.ok(roleSwitchSource, "switchAccountRole should remain present");
    assert.match(roleSwitchSource, /return withLocalPostgresTransaction/u);
    assert.match(roleSwitchSource, /lockAuthenticatedSession\(client, tokenHash\)/u);
    assert.match(roleSwitchSource, /role\.role = \$2/u);
    assert.match(roleSwitchSource, /role\.revoked_at IS NULL/u);
    assert.match(roleSwitchSource, /input\.targetRole !== "learner"[\s\S]*?requireAccountPassword/u);
    assert.match(roleSwitchSource, /if \(session\.active_role !== input\.targetRole\)/u);
    assert.match(roleSwitchSource, /UPDATE auth_sessions\s+SET active_role = \$1\s+WHERE id = \$2/u);
    assert.doesNotMatch(roleSwitchSource, /INSERT INTO user_roles|UPDATE learner_access|issueSession|createSessionToken/u);
});

test("role switch route validates transport and returns only the public no-store account", () => {
    assert.match(authRoleRouteSource, /export async function PATCH/u);
    assert.match(authRoleRouteSource, /requireSafeCredentialTransport\(request\)/u);
    assert.match(authRoleRouteSource, /parseSwitchAccountRoleInput\(await readJsonBody\(request\)\)/u);
    assert.match(authRoleRouteSource, /switchAccountRole\(request, input\)/u);
    assert.match(authRoleRouteSource, /accountResponse\(account\)/u);
    assert.doesNotMatch(authRoleRouteSource, /password|password_hash|sessionId|userId|token/u);
});

test("identity change self-grants only an ordinary target role and provisions one self learner", () => {
    const identitySource = authServiceSource.match(
        /export async function updateAccountIdentity[\s\S]*?export async function createAccountLearner/u,
    )?.[0];
    assert.ok(identitySource, "identity service should remain present");
    assert.match(identitySource, /lockAuthenticatedSession\(client, tokenHash\)/u);
    assert.match(identitySource, /session\.active_role === "learner"/u);
    assert.match(identitySource, /session\.account_role === "parent" \|\| session\.account_role === "tutor"/u);
    assert.match(identitySource, /ACCOUNT_SETTINGS_FORBIDDEN/u);
    assert.match(identitySource, /requireAccountPassword/u);
    assert.match(identitySource, /INSERT INTO user_roles/u);
    assert.match(identitySource, /SELECT \$1, \$2, \$3::varchar\(30\), 'user', \$2/u);
    assert.match(identitySource, /role\.role = \$3::varchar\(30\)\s+AND role\.revoked_at IS NULL/u);
    assert.match(identitySource, /access\.access_role = 'learner'/u);
    assert.match(identitySource, /display_name = \$1/u);
    assert.match(identitySource, /can_manage_settings = true/u);
    assert.match(identitySource, /UPDATE users\s+SET account_role = \$1/u);
    assert.match(identitySource, /UPDATE auth_sessions\s+SET active_role = \$1, active_learner_id = \$2/u);
    assert.doesNotMatch(identitySource, /system_admin/u);

    assert.match(authIdentityRouteSource, /export async function PATCH/u);
    assert.match(authIdentityRouteSource, /requireSafeCredentialTransport\(request\)/u);
    assert.match(authIdentityRouteSource, /parseSwitchAccountRoleInput/u);
    assert.match(authIdentityRouteSource, /updateAccountIdentity\(request, input\)/u);
    assert.match(authIdentityRouteSource, /accountResponse\(account\)/u);
});

test("learner settings API enforces mode guards, idempotency, ownership, and reconciliation", () => {
    const createSource = authServiceSource.match(
        /export async function createAccountLearner[\s\S]*?export async function updateAccountLearner/u,
    )?.[0];
    const updateSource = authServiceSource.match(
        /export async function updateAccountLearner[\s\S]*$/u,
    )?.[0];
    const reconcileSource = authServiceSource.match(
        /async function reconcileSubjectSettings[\s\S]*?async function createLearnerForAccount/u,
    )?.[0];
    assert.ok(createSource && updateSource && reconcileSource);

    assert.match(createSource, /lockAuthenticatedSession\(client, tokenHash\)/u);
    assert.match(createSource, /learnerSettingsMode\(session\)/u);
    assert.match(authServiceSource, /session\.active_role === "parent" \|\| session\.active_role === "tutor"/u);
    assert.match(createSource, /const accessRole = session\.active_role/u);
    assert.match(createSource, /input\.clientRequestId/u);
    assert.match(createSource, /existing\.owned/u);
    assert.match(createSource, /LEARNER_REQUEST_CONFLICT/u);
    assert.match(createSource, /UPDATE auth_sessions\s+SET active_learner_id = \$1/u);
    assert.match(updateSource, /requireSelfLearnerMode/u);
    assert.match(updateSource, /input\.action === "update-current"/u);
    assert.match(updateSource, /session\.active_role !== "learner"/u);
    assert.match(updateSource, /input\.learnerId !== session\.learner_id/u);
    assert.match(updateSource, /input\.action === "update" && mode !== "managed"/u);
    assert.match(updateSource, /access\.can_manage_settings = true/u);
    assert.match(updateSource, /\$4::text <> 'self'[\s\S]*?access\.access_role = 'learner'/u);
    assert.match(updateSource, /authorization\.is_self/u);
    assert.match(updateSource, /UPDATE users[\s\S]*?display_name = \$1/u);
    assert.match(updateSource, /reconcileSubjectSettings/u);
    assert.match(reconcileSource, /subject\.origin = 'system'/u);
    assert.match(reconcileSource, /enabled = false/u);
    assert.match(reconcileSource, /enabled = true/u);
    assert.match(reconcileSource, /existing_book\.grade_id = \$7/u);
    assert.match(reconcileSource, /existing_book\.origin = 'system'[\s\S]*?existing_book\.owner_user_id = \$8/u);

    assert.match(authLearnersRouteSource, /export async function POST/u);
    assert.match(authLearnersRouteSource, /export async function PATCH/u);
    assert.equal((authLearnersRouteSource.match(/requireSafeCredentialTransport\(request\)/gu) ?? []).length, 2);
    assert.match(authLearnersRouteSource, /parseCreateAccountLearnerInput/u);
    assert.match(authLearnersRouteSource, /parseUpdateAccountLearnerInput/u);
    assert.match(authLearnersRouteSource, /accountResponse\(account, 201\)/u);
});

test("hashes account passwords with a fresh scrypt salt and verifies only the matching password", async () => {
    const password = "correct horse battery staple";
    const first = await hashAccountPassword(password);
    const second = await hashAccountPassword(password);

    assert.match(first, /^scrypt\$v1\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u);
    assert.notEqual(first, second);
    assert.equal(first.includes(password), false);
    assert.equal(await verifyAccountPassword(password, first), true);
    assert.equal(await verifyAccountPassword("wrong password value", first), false);
});

test("rejects malformed or unsupported password hashes without throwing", async () => {
    const encoded = await hashAccountPassword("another safe password");
    const parts = encoded.split("$");

    assert.equal(await verifyAccountPassword("another safe password", "not-a-password-hash"), false);
    assert.equal(await verifyAccountPassword("another safe password", encoded.replace("$v1$", "$v2$")), false);
    assert.equal(await verifyAccountPassword("another safe password", encoded.replace("$32768$", "$65536$")), false);
    assert.equal(await verifyAccountPassword("another safe password", [...parts.slice(0, 5), "AA", parts[6]].join("$")), false);
    assert.equal(await verifyAccountPassword("another safe password", [...parts.slice(0, 6), "AA"].join("$")), false);
});

test("creates opaque session tokens and hashes them deterministically", () => {
    const first = createSessionToken();
    const second = createSessionToken();

    assert.match(first, /^[A-Za-z0-9_-]{43}$/u);
    assert.notEqual(first, second);
    assert.match(hashSessionToken(first), /^sha256:v1:[a-f0-9]{64}$/u);
    assert.equal(hashSessionToken(first), hashSessionToken(first));
    assert.notEqual(hashSessionToken(first), hashSessionToken(second));
});

test("normalizes account emails and rejects malformed values", () => {
    assert.equal(normalizeAccountEmail("  LEARNER@EXAMPLE.INVALID  "), "learner@example.invalid");
    assert.equal(normalizeAccountEmail("ＵＳＥＲ＠ＥＸＡＭＰＬＥ．ＩＮＶＡＬＩＤ"), "user@example.invalid");

    for (const value of [null, 42, "learner@example", "learner @example.invalid", "learner@@example.invalid"]) {
        assertAuthInputError(() => normalizeAccountEmail(value), "INVALID_EMAIL");
    }
    assertAuthInputError(
        () => normalizeAccountEmail(`${"a".repeat(309)}@example.invalid`),
        "INVALID_EMAIL",
    );
});

test("validates login password limits without rewriting legacy passwords", () => {
    const legacyPasswordWithSpaces = "  pass phrase  ";
    assert.equal(ACCOUNT_PASSWORD_MIN_LENGTH, 8);
    assert.equal(ACCOUNT_PASSWORD_MAX_LENGTH, 128);
    assert.equal(validateAccountPassword("eight888"), "eight888");
    assert.equal(validateAccountPassword(legacyPasswordWithSpaces), legacyPasswordWithSpaces);
    assert.equal(validateAccountPassword("🔐".repeat(128)), "🔐".repeat(128));

    for (const value of [null, "short", "a".repeat(129), `${"a".repeat(8)}\0`]) {
        assertAuthInputError(() => validateAccountPassword(value), "INVALID_PASSWORD");
    }
});

test("accepts simple memorable new passwords without character-class requirements", () => {
    for (const password of [
        "onlyletters",
        "31415926",
        "一段好記的長密碼",
        "long password from a manager ! 2026",
    ]) {
        assert.equal(validateNewAccountPassword(password), password);
    }
});

test("rejects whitespace-only, edge-space, and common weak new passwords", () => {
    for (const password of [
        "        ",
        " password",
        "password ",
        "password",
        "Password123",
        "１２３４５６７８",
        "aaaaaaaa",
    ]) {
        assertAuthInputError(() => validateNewAccountPassword(password), "INVALID_PASSWORD");
    }

    // Login stays backward compatible with passwords accepted before the new-password policy.
    assert.equal(validateAccountPassword("Password123"), "Password123");
    assert.equal(validateAccountPassword(" password"), " password");
});

test("parses and normalizes registration input while limiting self-selected roles", () => {
    assert.deepEqual(ACCOUNT_ROLES, ["parent", "learner", "tutor"]);
    assert.deepEqual(
        parseRegisterAccountInput({
            displayName: "  Ａlice   Parent  ",
            learnerName: "  小明   同學  ",
            email: "  FAMILY@EXAMPLE.INVALID ",
            password: "family passphrase",
            role: "parent",
        }),
        {
            displayName: "Alice Parent",
            learnerName: "小明 同學",
            email: "family@example.invalid",
            password: "family passphrase",
            role: "parent",
        },
    );

    assert.deepEqual(
        parseRegisterAccountInput({
            displayName: "  本人學習者  ",
            email: "self@example.invalid",
            password: "self passphrase",
            role: "learner",
        }),
        {
            displayName: "本人學習者",
            learnerName: "本人學習者",
            email: "self@example.invalid",
            password: "self passphrase",
            role: "learner",
        },
    );

    assertAuthInputError(
        () => parseRegisterAccountInput({
            displayName: "家長",
            learnerName: "學習者",
            email: "family@example.invalid",
            password: "family passphrase",
            role: "system_admin",
        }),
        "INVALID_ROLE",
    );
    assertAuthInputError(
        () => parseRegisterAccountInput({
            displayName: "家長",
            learnerName: "學習者",
            email: "family@example.invalid",
            password: "password",
            role: "parent",
        }),
        "INVALID_PASSWORD",
    );
});

test("rejects invalid display names, learner names, and non-object auth payloads", () => {
    const validRegistration = {
        displayName: "家長",
        learnerName: "學習者",
        email: "family@example.invalid",
        password: "family passphrase",
        role: "parent",
    };

    assertAuthInputError(() => parseRegisterAccountInput(null), "INVALID_ACCOUNT_INPUT");
    assertAuthInputError(() => parseRegisterAccountInput([]), "INVALID_ACCOUNT_INPUT");
    assertAuthInputError(
        () => parseRegisterAccountInput({ ...validRegistration, displayName: "\n" }),
        "INVALID_ACCOUNT_INPUT",
    );
    assertAuthInputError(
        () => parseRegisterAccountInput({ ...validRegistration, learnerName: "x".repeat(81) }),
        "INVALID_ACCOUNT_INPUT",
    );
});

test("parses learner creation, selection, and update bodies with canonical UUIDs", () => {
    assert.deepEqual(
        parseCreateAccountLearnerInput({
            clientRequestId: "10000000-0000-4000-8000-000000000001",
            displayName: "  小明  ",
            gradeCode: " JUNIOR-HIGH-1 ",
            semesterCode: " SEMESTER-1 ",
        }),
        {
            clientRequestId: "10000000-0000-4000-8000-000000000001",
            displayName: "小明",
            gradeCode: "junior-high-1",
            semesterCode: "semester-1",
        },
    );
    assert.deepEqual(
        parseUpdateAccountLearnerInput({
            action: "select",
            learnerId: "10000000-0000-4000-8000-000000000001",
        }),
        {
            action: "select",
            learnerId: "10000000-0000-4000-8000-000000000001",
        },
    );
    assert.deepEqual(
        parseUpdateAccountLearnerInput({
            action: "update-current",
            learnerId: "10000000-0000-4000-8000-000000000001",
            displayName: "目前學習者新名稱",
            gradeCode: "junior-high-1",
            semesterCode: "semester-1",
        }),
        {
            action: "update-current",
            learnerId: "10000000-0000-4000-8000-000000000001",
            displayName: "目前學習者新名稱",
            gradeCode: "junior-high-1",
            semesterCode: "semester-1",
        },
    );
    assert.deepEqual(
        parseUpdateAccountLearnerInput({
            action: "update",
            learnerId: "10000000-0000-4000-8000-000000000001",
            displayName: "新名稱",
            gradeCode: "junior-high-2",
            semesterCode: "semester-2",
        }),
        {
            action: "update",
            learnerId: "10000000-0000-4000-8000-000000000001",
            displayName: "新名稱",
            gradeCode: "junior-high-2",
            semesterCode: "semester-2",
        },
    );

    for (const body of [
        { clientRequestId: "not-a-uuid", displayName: "小明", gradeCode: "junior-high-1", semesterCode: "semester-1" },
        { clientRequestId: "10000000-0000-4000-8000-000000000001", displayName: "小明", gradeCode: "bad code", semesterCode: "semester-1" },
    ]) {
        assertAuthInputError(() => parseCreateAccountLearnerInput(body), "INVALID_ACCOUNT_INPUT");
    }
    assertAuthInputError(
        () => parseUpdateAccountLearnerInput({
            action: "delete",
            learnerId: "10000000-0000-4000-8000-000000000001",
        }),
        "INVALID_ACCOUNT_INPUT",
    );
});

test("parses learner subject-version updates with an optimistic lock", () => {
    assert.deepEqual(
        parseUpdateLearnerSubjectSettingInput({
            learnerId: "10000000-0000-4000-8000-000000000001",
            subjectCode: " CHINESE ",
            bookVersionId: "20000000-0000-4000-8000-000000000002",
            lockVersion: 7,
        }),
        {
            learnerId: "10000000-0000-4000-8000-000000000001",
            subjectCode: "chinese",
            bookVersionId: "20000000-0000-4000-8000-000000000002",
            lockVersion: 7,
        },
    );
    assert.equal(
        parseUpdateLearnerSubjectSettingInput({
            learnerId: "10000000-0000-4000-8000-000000000001",
            subjectCode: "chinese",
            bookVersionId: null,
            lockVersion: 1,
        }).bookVersionId,
        null,
    );
    for (const body of [
        { learnerId: "not-a-uuid", subjectCode: "chinese", bookVersionId: null, lockVersion: 1 },
        { learnerId: "10000000-0000-4000-8000-000000000001", subjectCode: "bad code", bookVersionId: null, lockVersion: 1 },
        { learnerId: "10000000-0000-4000-8000-000000000001", subjectCode: "chinese", bookVersionId: "not-a-uuid", lockVersion: 1 },
        { learnerId: "10000000-0000-4000-8000-000000000001", subjectCode: "chinese", bookVersionId: null, lockVersion: 0 },
        { learnerId: "10000000-0000-4000-8000-000000000001", subjectCode: "chinese", bookVersionId: null, lockVersion: 1.5 },
    ]) {
        assertAuthInputError(
            () => parseUpdateLearnerSubjectSettingInput(body),
            "INVALID_ACCOUNT_INPUT",
        );
    }
});

test("updates only the active authorized learner's compatible subject version", () => {
    const updateSource = authServiceSource.match(
        /export async function updateLearnerSubjectSetting[\s\S]*$/u,
    )?.[0];

    assert.ok(updateSource, "subject setting update service should remain present");
    assert.match(updateSource, /input\.learnerId !== session\.learner_id/u);
    assert.match(updateSource, /access\.can_manage_settings = true/u);
    assert.match(updateSource, /access\.accepted_at IS NOT NULL/u);
    assert.match(updateSource, /access\.revoked_at IS NULL/u);
    assert.match(updateSource, /subject\.subject_kind = 'leaf'/u);
    assert.match(updateSource, /setting\.enabled = true/u);
    assert.match(updateSource, /book\.subject_id = \$2/u);
    assert.match(updateSource, /book\.grade_id IS NULL OR book\.grade_id = \$3/u);
    assert.match(updateSource, /book\.origin = 'system' OR book\.owner_user_id = \$4/u);
    assert.match(updateSource, /setting\.lock_version !== input\.lockVersion/u);
    assert.match(updateSource, /LEARNER_SUBJECT_SETTING_CONFLICT/u);
    assert.match(updateSource, /lock_version = lock_version \+ 1/u);
    assert.match(updateSource, /updated_at = transaction_timestamp\(\)/u);
    assert.match(updateSource, /return readSessionById\(client, session\.session_id\)/u);

    assert.match(learnerSubjectSettingsRouteSource, /export async function PATCH/u);
    assert.match(learnerSubjectSettingsRouteSource, /requireSafeCredentialTransport\(request\)/u);
    assert.match(learnerSubjectSettingsRouteSource, /parseUpdateLearnerSubjectSettingInput/u);
    assert.match(learnerSubjectSettingsRouteSource, /updateLearnerSubjectSetting/u);
    assert.match(learnerSubjectSettingsRouteSource, /accountResponse\(account\)/u);
    assert.match(learnerSubjectSettingsRouteSource, /handleAuthError\(error\)/u);
});

test("parses login input with the same email and password rules", () => {
    assert.deepEqual(
        parseLoginAccountInput({
            email: "  LOGIN@EXAMPLE.INVALID ",
            password: "login passphrase",
        }),
        {
            email: "login@example.invalid",
            password: "login passphrase",
        },
    );

    assertAuthInputError(() => parseLoginAccountInput("not-an-object"), "INVALID_ACCOUNT_INPUT");
    assertAuthInputError(
        () => parseLoginAccountInput({ email: "login@example.invalid", password: "short" }),
        "INVALID_PASSWORD",
    );
});

test("requires password re-authentication only for parent and tutor role targets", () => {
    assert.deepEqual(
        parseSwitchAccountRoleInput({ targetRole: "learner" }),
        { targetRole: "learner" },
    );
    assert.deepEqual(
        parseSwitchAccountRoleInput({ targetRole: "parent", password: "family passphrase" }),
        { targetRole: "parent", password: "family passphrase" },
    );
    assert.deepEqual(
        parseSwitchAccountRoleInput({ targetRole: "tutor", password: "tutor passphrase" }),
        { targetRole: "tutor", password: "tutor passphrase" },
    );

    assertAuthInputError(() => parseSwitchAccountRoleInput(null), "INVALID_ACCOUNT_INPUT");
    assertAuthInputError(
        () => parseSwitchAccountRoleInput({ targetRole: "system_admin", password: "admin passphrase" }),
        "INVALID_ROLE",
    );
    assertAuthInputError(
        () => parseSwitchAccountRoleInput({ targetRole: "parent" }),
        "INVALID_PASSWORD",
    );
    assertAuthInputError(
        () => parseSwitchAccountRoleInput({ targetRole: "tutor", password: "short" }),
        "INVALID_PASSWORD",
    );
});

test("allows credentials over HTTPS only when an Origin header matches the request origin", () => {
    const requestUrl = "https://accounts.example.invalid/api/auth/login";

    assert.equal(isCredentialRequestTransportAllowed(requestUrl, null), true);
    assert.equal(isCredentialRequestTransportAllowed(requestUrl, "https://accounts.example.invalid"), true);
    assert.equal(isCredentialRequestTransportAllowed(requestUrl, "https://other.example.invalid"), false);
    assert.equal(isCredentialRequestTransportAllowed(requestUrl, "http://accounts.example.invalid"), false);
    assert.equal(isCredentialRequestTransportAllowed(requestUrl, "not a URL"), false);
});

test("allows plain HTTP credentials only on an exact loopback origin", () => {
    assert.equal(
        isCredentialRequestTransportAllowed(
            "http://localhost:3500/api/auth/register",
            "http://localhost:3500",
        ),
        true,
    );
    assert.equal(
        isCredentialRequestTransportAllowed("http://127.0.0.1:3500/api/auth/login", null),
        true,
    );
    assert.equal(
        isCredentialRequestTransportAllowed("http://[::1]:3500/api/auth/login", "http://[::1]:3500"),
        true,
    );
    assert.equal(
        isCredentialRequestTransportAllowed("http://localhost:3500/api/auth/login", "http://localhost:3600"),
        false,
    );
    assert.equal(
        isCredentialRequestTransportAllowed("http://0.0.0.0:3500/api/auth/login", "http://localhost:3500"),
        false,
    );
    assert.equal(
        isCredentialRequestTransportAllowed("http://100.86.149.1:3500/api/auth/login", "http://localhost:3500"),
        false,
    );
    assert.equal(
        isCredentialRequestTransportAllowed("http://localhost.example.invalid/api/auth/login", null),
        false,
    );
    assert.equal(
        isCredentialRequestTransportAllowed("http://100.86.149.1:3500/api/auth/login", null),
        false,
    );
    assert.equal(isCredentialRequestTransportAllowed("ftp://localhost/credentials", null), false);
    assert.equal(isCredentialRequestTransportAllowed("not a URL", null), false);
});

test("rejects all-interface request URLs even when proxy headers made Next infer HTTPS", () => {
    const plainBoundRequestUrl = "http://0.0.0.0:3500/api/auth/login";
    const forwardedHttpsRequestUrl = "https://0.0.0.0:3500/api/auth/login";

    assert.equal(
        isCredentialRequestTransportAllowed(
            plainBoundRequestUrl,
            "http://localhost:3500",
            "localhost:3500",
        ),
        false,
    );
    assert.equal(
        isCredentialRequestTransportAllowed(
            forwardedHttpsRequestUrl,
            "https://linmacbook-pro.tailc132cc.ts.net:8443",
            "linmacbook-pro.tailc132cc.ts.net:8443",
        ),
        false,
    );
    assert.equal(
        isCredentialRequestTransportAllowed(forwardedHttpsRequestUrl, null, "localhost:3500"),
        false,
    );
});

test("uses a strict loopback Host for direct HTTP requests", () => {
    const boundRequestUrl = "http://127.0.0.1:3500/api/auth/login";

    assert.equal(
        isCredentialRequestTransportAllowed(
            boundRequestUrl,
            "http://localhost:3500",
            "localhost:3500",
        ),
        true,
    );
    assert.equal(
        isCredentialRequestTransportAllowed(
            boundRequestUrl,
            "http://localhost:3600",
            "localhost:3600",
        ),
        false,
    );
    assert.equal(
        isCredentialRequestTransportAllowed(
            boundRequestUrl,
            "http://100.86.149.1:3500",
            "100.86.149.1:3500",
        ),
        false,
    );
    assert.equal(
        isCredentialRequestTransportAllowed(boundRequestUrl, "http://localhost:3500", null),
        false,
    );
    assert.equal(
        isCredentialRequestTransportAllowed(
            boundRequestUrl,
            "http://localhost:3500",
            "localhost:3500/path",
        ),
        false,
    );
});

test("uses the public HTTPS Host only behind a loopback-bound proxy", () => {
    const proxiedRequestUrl = "https://127.0.0.1:3500/api/auth/login";
    const publicOrigin = "https://linmacbook-pro.tailc132cc.ts.net:8443";

    assert.equal(
        isCredentialRequestTransportAllowed(
            proxiedRequestUrl,
            publicOrigin,
            "linmacbook-pro.tailc132cc.ts.net:8443",
        ),
        true,
    );
    assert.equal(
        isCredentialRequestTransportAllowed(
            proxiedRequestUrl,
            null,
            "linmacbook-pro.tailc132cc.ts.net:8443",
        ),
        true,
    );
    assert.equal(
        isCredentialRequestTransportAllowed(
            proxiedRequestUrl,
            "https://linmacbook-pro.tailc132cc.ts.net",
            "linmacbook-pro.tailc132cc.ts.net:8443",
        ),
        false,
    );
    assert.equal(
        isCredentialRequestTransportAllowed(
            proxiedRequestUrl,
            "http://linmacbook-pro.tailc132cc.ts.net:8443",
            "linmacbook-pro.tailc132cc.ts.net:8443",
        ),
        false,
    );
    assert.equal(
        isCredentialRequestTransportAllowed(
            proxiedRequestUrl,
            `${publicOrigin}/unexpected-path`,
            "linmacbook-pro.tailc132cc.ts.net:8443",
        ),
        false,
    );
});
