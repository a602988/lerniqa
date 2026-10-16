import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    EMAIL_VERIFICATION_EXPIRES_IN_MINUTES,
    EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
    EmailVerificationError,
    confirmEmailVerification,
    hashEmailVerificationToken,
    parseEmailVerificationToken,
    requestEmailVerification,
    verificationActionUrl,
    type EmailVerificationRepository,
} from "../app/lib/email-verification.ts";
import type { MailProviderAdapter } from "../app/lib/mail/synology-mailplus.ts";

function acceptedMailAdapter(onSend: (actionUrl: string) => void): MailProviderAdapter {
    return {
        provider: "synology_mailplus",
        async verify() {},
        async send(message) {
            const text = message.text ?? "";
            const actionUrl = text.split("\n").find((line) => line.startsWith("https://"));
            assert.ok(actionUrl);
            onSend(actionUrl);
            return {
                messageId: "synthetic-message",
                accepted: [message.to[0].address],
                rejected: [],
            };
        },
    };
}

test("issues only a token hash and sends the plaintext token in a URL fragment", async () => {
    const issuedInputs: Array<Parameters<EmailVerificationRepository["issue"]>[0]> = [];
    let sentActionUrl = "";
    const repository: EmailVerificationRepository = {
        async issue(input) {
            issuedInputs.push(input);
            return {
                status: "issued",
                email: "learner@example.invalid",
                displayName: "合成學習者",
                expiresAt: "2030-01-01T01:00:00.000Z",
            };
        },
        async consume() {
            throw new Error("not used");
        },
    };

    const result = await requestEmailVerification(
        repository,
        acceptedMailAdapter((url) => { sentActionUrl = url; }),
        {
            userId: "11111111-1111-4111-8111-111111111111",
            request: new Request("https://learn.example.test/api/v1/auth/email-verification", {
                method: "POST",
                headers: { Origin: "https://learn.example.test" },
            }),
        },
    );

    assert.deepEqual(result, {
        status: "sent",
        expiresAt: "2030-01-01T01:00:00.000Z",
    });
    const issuedInput = issuedInputs[0];
    assert.ok(issuedInput);
    assert.equal(issuedInput.expiresInMinutes, EMAIL_VERIFICATION_EXPIRES_IN_MINUTES);
    assert.equal(
        issuedInput.resendCooldownSeconds,
        EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
    );
    assert.match(issuedInput.tokenHash, /^[0-9a-f]{64}$/u);

    const actionUrl = new URL(sentActionUrl);
    assert.equal(actionUrl.origin, "https://learn.example.test");
    assert.equal(actionUrl.pathname, "/account/verify-email");
    assert.equal(actionUrl.search, "");
    const token = new URLSearchParams(actionUrl.hash.slice(1)).get("token");
    assert.ok(token);
    assert.equal(hashEmailVerificationToken(token), issuedInput.tokenHash);
    assert.equal(JSON.stringify(issuedInput).includes(token), false);
});

test("does not send another message after the identity is already verified", async () => {
    let sendCalls = 0;
    const repository: EmailVerificationRepository = {
        async issue() { return { status: "already_verified" }; },
        async consume() { throw new Error("not used"); },
    };
    const result = await requestEmailVerification(
        repository,
        acceptedMailAdapter(() => { sendCalls += 1; }),
        {
            userId: "11111111-1111-4111-8111-111111111111",
            request: new Request("http://localhost:3500/api/v1/auth/email-verification"),
        },
    );
    assert.deepEqual(result, { status: "already_verified", expiresAt: null });
    assert.equal(sendCalls, 0);
});

test("consumption is one-time but replay is an idempotent success", async () => {
    const token = "a".repeat(43);
    const expectedHash = hashEmailVerificationToken(token);
    let consumed = false;
    const repository: EmailVerificationRepository = {
        async issue() { throw new Error("not used"); },
        async consume(tokenHash) {
            assert.equal(tokenHash, expectedHash);
            if (consumed) {
                return {
                    status: "already_verified",
                    userId: "11111111-1111-4111-8111-111111111111",
                };
            }
            consumed = true;
            return {
                status: "verified",
                userId: "11111111-1111-4111-8111-111111111111",
            };
        },
    };

    assert.equal((await confirmEmailVerification(repository, token)).status, "verified");
    assert.equal((await confirmEmailVerification(repository, token)).status, "already_verified");
});

test("rejects malformed, unknown and expired challenges without leaking an account", async () => {
    assert.throws(
        () => parseEmailVerificationToken("short"),
        (error) => error instanceof EmailVerificationError
            && error.code === "EMAIL_VERIFICATION_INVALID",
    );

    for (const [status, expectedCode, expectedStatus] of [
        ["invalid", "EMAIL_VERIFICATION_INVALID", 400],
        ["expired", "EMAIL_VERIFICATION_EXPIRED", 410],
    ] as const) {
        const repository: EmailVerificationRepository = {
            async issue() { throw new Error("not used"); },
            async consume() {
                return {
                    status,
                    userId: status === "expired"
                        ? "11111111-1111-4111-8111-111111111111"
                        : null,
                };
            },
        };
        await assert.rejects(
            confirmEmailVerification(repository, "b".repeat(43)),
            (error) => error instanceof EmailVerificationError
                && error.code === expectedCode
                && error.status === expectedStatus,
        );
    }
});

test("action links reject remote plaintext HTTP and prefer the validated browser origin", () => {
    assert.throws(
        () => verificationActionUrl(
            new Request("http://100.64.0.1:3500/api/v1/auth/email-verification"),
            "c".repeat(43),
        ),
        (error) => error instanceof EmailVerificationError
            && error.code === "EMAIL_VERIFICATION_ORIGIN_INVALID",
    );
    const actionUrl = verificationActionUrl(
        new Request("http://127.0.0.1:3500/api/v1/auth/email-verification", {
            headers: { Origin: "https://learn.tailnet.example" },
        }),
        "c".repeat(43),
    );
    assert.equal(new URL(actionUrl).origin, "https://learn.tailnet.example");
});

test("PostgreSQL repository fails closed for ambiguous identities and consumes atomically", async () => {
    const [source, requestRoute, confirmRoute] = await Promise.all([
        readFile(new URL("../app/lib/email-verification-repository.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/auth/email-verification/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/auth/email-verification/confirm/route.ts", import.meta.url), "utf8"),
    ]);
    assert.match(source, /SELECT lerniqa_lock_auth_user\(\$1::uuid\)/u);
    assert.match(source, /SELECT count\(\*\)[\s\S]*?= 1/u);
    assert.match(source, /FOR UPDATE OF app_user, identity/u);
    assert.match(source, /FOR UPDATE OF challenge, identity/u);
    assert.match(source, /challenge\.expires_at <= transaction_timestamp\(\) AS expired/u);
    assert.match(source, /SET verified_at = COALESCE\(verified_at, transaction_timestamp\(\)\)[\s\S]*?WHERE id = \$1/u);
    assert.match(source, /purpose = 'email_verify'[\s\S]*?consumed_at IS NULL/u);
    assert.doesNotMatch(source, /UPDATE account_identities[\s\S]*?WHERE user_id = \$1[\s\S]*?provider = 'email'/u);
    assert.match(requestRoute, /userId: account\.userId/u);
    assert.match(confirmRoute, /authenticated\.userId === result\.userId/u);
    assert.match(confirmRoute, /account = publicAccount\(authenticated\)/u);
});
