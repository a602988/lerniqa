import { NextResponse } from "next/server";
import {
    AUTH_SESSION_COOKIE,
    AUTH_SESSION_MAX_AGE_SECONDS,
    AUTH_DEVICE_COOKIE,
    AUTH_DEVICE_MAX_AGE_SECONDS,
    AuthServiceError,
    type AuthenticatedAccount,
    type LearnerCheckMode,
    secureCookieForRequest,
    rememberAuthenticatedAccount,
} from "@/app/lib/auth-service";
import { AuthInputError, isCredentialRequestTransportAllowed } from "@/app/lib/auth-input";
import { EmailVerificationError } from "@/app/lib/email-verification";
import { AccountRecoveryError } from "@/app/lib/account-recovery";
import { LocalPostgresUnavailableError } from "@/app/lib/local-postgres";
import { MailServiceError } from "@/app/lib/mail/synology-mailplus";

export function authErrorResponse(code: string, message: string, status: number) {
    return NextResponse.json(
        { error: { code, message } },
        { status, headers: { "Cache-Control": "no-store" } },
    );
}

export function handleAuthError(error: unknown) {
    if (
        error instanceof AuthInputError
        || error instanceof AuthServiceError
        || error instanceof EmailVerificationError
        || error instanceof AccountRecoveryError
    ) {
        return authErrorResponse(error.code, error.message, error.status);
    }
    if (error instanceof MailServiceError) {
        return authErrorResponse(
            error.code,
            error.code === "MAIL_NOT_CONFIGURED"
                ? "驗證信目前無法寄出，請稍後再試。"
                : error.message,
            error.status,
        );
    }
    if (error instanceof LocalPostgresUnavailableError) {
        return authErrorResponse(
            "AUTH_DATABASE_UNAVAILABLE",
            "帳號資料庫目前無法使用，請稍後再試。",
            503,
        );
    }
    console.error("Account API failed", error);
    return authErrorResponse("AUTH_FAILED", "帳號服務目前無法完成要求。", 500);
}

export function requireSafeCredentialTransport(request: Request): void {
    if (!isCredentialRequestTransportAllowed(
        request.url,
        request.headers.get("origin"),
        request.headers.get("host"),
    )) {
        throw new AuthServiceError(
            "INSECURE_CREDENTIAL_TRANSPORT",
            "密碼只可在這台電腦的 localhost 或 HTTPS 頁面輸入。",
            403,
        );
    }
}

export async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    }
    catch {
        throw new AuthInputError("INVALID_ACCOUNT_INPUT", "帳號資料格式不正確。");
    }
}

export interface PublicLearnerProfile {
    id: string;
    displayName: string;
    educationStatus: AuthenticatedAccount["learner"]["educationStatus"];
    gradeCode: string | null;
    gradeName: string | null;
    semesterCode: string | null;
    semesterName: string | null;
    accessRole: AuthenticatedAccount["learner"]["accessRole"];
    canCreatePlans: boolean;
    canManageSettings: boolean;
    isSelf: boolean;
    preferences: {
        questionLimitOptions: number[];
        defaultQuestionLimit: number;
        defaultCheckMode: LearnerCheckMode;
    } | null;
    subjectSettings: Array<{
        position: number;
        lockVersion: number;
        subject: {
            code: string;
            name: string;
        };
        bookVersion: {
            id: string;
            name: string;
            publisher: {
                code: string;
                name: string;
            } | null;
        } | null;
        availableBookVersions: Array<{
            id: string;
            name: string;
            publisher: {
                code: string;
                name: string;
            } | null;
        }>;
    }>;
    availableSubjects: Array<{ code: string; name: string }>;
}

export interface PublicAccount {
    displayName: string;
    email: string | null;
    emailVerified: boolean | null;
    accountRole: AuthenticatedAccount["accountRole"];
    activeRole: AuthenticatedAccount["activeRole"];
    roles: AuthenticatedAccount["roles"];
    learner: PublicLearnerProfile;
    learners: PublicLearnerProfile[];
    expiresAt: string;
}

function publicLearnerProfile(
    learner: AuthenticatedAccount["learner"],
): PublicLearnerProfile {
    return {
        id: learner.id,
        displayName: learner.displayName,
        educationStatus: learner.educationStatus,
        gradeCode: learner.gradeCode,
        gradeName: learner.gradeName,
        semesterCode: learner.semesterCode,
        semesterName: learner.semesterName,
        accessRole: learner.accessRole,
        canCreatePlans: learner.canCreatePlans,
        canManageSettings: learner.canManageSettings,
        isSelf: learner.isSelf,
        preferences: learner.preferences === null
            ? null
            : {
                questionLimitOptions: [...learner.preferences.questionLimitOptions],
                defaultQuestionLimit: learner.preferences.defaultQuestionLimit,
                defaultCheckMode: learner.preferences.defaultCheckMode,
            },
        subjectSettings: learner.subjectSettings.map((setting) => ({
            position: setting.position,
            lockVersion: setting.lockVersion,
            subject: {
                code: setting.subject.code,
                name: setting.subject.name,
            },
            bookVersion: setting.bookVersion === null
                ? null
                : {
                    id: setting.bookVersion.id,
                    name: setting.bookVersion.name,
                    publisher: setting.bookVersion.publisher === null
                        ? null
                        : {
                            code: setting.bookVersion.publisher.code,
                            name: setting.bookVersion.publisher.name,
                        },
                },
            availableBookVersions: setting.availableBookVersions.map((bookVersion) => ({
                id: bookVersion.id,
                name: bookVersion.name,
                publisher: bookVersion.publisher === null
                    ? null
                    : {
                        code: bookVersion.publisher.code,
                        name: bookVersion.publisher.name,
                    },
            })),
        })),
        availableSubjects: learner.availableSubjects.map((subject) => ({ ...subject })),
    };
}

export function publicAccount(account: AuthenticatedAccount): PublicAccount {
    const managedLearnerMode = account.activeRole === "learner"
        && (account.accountRole === "parent" || account.accountRole === "tutor");
    const learnerScopedMode = account.activeRole === "learner";
    const currentLearner = publicLearnerProfile(account.learner);
    return {
        displayName: account.displayName,
        email: managedLearnerMode ? null : account.email,
        emailVerified: managedLearnerMode ? null : account.emailVerified,
        accountRole: account.accountRole,
        activeRole: account.activeRole,
        roles: [...account.roles],
        learner: currentLearner,
        learners: learnerScopedMode
            ? [currentLearner]
            : account.learners.map(publicLearnerProfile),
        expiresAt: account.expiresAt,
    };
}

export function accountResponse(account: AuthenticatedAccount, status = 200) {
    const exposedAccount = publicAccount(account);
    return NextResponse.json(
        {
            data: { account: exposedAccount },
            meta: {
                persistence: "local-postgresql",
                emailVerification: exposedAccount.emailVerified === null
                    ? "hidden"
                    : exposedAccount.emailVerified ? "verified" : "pending",
            },
        },
        { status, headers: { "Cache-Control": "no-store" } },
    );
}

export async function authenticatedResponse(
    request: Request,
    account: AuthenticatedAccount,
    token: string,
    status = 200,
) {
    const response = accountResponse(account, status);
    setAuthSessionCookie(request, response, token);
    const deviceToken = await rememberAuthenticatedAccount(request, account.userId);
    setAuthDeviceCookie(request, response, deviceToken);
    return response;
}

export async function setAuthenticatedCookies(
    request: Request,
    response: NextResponse,
    account: AuthenticatedAccount,
    token: string,
): Promise<void> {
    setAuthSessionCookie(request, response, token);
    const deviceToken = await rememberAuthenticatedAccount(request, account.userId);
    setAuthDeviceCookie(request, response, deviceToken);
}

function setAuthDeviceCookie(request: Request, response: NextResponse, token: string): void {
    response.cookies.set({
        name: AUTH_DEVICE_COOKIE,
        value: token,
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookieForRequest(request),
        path: "/",
        maxAge: AUTH_DEVICE_MAX_AGE_SECONDS,
    });
}

export function setAuthSessionCookie(
    request: Request,
    response: NextResponse,
    token: string,
): void {
    response.cookies.set({
        name: AUTH_SESSION_COOKIE,
        value: token,
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookieForRequest(request),
        path: "/",
        maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    });
}

export function clearSessionCookie(request: Request, response: NextResponse): void {
    response.cookies.set({
        name: AUTH_SESSION_COOKIE,
        value: "",
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookieForRequest(request),
        path: "/",
        maxAge: 0,
    });
}
