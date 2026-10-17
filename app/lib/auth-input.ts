export const ACCOUNT_ROLES = ["parent", "learner", "tutor"] as const;
export const LEARNER_EDUCATION_STATUSES = ["enrolled", "not_enrolled"] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];
export type LearnerEducationStatus = (typeof LEARNER_EDUCATION_STATUSES)[number];

export interface RegisterAccountInput {
    displayName: string;
    learnerName: string;
    email: string;
    password: string;
    role: AccountRole;
    educationStatus: LearnerEducationStatus;
    gradeCode: string | null;
    semesterCode: string | null;
}

export interface LoginAccountInput {
    email: string;
    password: string;
}

export interface SwitchAccountRoleInput {
    targetRole: AccountRole;
    password?: string;
}

export type RolePinTargetRole = Extract<AccountRole, "parent" | "tutor">;

export interface PasswordResetRequestInput {
    email: string;
}

export interface PasswordResetConfirmInput {
    token: string;
    newPassword: string;
}

export interface RolePinResetRequestInput {
    targetRole: RolePinTargetRole;
}

export interface RolePinResetConfirmInput {
    token: string;
    newPin: string;
}

export interface CreateAccountLearnerInput {
    clientRequestId: string;
    displayName: string;
    educationStatus: LearnerEducationStatus;
    gradeCode: string | null;
    semesterCode: string | null;
}

export type UpdateAccountLearnerInput =
    | Readonly<{
        action: "select";
        learnerId: string;
    }>
    | Readonly<{
        action: "update" | "update-current";
        learnerId: string;
        displayName: string;
        educationStatus: LearnerEducationStatus;
        gradeCode: string | null;
        semesterCode: string | null;
    }>;

export interface UpdateLearnerSubjectSettingInput {
    learnerId: string;
    subjectCode: string;
    bookVersionId: string | null;
    lockVersion: number;
}

export interface EnableLearnerSubjectInput {
    learnerId: string;
    subjectCode: string;
}

export const ACCOUNT_PASSWORD_MIN_LENGTH = 8;
export const ACCOUNT_PASSWORD_MAX_LENGTH = 128;
export const ACCOUNT_PASSWORD_HINT = "至少 8 個字元；不必混合大小寫、數字與符號，請避開常見弱密碼。";

const ACCOUNT_PASSWORD_MAX_BYTES = 512;
const ACCOUNT_RECOVERY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const ROLE_PIN_PATTERN = /^\d{6}$/u;
const COMMON_WEAK_PASSWORDS = new Set([
    "00000000",
    "11111111",
    "12345678",
    "123456789",
    "1234567890",
    "abc12345",
    "abcdefgh",
    "admin123",
    "iloveyou",
    "letmein1",
    "passw0rd",
    "password",
    "password1",
    "password123",
    "qwerty123",
    "qwertyui",
    "welcome1",
]);

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

function parseLearnerEducationFields(value: Record<string, unknown>): Readonly<{
    educationStatus: LearnerEducationStatus;
    gradeCode: string | null;
    semesterCode: string | null;
}> {
    if (!LEARNER_EDUCATION_STATUSES.includes(value.educationStatus as LearnerEducationStatus)) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "學習者身分格式不正確。");
    }
    const educationStatus = value.educationStatus as LearnerEducationStatus;
    if (educationStatus === "enrolled") {
        return {
            educationStatus,
            gradeCode: normalizeCatalogCode(value.gradeCode, "年級", 30),
            semesterCode: normalizeCatalogCode(value.semesterCode, "學期", 20),
        };
    }
    if (![undefined, null, ""].includes(value.gradeCode as undefined | null | string)
        || ![undefined, null, ""].includes(value.semesterCode as undefined | null | string)) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "社會人士不能設定年級或學期。");
    }
    return { educationStatus, gradeCode: null, semesterCode: null };
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
    if (
        characterCount < ACCOUNT_PASSWORD_MIN_LENGTH
        || characterCount > ACCOUNT_PASSWORD_MAX_LENGTH
        || byteCount > ACCOUNT_PASSWORD_MAX_BYTES
        || value.includes("\0")
    ) {
        throw new AuthInputError(
            "INVALID_PASSWORD",
            `密碼必須是 ${ACCOUNT_PASSWORD_MIN_LENGTH} 到 ${ACCOUNT_PASSWORD_MAX_LENGTH} 個字元。`,
        );
    }
    return value;
}

/**
 * Validates a newly chosen password for registration and password reset.
 * Login deliberately uses the length-only validator above so accounts created
 * before this policy cannot be locked out by a later weak-password rule.
 */
export function validateNewAccountPassword(value: unknown): string {
    const password = validateAccountPassword(value);
    if (!password.trim()) {
        throw new AuthInputError("INVALID_PASSWORD", "密碼不能全部是空白。");
    }
    if (password.trim() !== password) {
        throw new AuthInputError("INVALID_PASSWORD", "密碼開頭與結尾不能有空白。");
    }

    const weakCandidate = password.normalize("NFKC").toLowerCase();
    if (
        COMMON_WEAK_PASSWORDS.has(weakCandidate)
        || /^(.)\1{7,}$/u.test(weakCandidate)
    ) {
        throw new AuthInputError(
            "INVALID_PASSWORD",
            "這個密碼太容易猜，請換一組較長或不常見的密碼。",
        );
    }
    return password;
}

function validateAccountRecoveryToken(value: unknown): string {
    if (typeof value !== "string" || !ACCOUNT_RECOVERY_TOKEN_PATTERN.test(value)) {
        throw new AuthInputError(
            "ACCOUNT_RECOVERY_INVALID",
            "重設連結無效，請重新提出申請。",
        );
    }
    return value;
}

export function validateNewRolePin(value: unknown): string {
    if (typeof value !== "string" || !ROLE_PIN_PATTERN.test(value)) {
        throw new AuthInputError("INVALID_ROLE_PIN", "角色 PIN 必須是六位數字。", 400);
    }
    if (
        /^(.)\1{5}$/u.test(value)
        || value === "123456"
        || value === "654321"
    ) {
        throw new AuthInputError(
            "INVALID_ROLE_PIN",
            "這組角色 PIN 太容易猜，請改用其他六位數字。",
        );
    }
    return value;
}

export function parsePasswordResetRequestInput(value: unknown): PasswordResetRequestInput {
    if (!isRecord(value)) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "密碼重設資料格式不正確。");
    }
    return { email: normalizeAccountEmail(value.email) };
}

export function parsePasswordResetConfirmInput(value: unknown): PasswordResetConfirmInput {
    if (!isRecord(value)) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "密碼重設資料格式不正確。");
    }
    return {
        token: validateAccountRecoveryToken(value.token),
        newPassword: validateNewAccountPassword(value.newPassword),
    };
}

export function parseRolePinResetRequestInput(value: unknown): RolePinResetRequestInput {
    if (!isRecord(value) || (value.targetRole !== "parent" && value.targetRole !== "tutor")) {
        throw new AuthInputError("INVALID_ROLE", "請選擇家長或家教身份。", 400);
    }
    return { targetRole: value.targetRole };
}

export function parseRolePinResetConfirmInput(value: unknown): RolePinResetConfirmInput {
    if (!isRecord(value)) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "角色 PIN 重設資料格式不正確。");
    }
    return {
        token: validateAccountRecoveryToken(value.token),
        newPin: validateNewRolePin(value.newPin),
    };
}

function parseRole(value: unknown): AccountRole {
    if (typeof value !== "string" || !ACCOUNT_ROLES.includes(value as AccountRole)) {
        throw new AuthInputError("INVALID_ROLE", "請選擇家長、學習者或家教身份。");
    }
    return value as AccountRole;
}

function normalizeUuid(value: unknown, label: string): string {
    if (typeof value !== "string") {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", `${label}格式不正確。`);
    }
    const normalized = value.trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(normalized)) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", `${label}格式不正確。`);
    }
    return normalized;
}

function normalizeCatalogCode(value: unknown, label: string, maxLength: number): string {
    if (typeof value !== "string") {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", `${label}格式不正確。`);
    }
    const normalized = value.normalize("NFKC").trim().toLowerCase();
    if (
        normalized.length < 1
        || normalized.length > maxLength
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized)
    ) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", `${label}格式不正確。`);
    }
    return normalized;
}

export function parseRegisterAccountInput(value: unknown): RegisterAccountInput {
    if (!isRecord(value)) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "註冊資料格式不正確。");
    }
    const displayName = normalizeName(value.displayName, "帳號稱呼");
    const role = parseRole(value.role);
    const education = parseLearnerEducationFields(value);
    return {
        displayName,
        learnerName: role === "learner"
            ? displayName
            : normalizeName(value.learnerName, "學習者稱呼"),
        email: normalizeAccountEmail(value.email),
        password: validateNewAccountPassword(value.password),
        role,
        ...education,
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

export function parseSwitchAccountRoleInput(value: unknown): SwitchAccountRoleInput {
    if (!isRecord(value)) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "角色切換資料格式不正確。");
    }

    const targetRole = parseRole(value.targetRole);
    if (targetRole === "learner") return { targetRole };

    return {
        targetRole,
        password: validateAccountPassword(value.password),
    };
}

export function parseCreateAccountLearnerInput(value: unknown): CreateAccountLearnerInput {
    if (!isRecord(value)) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "新增學習者資料格式不正確。");
    }
    const education = parseLearnerEducationFields(value);
    return {
        clientRequestId: normalizeUuid(value.clientRequestId, "請求識別碼"),
        displayName: normalizeName(value.displayName, "學習者稱呼"),
        ...education,
    };
}

export function parseUpdateAccountLearnerInput(value: unknown): UpdateAccountLearnerInput {
    if (!isRecord(value)) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "學習者設定資料格式不正確。");
    }
    const learnerId = normalizeUuid(value.learnerId, "學習者識別碼");
    if (value.action === "select") return { action: "select", learnerId };
    if (value.action !== "update" && value.action !== "update-current") {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "學習者設定動作不正確。");
    }
    const education = parseLearnerEducationFields(value);
    return {
        action: value.action,
        learnerId,
        displayName: normalizeName(value.displayName, "學習者稱呼"),
        ...education,
    };
}

export function parseUpdateLearnerSubjectSettingInput(
    value: unknown,
): UpdateLearnerSubjectSettingInput {
    if (!isRecord(value)) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "科目版本設定資料格式不正確。");
    }
    if (
        !Number.isInteger(value.lockVersion)
        || Number(value.lockVersion) < 1
        || Number(value.lockVersion) > 2_147_483_647
    ) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "科目版本設定已過期，請重新載入後再試。");
    }
    return {
        learnerId: normalizeUuid(value.learnerId, "學習者識別碼"),
        subjectCode: normalizeCatalogCode(value.subjectCode, "科目", 60),
        bookVersionId: value.bookVersionId === null
            ? null
            : normalizeUuid(value.bookVersionId, "書籍版本識別碼"),
        lockVersion: Number(value.lockVersion),
    };
}

export function parseEnableLearnerSubjectInput(value: unknown): EnableLearnerSubjectInput {
    if (!isRecord(value)) {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "新增科目資料格式不正確。");
    }
    return {
        learnerId: normalizeUuid(value.learnerId, "學習者識別碼"),
        subjectCode: normalizeCatalogCode(value.subjectCode, "科目", 60),
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
 * a loopback origin. A loopback-bound server may recover the browser-facing
 * authority from Host after a local proxy terminates TLS. All-interface bind
 * URLs are rejected because their Host and forwarding headers are not a trust
 * boundary.
 */
export function isCredentialRequestTransportAllowed(
    requestUrl: string,
    originHeader: string | null,
    hostHeader: string | null = null,
): boolean {
    const request = normalizedUrl(requestUrl);
    if (!request || !["http:", "https:"].includes(request.protocol)) return false;

    // Never infer a safe browser origin from Host while Next is reachable on
    // every interface. Host and forwarding headers are client-controlled on a
    // direct HTTP connection, so doing so would let a remote caller impersonate
    // localhost or a TLS-terminating proxy. The runtime scripts bind Next to
    // loopback before the local Tailscale Serve proxy is trusted below.
    if (isAllInterfaceHostname(request.hostname)) return false;

    const origin = originHeader === null ? null : normalizedUrl(originHeader);
    if (
        originHeader !== null
        && (
            !origin
            || origin.username
            || origin.password
            || origin.pathname !== "/"
            || origin.search
            || origin.hash
        )
    ) {
        return false;
    }

    let browserRequest = request;
    if (isLoopbackHostname(request.hostname) && hostHeader !== null) {
        const hostRequest = requestOriginFromHost(request.protocol, hostHeader);
        if (!hostRequest) return false;

        // A direct plaintext request may only name the same loopback port.
        // HTTPS may name the external authority because TLS terminates at the
        // loopback-only Tailscale Serve proxy before it reaches Next.
        if (
            request.protocol === "http:"
            && (
                !isLoopbackHostname(hostRequest.hostname)
                || hostRequest.port !== request.port
            )
        ) {
            return false;
        }
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
