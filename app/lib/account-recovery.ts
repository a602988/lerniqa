import { createHash, randomBytes } from "node:crypto";

import { hashAccountPassword, hashRolePin } from "./auth-crypto.ts";
import type { RolePinTargetRole } from "./auth-input.ts";
import {
    sendPasswordReset,
    sendRolePinReset,
} from "./mail/account-mail.ts";
import {
    MailServiceError,
    type MailProviderAdapter,
} from "./mail/synology-mailplus.ts";

export const PASSWORD_RESET_EXPIRES_IN_MINUTES = 30;
export const ROLE_PIN_RESET_EXPIRES_IN_MINUTES = 15;
export const RECOVERY_RESEND_COOLDOWN_SECONDS = 60;
export const RECOVERY_MAX_REQUESTS_PER_HOUR = 5;

export type RecoveryIssueResult =
    | Readonly<{
        status: "issued";
        identityId: string;
        email: string;
        displayName: string;
        expiresAt: string;
    }>
    | Readonly<{ status: "suppressed" }>;

export type RecoveryConsumeResult =
    | Readonly<{
        status: "completed";
        affectedUserId: string;
        targetRole?: RolePinTargetRole;
    }>
    | Readonly<{ status: "invalid" | "expired" }>;

export type RecoveryPreflightResult =
    | Readonly<{
        status: "valid";
        affectedUserId: string;
        affectedIdentityId: string;
        targetRole?: RolePinTargetRole;
    }>
    | Readonly<{ status: "invalid" | "expired" }>;

export interface AccountRecoveryHashing {
    hashPassword(password: string): Promise<string>;
    hashPin(pin: string): Promise<string>;
}

export interface AccountRecoveryRepository {
    preflightPasswordReset(input: Readonly<{
        tokenHash: string;
    }>): Promise<RecoveryPreflightResult>;
    issuePasswordReset(input: Readonly<{
        email: string;
        tokenHash: string;
        expiresInMinutes: number;
        resendCooldownSeconds: number;
        maxRequestsPerHour: number;
    }>): Promise<RecoveryIssueResult>;
    consumePasswordReset(input: Readonly<{
        tokenHash: string;
        expectedUserId: string;
        expectedIdentityId: string;
        passwordHash: string;
    }>): Promise<RecoveryConsumeResult>;
    preflightRolePinReset(input: Readonly<{
        tokenHash: string;
    }>): Promise<RecoveryPreflightResult>;
    issueRolePinReset(input: Readonly<{
        userId: string;
        targetRole: RolePinTargetRole;
        tokenHash: string;
        expiresInMinutes: number;
        resendCooldownSeconds: number;
        maxRequestsPerHour: number;
    }>): Promise<RecoveryIssueResult>;
    consumeRolePinReset(input: Readonly<{
        tokenHash: string;
        expectedUserId: string;
        expectedIdentityId: string;
        expectedTargetRole: RolePinTargetRole;
        newPin: string;
        pinHash: string;
    }>): Promise<RecoveryConsumeResult>;
    cancel(input: Readonly<{
        tokenHash: string;
        purpose: "password_reset" | "role_pin_reset";
    }>): Promise<void>;
}

const DEFAULT_RECOVERY_HASHING: AccountRecoveryHashing = {
    hashPassword: hashAccountPassword,
    hashPin: hashRolePin,
};
const MAX_CONCURRENT_RECOVERY_KDFS = 2;
let activeRecoveryKdfs = 0;

async function runRecoveryKdf<T>(operation: () => Promise<T>): Promise<T> {
    if (activeRecoveryKdfs >= MAX_CONCURRENT_RECOVERY_KDFS) {
        throw new AccountRecoveryError(
            "ACCOUNT_RECOVERY_BUSY",
            "帳號安全服務目前忙碌，請稍後再試。",
            503,
        );
    }
    activeRecoveryKdfs += 1;
    try {
        return await operation();
    }
    finally {
        activeRecoveryKdfs -= 1;
    }
}

function assertUsablePreflight(
    preflight: RecoveryPreflightResult,
    purpose: "password" | "role_pin",
): asserts preflight is Extract<RecoveryPreflightResult, { status: "valid" }> {
    if (preflight.status === "valid") return;
    if (purpose === "password") {
        throw new AccountRecoveryError(
            preflight.status === "expired" ? "PASSWORD_RESET_EXPIRED" : "PASSWORD_RESET_INVALID",
            preflight.status === "expired"
                ? "密碼重設連結已過期，請重新提出申請。"
                : "密碼重設連結無效，請重新提出申請。",
            preflight.status === "expired" ? 410 : 400,
        );
    }
    throw new AccountRecoveryError(
        preflight.status === "expired" ? "ROLE_PIN_RESET_EXPIRED" : "ROLE_PIN_RESET_INVALID",
        preflight.status === "expired"
            ? "角色 PIN 重設連結已過期，請重新提出申請。"
            : "角色 PIN 重設連結無效，請重新提出申請。",
        preflight.status === "expired" ? 410 : 400,
    );
}

export class AccountRecoveryError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status: number) {
        super(message);
        this.name = "AccountRecoveryError";
        this.code = code;
        this.status = status;
    }
}

export function hashAccountRecoveryToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

function recoveryActionUrl(
    request: Request,
    pathname: "/account/reset-password" | "/account/reset-role-pin",
    token: string,
): string {
    const originHeader = request.headers.get("origin");
    let origin: URL;
    try {
        origin = new URL(originHeader ?? request.url);
    }
    catch {
        throw new AccountRecoveryError(
            "ACCOUNT_RECOVERY_ORIGIN_INVALID",
            "無法建立安全的重設連結。",
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
        throw new AccountRecoveryError(
            "ACCOUNT_RECOVERY_ORIGIN_INVALID",
            "重設連結只可使用 HTTPS 或本機 localhost。",
            400,
        );
    }

    const actionUrl = new URL(pathname, origin.origin);
    // Fragments are not sent in HTTP requests, access logs or referrers.
    actionUrl.hash = `token=${token}`;
    return actionUrl.toString();
}

async function cancelFailedDelivery(
    repository: AccountRecoveryRepository,
    tokenHash: string,
    purpose: "password_reset" | "role_pin_reset",
): Promise<void> {
    try {
        await repository.cancel({ tokenHash, purpose });
    }
    catch {
        // A token that was not delivered is still computationally unguessable.
        // Do not turn cleanup failure into an account-enumeration signal.
    }
}

export async function requestPasswordReset(
    repository: AccountRecoveryRepository,
    adapter: MailProviderAdapter,
    input: Readonly<{ email: string; request: Request }>,
): Promise<Readonly<{ status: "accepted" }>> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashAccountRecoveryToken(token);
    const actionUrl = recoveryActionUrl(input.request, "/account/reset-password", token);
    const issued = await repository.issuePasswordReset({
        email: input.email,
        tokenHash,
        expiresInMinutes: PASSWORD_RESET_EXPIRES_IN_MINUTES,
        resendCooldownSeconds: RECOVERY_RESEND_COOLDOWN_SECONDS,
        maxRequestsPerHour: RECOVERY_MAX_REQUESTS_PER_HOUR,
    });
    if (issued.status === "suppressed") return { status: "accepted" };

    try {
        await sendPasswordReset(adapter, {
            to: issued.email,
            displayName: issued.displayName,
            actionUrl,
            expiresInMinutes: PASSWORD_RESET_EXPIRES_IN_MINUTES,
        });
    }
    catch (error) {
        if (!(error instanceof MailServiceError)) throw error;
        await cancelFailedDelivery(repository, tokenHash, "password_reset");
    }
    return { status: "accepted" };
}

export async function confirmPasswordReset(
    repository: AccountRecoveryRepository,
    input: Readonly<{ token: string; newPassword: string }>,
    hashing: AccountRecoveryHashing = DEFAULT_RECOVERY_HASHING,
): Promise<Readonly<{ status: "completed"; affectedUserId: string }>> {
    const tokenHash = hashAccountRecoveryToken(input.token);
    const preflight = await repository.preflightPasswordReset({ tokenHash });
    assertUsablePreflight(preflight, "password");
    const consumed = await runRecoveryKdf(async () => {
        const passwordHash = await hashing.hashPassword(input.newPassword);
        return repository.consumePasswordReset({
            tokenHash,
            expectedUserId: preflight.affectedUserId,
            expectedIdentityId: preflight.affectedIdentityId,
            passwordHash,
        });
    });
    if (consumed.status === "expired") {
        throw new AccountRecoveryError(
            "PASSWORD_RESET_EXPIRED",
            "密碼重設連結已過期，請重新提出申請。",
            410,
        );
    }
    if (consumed.status !== "completed") {
        throw new AccountRecoveryError(
            "PASSWORD_RESET_INVALID",
            "密碼重設連結無效，請重新提出申請。",
            400,
        );
    }
    return {
        status: "completed",
        affectedUserId: consumed.affectedUserId,
    };
}

export async function requestRolePinReset(
    repository: AccountRecoveryRepository,
    adapter: MailProviderAdapter,
    input: Readonly<{
        userId: string;
        targetRole: RolePinTargetRole;
        request: Request;
    }>,
): Promise<Readonly<{ status: "accepted" }>> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashAccountRecoveryToken(token);
    const actionUrl = recoveryActionUrl(input.request, "/account/reset-role-pin", token);
    const issued = await repository.issueRolePinReset({
        userId: input.userId,
        targetRole: input.targetRole,
        tokenHash,
        expiresInMinutes: ROLE_PIN_RESET_EXPIRES_IN_MINUTES,
        resendCooldownSeconds: RECOVERY_RESEND_COOLDOWN_SECONDS,
        maxRequestsPerHour: RECOVERY_MAX_REQUESTS_PER_HOUR,
    });
    if (issued.status === "suppressed") return { status: "accepted" };

    try {
        await sendRolePinReset(adapter, {
            to: issued.email,
            displayName: issued.displayName,
            actionUrl,
            expiresInMinutes: ROLE_PIN_RESET_EXPIRES_IN_MINUTES,
            targetRole: input.targetRole,
        });
    }
    catch (error) {
        if (!(error instanceof MailServiceError)) throw error;
        await cancelFailedDelivery(repository, tokenHash, "role_pin_reset");
    }
    return { status: "accepted" };
}

export async function confirmRolePinReset(
    repository: AccountRecoveryRepository,
    input: Readonly<{ token: string; newPin: string }>,
    hashing: AccountRecoveryHashing = DEFAULT_RECOVERY_HASHING,
): Promise<Readonly<{
    status: "completed";
    affectedUserId: string;
    targetRole: RolePinTargetRole;
}>> {
    const tokenHash = hashAccountRecoveryToken(input.token);
    const preflight = await repository.preflightRolePinReset({ tokenHash });
    assertUsablePreflight(preflight, "role_pin");
    const targetRole = preflight.targetRole;
    if (targetRole !== "parent" && targetRole !== "tutor") {
        throw new AccountRecoveryError(
            "ROLE_PIN_RESET_INVALID",
            "角色 PIN 重設連結無效，請重新提出申請。",
            400,
        );
    }
    const consumed = await runRecoveryKdf(async () => {
        const pinHash = await hashing.hashPin(input.newPin);
        return repository.consumeRolePinReset({
            tokenHash,
            expectedUserId: preflight.affectedUserId,
            expectedIdentityId: preflight.affectedIdentityId,
            expectedTargetRole: targetRole,
            newPin: input.newPin,
            pinHash,
        });
    });
    if (consumed.status === "expired") {
        throw new AccountRecoveryError(
            "ROLE_PIN_RESET_EXPIRED",
            "角色 PIN 重設連結已過期，請重新提出申請。",
            410,
        );
    }
    if (consumed.status !== "completed" || !consumed.targetRole) {
        throw new AccountRecoveryError(
            "ROLE_PIN_RESET_INVALID",
            "角色 PIN 重設連結無效，請重新提出申請。",
            400,
        );
    }
    return {
        status: "completed",
        affectedUserId: consumed.affectedUserId,
        targetRole: consumed.targetRole,
    };
}
