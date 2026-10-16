export const ACCOUNT_ROLES = ["parent", "learner", "tutor"] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export interface RegisterAccountInput {
    displayName: string;
    learnerName: string;
    email: string;
    password: string;
    role: AccountRole;
}

export interface LoginAccountInput {
    email: string;
    password: string;
}

export class AuthInputError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status = 400) {
        super(message);
        this.name = "AuthInputError";
        this.code = code;
        this.status = status;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeName(value: unknown, label: string): string {
    if (typeof value !== "string") {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", `${label}格式不正確。`);
    }
    const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (
        normalized.length < 1
        || normalized.length > 80
        || /[\u0000-\u001f\u007f]/u.test(normalized)
    ) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", `${label}必須是 1 到 80 個字元。`);
    }
    return normalized;
}

export function normalizeAccountEmail(value: unknown): string {
    if (typeof value !== "string") {
        throw new AuthInputError("INVALID_EMAIL", "電子郵件格式不正確。");
    }
    const normalized = value.normalize("NFKC").trim().toLowerCase();
    if (
        normalized.length < 3
        || normalized.length > 320
        || /[\u0000-\u0020\u007f]/u.test(normalized)
        || !/^[^@]+@[^@]+\.[^@]+$/u.test(normalized)
    ) {
        throw new AuthInputError("INVALID_EMAIL", "電子郵件格式不正確。");
    }
    return normalized;
}

export function validateAccountPassword(value: unknown): string {
    if (typeof value !== "string") {
        throw new AuthInputError("INVALID_PASSWORD", "密碼格式不正確。");
    }
    const characterCount = [...value].length;
    const byteCount = new TextEncoder().encode(value).byteLength;
    if (characterCount < 12 || characterCount > 128 || byteCount > 512 || value.includes("\0")) {
        throw new AuthInputError("INVALID_PASSWORD", "密碼必須是 12 到 128 個字元。");
    }
    return value;
}

function parseRole(value: unknown): AccountRole {
    if (typeof value !== "string" || !ACCOUNT_ROLES.includes(value as AccountRole)) {
        throw new AuthInputError("INVALID_ROLE", "請選擇家長、學習者或家教身份。");
    }
    return value as AccountRole;
}

export function parseRegisterAccountInput(value: unknown): RegisterAccountInput {
    if (!isRecord(value)) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "註冊資料格式不正確。");
    }
    return {
        displayName: normalizeName(value.displayName, "帳號稱呼"),
        learnerName: normalizeName(value.learnerName, "學習者稱呼"),
        email: normalizeAccountEmail(value.email),
        password: validateAccountPassword(value.password),
        role: parseRole(value.role),
    };
}

export function parseLoginAccountInput(value: unknown): LoginAccountInput {
    if (!isRecord(value)) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "登入資料格式不正確。");
    }
    return {
        email: normalizeAccountEmail(value.email),
        password: validateAccountPassword(value.password),
    };
}

function normalizedUrl(value: string | null): URL | null {
    if (!value) return null;
    try {
        return new URL(value);
    }
    catch {
        return null;
    }
}

function isLoopbackHostname(hostname: string): boolean {
    return hostname === "localhost"
        || hostname === "127.0.0.1"
        || hostname === "[::1]"
        || hostname === "::1";
}

function isAllInterfaceHostname(hostname: string): boolean {
    return hostname === "0.0.0.0"
        || hostname === "[::]"
        || hostname === "::";
}

function requestOriginFromHost(protocol: string, hostHeader: string | null): URL | null {
    if (!hostHeader) return null;
    const requestOrigin = normalizedUrl(`${protocol}//${hostHeader}`);
    if (
        !requestOrigin
        || requestOrigin.username
        || requestOrigin.password
        || requestOrigin.pathname !== "/"
        || requestOrigin.search
        || requestOrigin.hash
    ) {
        return null;
    }
    return requestOrigin;
}

/**
 * Password-bearing requests may use HTTPS anywhere, but plain HTTP only on
 * a loopback origin. This prevents the Tailscale HTTP URL from accepting a
 * reusable password while leaving a future HTTPS deployment possible.
 */
export function isCredentialRequestTransportAllowed(
    requestUrl: string,
    originHeader: string | null,
    hostHeader: string | null = null,
): boolean {
    const request = normalizedUrl(requestUrl);
    if (!request || !["http:", "https:"].includes(request.protocol)) return false;

    const origin = originHeader === null ? null : normalizedUrl(originHeader);
    if (originHeader !== null && !origin) return false;

    let browserRequest = request;
    if (isAllInterfaceHostname(request.hostname)) {
        const hostRequest = requestOriginFromHost(request.protocol, hostHeader);
        if (!hostRequest) return false;
        browserRequest = hostRequest;
    }
    else if (hostHeader !== null) {
        const hostRequest = requestOriginFromHost(request.protocol, hostHeader);
        if (!hostRequest || hostRequest.origin !== request.origin) return false;
    }

    if (browserRequest.protocol === "https:") {
        return origin === null
            || (origin.protocol === "https:" && origin.origin === browserRequest.origin);
    }
    if (!isLoopbackHostname(browserRequest.hostname)) return false;
    return origin === null
        || (origin.protocol === "http:" && origin.origin === browserRequest.origin);
}
