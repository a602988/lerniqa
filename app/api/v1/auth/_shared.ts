import { NextResponse } from "next/server";
import {
    AUTH_SESSION_COOKIE,
    AUTH_SESSION_MAX_AGE_SECONDS,
    AuthServiceError,
    type AuthenticatedAccount,
    secureCookieForRequest,
} from "@/app/lib/auth-service";
import { AuthInputError, isCredentialRequestTransportAllowed } from "@/app/lib/auth-input";
import { LocalPostgresUnavailableError } from "@/app/lib/local-postgres";

export function authErrorResponse(code: string, message: string, status: number) {
    return NextResponse.json(
        { error: { code, message } },
        { status, headers: { "Cache-Control": "no-store" } },
    );
}

export function handleAuthError(error: unknown) {
    if (error instanceof AuthInputError || error instanceof AuthServiceError) {
        return authErrorResponse(error.code, error.message, error.status);
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

export function publicAccount(account: AuthenticatedAccount) {
    return {
        displayName: account.displayName,
        email: account.email,
        emailVerified: account.emailVerified,
        activeRole: account.activeRole,
        learner: account.learner,
        expiresAt: account.expiresAt,
    };
}

export function authenticatedResponse(
    request: Request,
    account: AuthenticatedAccount,
    token: string,
    status = 200,
) {
    const response = NextResponse.json(
        {
            data: { account: publicAccount(account) },
            meta: {
                persistence: "local-postgresql",
                emailVerification: account.emailVerified ? "verified" : "pending",
            },
        },
        { status, headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set({
        name: AUTH_SESSION_COOKIE,
        value: token,
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookieForRequest(request),
        path: "/",
        maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    });
    return response;
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
