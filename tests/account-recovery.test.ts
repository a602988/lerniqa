import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    AccountRecoveryError,
    PASSWORD_RESET_EXPIRES_IN_MINUTES,
    RECOVERY_MAX_REQUESTS_PER_HOUR,
    RECOVERY_RESEND_COOLDOWN_SECONDS,
    ROLE_PIN_RESET_EXPIRES_IN_MINUTES,
    confirmPasswordReset,
    confirmRolePinReset,
    hashAccountRecoveryToken,
    requestPasswordReset,
    requestRolePinReset,
    type AccountRecoveryRepository,
    type RecoveryConsumeResult,
    type RecoveryIssueResult,
} from "../app/lib/account-recovery.ts";
import {
    hashRolePin,
    verifyAccountPassword,
    verifyRolePin,
} from "../app/lib/auth-crypto.ts";
import {
    AuthInputError,
    parsePasswordResetConfirmInput,
    parsePasswordResetRequestInput,
    parseRolePinResetConfirmInput,
    parseRolePinResetRequestInput,
    validateNewRolePin,
} from "../app/lib/auth-input.ts";
import {
    MailServiceError,
    type MailProviderAdapter,
} from "../app/lib/mail/synology-mailplus.ts";

const SYNTHETIC_IDENTITY_ID = "22222222-2222-4222-8222-222222222222";

type RepositoryOverrides = Partial<{
    preflightPasswordReset: AccountRecoveryRepository["preflightPasswordReset"];
    issuePasswordReset: AccountRecoveryRepository["issuePasswordReset"];
    consumePasswordReset: AccountRecoveryRepository["consumePasswordReset"];
    preflightRolePinReset: AccountRecoveryRepository["preflightRolePinReset"];
    issueRolePinReset: AccountRecoveryRepository["issueRolePinReset"];
    consumeRolePinReset: AccountRecoveryRepository["consumeRolePinReset"];
    cancel: AccountRecoveryRepository["cancel"];
}>;

function recoveryRepository(overrides: RepositoryOverrides = {}): AccountRecoveryRepository {
    return {
        async preflightPasswordReset() {
            throw new Error("unexpected preflightPasswordReset");
        },
        async issuePasswordReset(): Promise<RecoveryIssueResult> {
            throw new Error("unexpected issuePasswordReset");
        },
        async consumePasswordReset(): Promise<RecoveryConsumeResult> {
            throw new Error("unexpected consumePasswordReset");
        },
        async preflightRolePinReset() {
            throw new Error("unexpected preflightRolePinReset");
        },
        async issueRolePinReset(): Promise<RecoveryIssueResult> {
            throw new Error("unexpected issueRolePinReset");
        },
        async consumeRolePinReset(): Promise<RecoveryConsumeResult> {
            throw new Error("unexpected consumeRolePinReset");
        },
        async cancel(): Promise<void> {
            throw new Error("unexpected cancel");
        },
        ...overrides,
    };
}

function acceptingAdapter(onSend: (actionUrl: string) => void): MailProviderAdapter {
    return {
        provider: "synology_mailplus",
        async verify() {},
        async send(message) {
            const actionUrl = message.text
                ?.split("\n")
                .find((line) => line.startsWith("https://"));
            assert.ok(actionUrl, "account mail should contain an HTTPS action URL");
            onSend(actionUrl);
            return {
                messageId: "synthetic-recovery-message",
                accepted: [message.to[0].address],
                rejected: [],
            };
        },
    };
}

function assertInputError(action: () => unknown, code: string): void {
    assert.throws(action, (error: unknown) => {
        assert.ok(error instanceof AuthInputError);
        assert.equal(error.code, code);
        return true;
    });
}

test("parses recovery bodies and preserves a leading-zero role PIN", () => {
    assert.deepEqual(parsePasswordResetRequestInput({ email: " Parent@Example.Invalid " }), {
        email: "parent@example.invalid",
    });
    assert.deepEqual(parsePasswordResetConfirmInput({
        token: "a".repeat(43),
        newPassword: "correct horse battery staple",
    }), {
        token: "a".repeat(43),
        newPassword: "correct horse battery staple",
    });
    assert.deepEqual(parseRolePinResetRequestInput({ targetRole: "parent" }), {
        targetRole: "parent",
    });
    assert.deepEqual(parseRolePinResetConfirmInput({
        token: "b".repeat(43),
        newPin: "012345",
    }), {
        token: "b".repeat(43),
        newPin: "012345",
    });

    for (const weakPin of ["111111", "123456", "654321"]) {
        assertInputError(() => validateNewRolePin(weakPin), "INVALID_ROLE_PIN");
    }
    for (const malformedPin of ["12345", "1234567", "１２３４５６", 123456]) {
        assertInputError(() => validateNewRolePin(malformedPin), "INVALID_ROLE_PIN");
    }
    assert.equal(validateNewRolePin("012345"), "012345");
    assert.equal(validateNewRolePin("234567"), "234567");
    assertInputError(
        () => parseRolePinResetRequestInput({ targetRole: "learner" }),
        "INVALID_ROLE",
    );
});

test("role PIN hashes use a distinct salted scrypt encoding", async () => {
    const first = await hashRolePin("012345");
    const second = await hashRolePin("012345");
    assert.match(first, /^scrypt-pin\$v1\$/u);
    assert.notEqual(first, second);
    assert.equal(await verifyRolePin("012345", first), true);
    assert.equal(await verifyRolePin("12345", first), false);
    assert.equal(await verifyAccountPassword("012345", first), false);
});

test("password requests are generic and keep the plaintext token only in a fragment", async () => {
    const issued: Array<Parameters<AccountRecoveryRepository["issuePasswordReset"]>[0]> = [];
    let sentActionUrl = "";
    const repository = recoveryRepository({
        async issuePasswordReset(input) {
            issued.push(input);
            return {
                status: "issued",
                identityId: SYNTHETIC_IDENTITY_ID,
                email: "parent@example.invalid",
                displayName: "合成家長",
                expiresAt: "2030-01-01T00:30:00.000Z",
            };
        },
    });
    const result = await requestPasswordReset(
        repository,
        acceptingAdapter((url) => { sentActionUrl = url; }),
        {
            email: "parent@example.invalid",
            request: new Request("https://learn.example.test/api/v1/auth/password-reset", {
                method: "POST",
                headers: { Origin: "https://learn.example.test" },
            }),
        },
    );

    assert.deepEqual(result, { status: "accepted" });
    assert.equal(issued.length, 1);
    assert.equal(issued[0].expiresInMinutes, PASSWORD_RESET_EXPIRES_IN_MINUTES);
    assert.equal(issued[0].resendCooldownSeconds, RECOVERY_RESEND_COOLDOWN_SECONDS);
    assert.equal(issued[0].maxRequestsPerHour, RECOVERY_MAX_REQUESTS_PER_HOUR);
    assert.match(issued[0].tokenHash, /^[0-9a-f]{64}$/u);

    const actionUrl = new URL(sentActionUrl);
    assert.equal(actionUrl.origin, "https://learn.example.test");
    assert.equal(actionUrl.pathname, "/account/reset-password");
    assert.equal(actionUrl.search, "");
    const token = new URLSearchParams(actionUrl.hash.slice(1)).get("token");
    assert.match(token ?? "", /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(hashAccountRecoveryToken(token ?? ""), issued[0].tokenHash);
    assert.equal(JSON.stringify(issued[0]).includes(token ?? "missing-token"), false);

    let suppressedMailCalls = 0;
    const suppressed = await requestPasswordReset(
        recoveryRepository({
            async issuePasswordReset() { return { status: "suppressed" }; },
        }),
        acceptingAdapter(() => { suppressedMailCalls += 1; }),
        {
            email: "unknown@example.invalid",
            request: new Request("https://learn.example.test/api/v1/auth/password-reset"),
        },
    );
    assert.deepEqual(suppressed, result);
    assert.equal(suppressedMailCalls, 0);
});

test("mail failure consumes the issued password challenge without exposing the account", async () => {
    let issuedHash = "";
    const cancellations: Array<Parameters<AccountRecoveryRepository["cancel"]>[0]> = [];
    const result = await requestPasswordReset(
        recoveryRepository({
            async issuePasswordReset(input) {
                issuedHash = input.tokenHash;
                return {
                    status: "issued",
                    identityId: SYNTHETIC_IDENTITY_ID,
                    email: "parent@example.invalid",
                    displayName: "合成家長",
                    expiresAt: "2030-01-01T00:30:00.000Z",
                };
            },
            async cancel(input) { cancellations.push(input); },
        }),
        {
            provider: "synology_mailplus",
            async verify() {},
            async send() {
                throw new MailServiceError("MAIL_UPSTREAM_ERROR", "synthetic failure", 502);
            },
        },
        {
            email: "parent@example.invalid",
            request: new Request("https://learn.example.test/api/v1/auth/password-reset"),
        },
    );

    assert.deepEqual(result, { status: "accepted" });
    assert.deepEqual(cancellations, [{
        tokenHash: issuedHash,
        purpose: "password_reset",
    }]);
});

test("role PIN requests are scoped to one adult role and use a shorter fragment link", async () => {
    const issuedInputs: Array<Parameters<AccountRecoveryRepository["issueRolePinReset"]>[0]> = [];
    let sentActionUrl = "";
    const result = await requestRolePinReset(
        recoveryRepository({
            async issueRolePinReset(input) {
                issuedInputs.push(input);
                return {
                    status: "issued",
                    identityId: SYNTHETIC_IDENTITY_ID,
                    email: "tutor@example.invalid",
                    displayName: "合成家教",
                    expiresAt: "2030-01-01T00:15:00.000Z",
                };
            },
        }),
        acceptingAdapter((url) => { sentActionUrl = url; }),
        {
            userId: "11111111-1111-4111-8111-111111111111",
            targetRole: "tutor",
            request: new Request("https://learn.example.test/api/v1/auth/role-pin-reset"),
        },
    );

    assert.deepEqual(result, { status: "accepted" });
    const issuedInput = issuedInputs[0];
    assert.ok(issuedInput);
    assert.equal(issuedInput.targetRole, "tutor");
    assert.equal(issuedInput.expiresInMinutes, ROLE_PIN_RESET_EXPIRES_IN_MINUTES);
    assert.equal(issuedInput.resendCooldownSeconds, RECOVERY_RESEND_COOLDOWN_SECONDS);
    assert.equal(issuedInput.maxRequestsPerHour, RECOVERY_MAX_REQUESTS_PER_HOUR);
    const actionUrl = new URL(sentActionUrl);
    assert.equal(actionUrl.pathname, "/account/reset-role-pin");
    assert.equal(actionUrl.search, "");
    assert.match(actionUrl.hash, /^#token=[A-Za-z0-9_-]{43}$/u);
});

test("confirmation maps invalid and expired tokens without returning account data", async () => {
    for (const [status, code, httpStatus] of [
        ["invalid", "PASSWORD_RESET_INVALID", 400],
        ["expired", "PASSWORD_RESET_EXPIRED", 410],
    ] as const) {
        await assert.rejects(
            confirmPasswordReset(
                recoveryRepository({
                    async preflightPasswordReset() { return { status }; },
                }),
                { token: "c".repeat(43), newPassword: "unique synthetic passphrase" },
                {
                    async hashPassword() { throw new Error("invalid token reached password KDF"); },
                    async hashPin() { throw new Error("unexpected hashPin"); },
                },
            ),
            (error) => error instanceof AccountRecoveryError
                && error.code === code
                && error.status === httpStatus,
        );
    }

    const roleConsumeInputs: Array<
        Parameters<AccountRecoveryRepository["consumeRolePinReset"]>[0]
    > = [];
    const roleResult = await confirmRolePinReset(
        recoveryRepository({
            async preflightRolePinReset() {
                return {
                    status: "valid",
                    affectedUserId: "11111111-1111-4111-8111-111111111111",
                    affectedIdentityId: SYNTHETIC_IDENTITY_ID,
                    targetRole: "parent",
                };
            },
            async consumeRolePinReset(input) {
                roleConsumeInputs.push(input);
                return {
                    status: "completed",
                    affectedUserId: "11111111-1111-4111-8111-111111111111",
                    targetRole: "parent",
                };
            },
        }),
        { token: "d".repeat(43), newPin: "012345" },
    );
    assert.deepEqual(roleResult, {
        status: "completed",
        affectedUserId: "11111111-1111-4111-8111-111111111111",
        targetRole: "parent",
    });
    const roleConsumeInput = roleConsumeInputs[0];
    assert.ok(roleConsumeInput);
    assert.equal(roleConsumeInput.expectedIdentityId, SYNTHETIC_IDENTITY_ID);
    assert.equal(roleConsumeInput.newPin, "012345");
    assert.match(roleConsumeInput.pinHash, /^scrypt-pin\$v1\$/u);
    assert.equal(await verifyRolePin("012345", roleConsumeInput.pinHash), true);
    assert.deepEqual(
        Object.keys(roleResult).sort(),
        ["affectedUserId", "status", "targetRole"],
    );
});

test("invalid password and role tokens are rejected before either KDF runs", async () => {
    let passwordHashCalls = 0;
    let pinHashCalls = 0;
    const hashing = {
        async hashPassword() {
            passwordHashCalls += 1;
            return "must-not-run";
        },
        async hashPin() {
            pinHashCalls += 1;
            return "must-not-run";
        },
    };

    await assert.rejects(
        confirmPasswordReset(
            recoveryRepository({
                async preflightPasswordReset() { return { status: "invalid" }; },
            }),
            { token: "e".repeat(43), newPassword: "unique synthetic passphrase" },
            hashing,
        ),
        (error) => error instanceof AccountRecoveryError
            && error.code === "PASSWORD_RESET_INVALID",
    );
    await assert.rejects(
        confirmRolePinReset(
            recoveryRepository({
                async preflightRolePinReset() { return { status: "invalid" }; },
            }),
            { token: "f".repeat(43), newPin: "482951" },
            hashing,
        ),
        (error) => error instanceof AccountRecoveryError
            && error.code === "ROLE_PIN_RESET_INVALID",
    );
    assert.equal(passwordHashCalls, 0);
    assert.equal(pinHashCalls, 0);
});

test("password and role confirmation revalidate after hashing and reject a replay race", async () => {
    const affectedUserId = "11111111-1111-4111-8111-111111111111";
    let passwordHashCalls = 0;
    let pinHashCalls = 0;
    const hashing = {
        async hashPassword() {
            passwordHashCalls += 1;
            return "synthetic-password-hash";
        },
        async hashPin() {
            pinHashCalls += 1;
            return "synthetic-pin-hash";
        },
    };

    await assert.rejects(
        confirmPasswordReset(
            recoveryRepository({
                async preflightPasswordReset() {
                    return {
                        status: "valid",
                        affectedUserId,
                        affectedIdentityId: SYNTHETIC_IDENTITY_ID,
                    };
                },
                async consumePasswordReset(input) {
                    assert.equal(input.expectedUserId, affectedUserId);
                    assert.equal(input.expectedIdentityId, SYNTHETIC_IDENTITY_ID);
                    return { status: "invalid" };
                },
            }),
            { token: "g".repeat(43), newPassword: "unique synthetic passphrase" },
            hashing,
        ),
        (error) => error instanceof AccountRecoveryError
            && error.code === "PASSWORD_RESET_INVALID",
    );
    await assert.rejects(
        confirmRolePinReset(
            recoveryRepository({
                async preflightRolePinReset() {
                    return {
                        status: "valid",
                        affectedUserId,
                        affectedIdentityId: SYNTHETIC_IDENTITY_ID,
                        targetRole: "tutor",
                    };
                },
                async consumeRolePinReset(input) {
                    assert.equal(input.expectedUserId, affectedUserId);
                    assert.equal(input.expectedIdentityId, SYNTHETIC_IDENTITY_ID);
                    assert.equal(input.expectedTargetRole, "tutor");
                    return { status: "invalid" };
                },
            }),
            { token: "h".repeat(43), newPin: "482951" },
            hashing,
        ),
        (error) => error instanceof AccountRecoveryError
            && error.code === "ROLE_PIN_RESET_INVALID",
    );
    assert.equal(passwordHashCalls, 1);
    assert.equal(pinHashCalls, 1);
});

test("password and role recovery fail closed if the delivered email identity is replaced", async () => {
    const affectedUserId = "11111111-1111-4111-8111-111111111111";
    const replacementIdentityId = "33333333-3333-4333-8333-333333333333";
    let activeIdentityId = SYNTHETIC_IDENTITY_ID;
    const hashing = {
        async hashPassword() {
            activeIdentityId = replacementIdentityId;
            return "synthetic-password-hash";
        },
        async hashPin() {
            activeIdentityId = replacementIdentityId;
            return "synthetic-pin-hash";
        },
    };

    await assert.rejects(
        confirmPasswordReset(
            recoveryRepository({
                async preflightPasswordReset() {
                    return {
                        status: "valid",
                        affectedUserId,
                        affectedIdentityId: SYNTHETIC_IDENTITY_ID,
                    };
                },
                async consumePasswordReset(input) {
                    assert.equal(input.expectedIdentityId, SYNTHETIC_IDENTITY_ID);
                    return input.expectedIdentityId === activeIdentityId
                        ? { status: "completed", affectedUserId }
                        : { status: "invalid" };
                },
            }),
            { token: "l".repeat(43), newPassword: "unique synthetic passphrase" },
            hashing,
        ),
        (error) => error instanceof AccountRecoveryError
            && error.code === "PASSWORD_RESET_INVALID",
    );

    activeIdentityId = SYNTHETIC_IDENTITY_ID;
    await assert.rejects(
        confirmRolePinReset(
            recoveryRepository({
                async preflightRolePinReset() {
                    return {
                        status: "valid",
                        affectedUserId,
                        affectedIdentityId: SYNTHETIC_IDENTITY_ID,
                        targetRole: "parent",
                    };
                },
                async consumeRolePinReset(input) {
                    assert.equal(input.expectedIdentityId, SYNTHETIC_IDENTITY_ID);
                    return input.expectedIdentityId === activeIdentityId
                        ? { status: "completed", affectedUserId, targetRole: "parent" }
                        : { status: "invalid" };
                },
            }),
            { token: "m".repeat(43), newPin: "482951" },
            hashing,
        ),
        (error) => error instanceof AccountRecoveryError
            && error.code === "ROLE_PIN_RESET_INVALID",
    );
});

test("recovery KDF work is capped globally instead of queueing unbounded crypto work", async () => {
    const affectedUserId = "11111111-1111-4111-8111-111111111111";
    const releases: Array<() => void> = [];
    let signalTwoStarted: (() => void) | undefined;
    const twoStarted = new Promise<void>((resolve) => { signalTwoStarted = resolve; });
    let started = 0;
    const blockedHash = async (value: string) => {
        started += 1;
        if (started === 2) signalTwoStarted?.();
        await new Promise<void>((resolve) => releases.push(resolve));
        return value;
    };
    const hashing = {
        hashPassword: async () => blockedHash("synthetic-password-hash"),
        hashPin: async () => blockedHash("synthetic-pin-hash"),
    };
    const passwordRepository = recoveryRepository({
        async preflightPasswordReset() {
            return {
                status: "valid",
                affectedUserId,
                affectedIdentityId: SYNTHETIC_IDENTITY_ID,
            };
        },
        async consumePasswordReset() {
            return { status: "completed", affectedUserId };
        },
    });
    const roleRepository = recoveryRepository({
        async preflightRolePinReset() {
            return {
                status: "valid",
                affectedUserId,
                affectedIdentityId: SYNTHETIC_IDENTITY_ID,
                targetRole: "parent",
            };
        },
        async consumeRolePinReset() {
            return { status: "completed", affectedUserId, targetRole: "parent" };
        },
    });

    const first = confirmPasswordReset(
        passwordRepository,
        { token: "i".repeat(43), newPassword: "unique synthetic passphrase" },
        hashing,
    );
    const second = confirmRolePinReset(
        roleRepository,
        { token: "j".repeat(43), newPin: "482951" },
        hashing,
    );
    await twoStarted;
    await assert.rejects(
        confirmPasswordReset(
            passwordRepository,
            { token: "k".repeat(43), newPassword: "another synthetic passphrase" },
            hashing,
        ),
        (error) => error instanceof AccountRecoveryError
            && error.code === "ACCOUNT_RECOVERY_BUSY"
            && error.status === 503,
    );
    for (const release of releases) release();
    await Promise.all([first, second]);
});

test("repository and routes retain transactional, rate-limit and session-revocation contracts", async () => {
    const [
        repositorySource,
        passwordRequestRoute,
        passwordConfirmRoute,
        pinRequestRoute,
        pinConfirmRoute,
        sharedSource,
        rolePinResetPage,
    ] = await Promise.all([
        readFile(new URL("../app/lib/account-recovery-repository.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/auth/password-reset/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/auth/password-reset/confirm/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/auth/role-pin-reset/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/auth/role-pin-reset/confirm/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/auth/_shared.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/account/reset-role-pin/page.tsx", import.meta.url), "utf8"),
    ]);
    const passwordIssue = repositorySource.match(
        /async function issuePasswordReset[\s\S]*?async function issueRolePinReset/u,
    )?.[0];
    const pinIssue = repositorySource.match(
        /async function issueRolePinReset[\s\S]*?async function consumePasswordReset/u,
    )?.[0];
    const passwordConsume = repositorySource.match(
        /async function consumePasswordReset[\s\S]*?async function consumeRolePinReset/u,
    )?.[0];
    const pinConsume = repositorySource.match(
        /async function consumeRolePinReset[\s\S]*?async function cancelChallenge/u,
    )?.[0];
    assert.ok(passwordIssue && pinIssue && passwordConsume && pinConsume);

    for (const section of [passwordIssue, pinIssue, passwordConsume, pinConsume]) {
        assert.match(section, /SELECT lerniqa_lock_auth_user\(\$1::uuid\)/u);
        assert.match(section, /FOR UPDATE/u);
    }
    assert.match(repositorySource, /interval '1 hour'/u);
    assert.match(repositorySource, /resendCooldownSeconds/u);
    assert.match(repositorySource, /hourly_count >= input\.maxRequestsPerHour/u);
    assert.match(passwordIssue, /account_identity_id[\s\S]*?identity\.identity_id/u);
    assert.match(pinIssue, /account_identity_id[\s\S]*?identity\.identity_id/u);
    assert.match(passwordConsume, /identity\.id = challenge\.account_identity_id/u);
    assert.match(pinConsume, /identity\.id = challenge\.account_identity_id/u);
    assert.match(passwordConsume, /challenge\.account_identity_id = \$3/u);
    assert.match(pinConsume, /challenge\.account_identity_id = \$3/u);
    assert.match(passwordIssue, /purpose = 'password_reset'[\s\S]*?consumed_at IS NULL/u);
    assert.match(pinIssue, /purpose = 'role_pin_reset'[\s\S]*?target_role = \$2[\s\S]*?consumed_at IS NULL/u);
    assert.match(passwordIssue, /SELECT count\(\*\)[\s\S]*?= 1/u);
    assert.doesNotMatch(passwordIssue, /verified_at IS NOT NULL/u);
    assert.doesNotMatch(passwordConsume, /verified_at IS NOT NULL/u);
    assert.match(pinIssue, /verified_at IS NOT NULL/u);
    assert.match(pinConsume, /verified_at IS NOT NULL/u);

    assert.match(passwordConsume, /UPDATE account_identities[\s\S]*?SET password_hash = \$1/u);
    assert.match(passwordConsume, /UPDATE users[\s\S]*?updated_at = transaction_timestamp\(\)/u);
    assert.match(passwordConsume, /UPDATE auth_sessions[\s\S]*?WHERE user_id = \$1[\s\S]*?revoked_at IS NULL/u);
    assert.doesNotMatch(passwordConsume, /active_role = \$2/u);
    assert.match(pinConsume, /verifyRolePin\(input\.newPin, currentHash\)/u);
    assert.match(pinConsume, /ON CONFLICT \(user_id, role\)/u);
    assert.match(pinConsume, /failed_attempts = 0[\s\S]*?locked_until = NULL/u);
    assert.match(pinConsume, /UPDATE auth_sessions[\s\S]*?active_role = \$2/u);
    assert.match(pinConsume, /target_role = \$2[\s\S]*?consumed_at IS NULL/u);

    assert.match(passwordRequestRoute, /createConfiguredMailAdapter\(\)/u);
    assert.ok(
        passwordRequestRoute.indexOf("createConfiguredMailAdapter()")
            < passwordRequestRoute.indexOf("requestPasswordReset("),
    );
    assert.match(passwordRequestRoute, /status: 202/u);
    assert.match(passwordConfirmRoute, /clearSessionCookie\(request, response\)/u);
    assert.match(pinRequestRoute, /getAuthenticatedAccount\(request\)/u);
    assert.match(pinRequestRoute, /status: 202/u);
    assert.match(passwordConfirmRoute, /currentUserId === result\.affectedUserId/u);
    assert.match(pinConfirmRoute, /currentSession\?\.userId === result\.affectedUserId/u);
    assert.match(pinConfirmRoute, /currentSession\.activeRole === result\.targetRole/u);
    assert.match(pinConfirmRoute, /sessionTokenFromRequest/u);
    assert.match(pinConfirmRoute, /clearSessionCookie\(request, response\)/u);
    assert.match(sharedSource, /error instanceof AccountRecoveryError/u);
    assert.match(rolePinResetPage, /parent: "家長"[\s\S]*?tutor: "家教"/u);
    assert.match(rolePinResetPage, /setCompletedRole\(targetRole\)/u);
    assert.match(rolePinResetPage, /ROLE_LABELS\[completedRole\][\s\S]*?PIN 已設定/u);
});
