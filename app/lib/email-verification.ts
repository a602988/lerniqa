import { createHash, randomBytes } from "node:crypto";

import type { MailProviderAdapter } from "./mail/synology-mailplus.ts";
import { sendEmailVerification } from "./mail/account-mail.ts";

export const EMAIL_VERIFICATION_EXPIRES_IN_MINUTES = 60;
export const EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;

const EMAIL_VERIFICATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type EmailVerificationIssueResult =
    | Readonly<{
        status: "issued";
        email: string;
        displayName: string;
        expiresAt: string;
    }>
    | Readonly<{ status: "already_verified" }>;

export type EmailVerificationConsumeResult = Readonly<{
    status: "verified" | "already_verified" | "invalid" | "expired";
    userId: string | null;
}>;

export interface EmailVerificationRepository {
    issue(input: Readonly<{
        userId: string;
        tokenHash: string;
        expiresInMinutes: number;
        resendCooldownSeconds: number;
    }>): Promise<EmailVerificationIssueResult>;
    consume(tokenHash: string): Promise<EmailVerificationConsumeResult>;
}

export class EmailVerificationError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status: number) {
        super(message);
        this.name = "EmailVerificationError";
        this.code = code;
        this.status = status;
    }
}

export function hashEmailVerificationToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

export function parseEmailVerificationToken(value: unknown): string {
    if (typeof value !== "string" || !EMAIL_VERIFICATION_TOKEN_PATTERN.test(value)) {
        throw new EmailVerificationError(
            "EMAIL_VERIFICATION_INVALID",
            "驗證連結無效，請回到帳號中心重新寄送驗證信。",
            400,
        );
    }
    return value;
}

export function verificationActionUrl(request: Request, token: string): string {
    const originHeader = request.headers.get("origin");
    let origin: URL;
    try {
        origin = new URL(originHeader ?? request.url);
    }
    catch {
        throw new EmailVerificationError(
            "EMAIL_VERIFICATION_ORIGIN_INVALID",
            "無法建立安全的驗證連結。",
            400,
        );
    }

    const isLoopbackHttp = origin.protocol === "http:"
        && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(origin.hostname);
    if (
        (origin.protocol !== "https:" && !isLoopbackHttp)
        || origin.username
        || origin.password
    ) {
        throw new EmailVerificationError(
            "EMAIL_VERIFICATION_ORIGIN_INVALID",
            "驗證連結只可使用 HTTPS 或本機 localhost。",
            400,
        );
    }

    const actionUrl = new URL("/account/verify-email", origin.origin);
    // Keep the secret out of HTTP request targets, access logs and referrers.
    actionUrl.hash = `token=${token}`;
    return actionUrl.toString();
}

export async function requestEmailVerification(
    repository: EmailVerificationRepository,
    adapter: MailProviderAdapter,
    input: Readonly<{
        userId: string;
        request: Request;
    }>,
): Promise<Readonly<{
    status: "sent" | "already_verified";
    expiresAt: string | null;
}>> {
    const token = randomBytes(32).toString("base64url");
    const issued = await repository.issue({
        userId: input.userId,
        tokenHash: hashEmailVerificationToken(token),
        expiresInMinutes: EMAIL_VERIFICATION_EXPIRES_IN_MINUTES,
        resendCooldownSeconds: EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
    });
    if (issued.status === "already_verified") {
        return { status: "already_verified", expiresAt: null };
    }

    await sendEmailVerification(adapter, {
        to: issued.email,
        displayName: issued.displayName,
        actionUrl: verificationActionUrl(input.request, token),
        expiresInMinutes: EMAIL_VERIFICATION_EXPIRES_IN_MINUTES,
    });
    return { status: "sent", expiresAt: issued.expiresAt };
}

export async function confirmEmailVerification(
    repository: EmailVerificationRepository,
    tokenValue: unknown,
): Promise<Readonly<{
    status: "verified" | "already_verified";
    userId: string;
}>> {
    const token = parseEmailVerificationToken(tokenValue);
    const consumed = await repository.consume(hashEmailVerificationToken(token));

    if (consumed.status === "invalid" || !consumed.userId) {
        throw new EmailVerificationError(
            "EMAIL_VERIFICATION_INVALID",
            "驗證連結無效，請回到帳號中心重新寄送驗證信。",
            400,
        );
    }
    if (consumed.status === "expired") {
        throw new EmailVerificationError(
            "EMAIL_VERIFICATION_EXPIRED",
            "驗證連結已過期，請回到帳號中心重新寄送驗證信。",
            410,
        );
    }
    return { status: consumed.status, userId: consumed.userId };
}
