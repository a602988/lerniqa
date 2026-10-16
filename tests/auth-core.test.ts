import assert from "node:assert/strict";
import test from "node:test";

import {
    createSessionToken,
    hashAccountPassword,
    hashSessionToken,
    verifyAccountPassword,
} from "../app/lib/auth-crypto.ts";
import {
    ACCOUNT_ROLES,
    AuthInputError,
    isCredentialRequestTransportAllowed,
    normalizeAccountEmail,
    parseLoginAccountInput,
    parseRegisterAccountInput,
    validateAccountPassword,
} from "../app/lib/auth-input.ts";

function assertAuthInputError(action: () => unknown, expectedCode: string): void {
    assert.throws(action, (error: unknown) => {
        assert.ok(error instanceof AuthInputError);
        assert.equal(error.code, expectedCode);
        assert.equal(error.status, 400);
        return true;
    });
}

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

test("validates password character and byte limits without rewriting the password", () => {
    const passwordWithSpaces = "  pass phrase  ";
    assert.equal(validateAccountPassword(passwordWithSpaces), passwordWithSpaces);
    assert.equal(validateAccountPassword("🔐".repeat(128)), "🔐".repeat(128));

    for (const value of [null, "short-value", "a".repeat(129), `${"a".repeat(12)}\0`]) {
        assertAuthInputError(() => validateAccountPassword(value), "INVALID_PASSWORD");
    }
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
});

test("rejects invalid display names, learner names, and non-object auth payloads", () => {
    const validRegistration = {
        displayName: "家長",
        learnerName: "學習者",
        email: "family@example.invalid",
        password: "family passphrase",
        role: "learner",
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
        () => parseLoginAccountInput({ email: "login@example.invalid", password: "too-short" }),
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

test("uses the browser Host when Next exposes its all-interface bind address", () => {
    const boundRequestUrl = "http://0.0.0.0:3500/api/auth/login";

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
            "http://127.0.0.1:3500",
            "127.0.0.1:3500",
        ),
        true,
    );
    assert.equal(
        isCredentialRequestTransportAllowed(boundRequestUrl, null, "127.0.0.1:3500"),
        true,
    );
    assert.equal(
        isCredentialRequestTransportAllowed(
            boundRequestUrl,
            "http://localhost:3500",
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
            "localhost:3600",
        ),
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
