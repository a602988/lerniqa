import { NextResponse } from "next/server";
import {
    beginSocialQuickRegistration,
    AuthServiceError,
    consumeSocialOAuthAttempt,
    SOCIAL_OAUTH_ATTEMPT_COOKIE,
    SOCIAL_OAUTH_NONCE_COOKIE,
    SOCIAL_QUICK_REGISTRATION_COOKIE,
    SOCIAL_QUICK_REGISTRATION_MAX_AGE_SECONDS,
    secureCookieForRequest,
    type RedirectIdentityProvider,
} from "@/app/lib/auth-service";
import { verifySocialAuthorization } from "@/app/lib/social-identity";
import { setAuthenticatedCookies } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function providerFromRoute(value: string): RedirectIdentityProvider | null {
    return value === "line" || value === "facebook" ? value : null;
}

function clearOAuthCookies(request: Request, response: NextResponse): void {
    for (const name of [SOCIAL_OAUTH_ATTEMPT_COOKIE, SOCIAL_OAUTH_NONCE_COOKIE]) {
        response.cookies.set({
            name,
            value: "",
            httpOnly: true,
            sameSite: "lax",
            secure: secureCookieForRequest(request),
            path: "/",
            maxAge: 0,
        });
    }
}

function failureRedirect(request: Request, message: string): NextResponse {
    const url = new URL("/quick-register", request.url);
    url.searchParams.set("error", message);
    return NextResponse.redirect(url);
}

export async function GET(
    request: Request,
    context: { params: Promise<{ provider: string }> },
) {
    let response: NextResponse;
    try {
        const provider = providerFromRoute((await context.params).provider);
        if (!provider) {
            response = failureRedirect(request, "不支援的快速註冊方式。");
            clearOAuthCookies(request, response);
            return response;
        }
        const url = new URL(request.url);
        if (url.searchParams.get("error")) {
            response = failureRedirect(request, "你已取消快速註冊。");
            clearOAuthCookies(request, response);
            return response;
        }
        const state = url.searchParams.get("state") ?? "";
        const code = url.searchParams.get("code") ?? "";
        const nonce = await consumeSocialOAuthAttempt(request, provider, state);
        const identity = await verifySocialAuthorization(request, provider, code, nonce);
        const result = await beginSocialQuickRegistration(provider, identity);
        if (result.kind === "authenticated") {
            response = NextResponse.redirect(new URL("/overview", request.url));
            await setAuthenticatedCookies(request, response, result.issued.account, result.issued.token);
        }
        else {
            response = NextResponse.redirect(new URL("/quick-register", request.url));
            response.cookies.set({
                name: SOCIAL_QUICK_REGISTRATION_COOKIE,
                value: result.token,
                httpOnly: true,
                sameSite: "lax",
                secure: secureCookieForRequest(request),
                path: "/",
                maxAge: SOCIAL_QUICK_REGISTRATION_MAX_AGE_SECONDS,
            });
        }
    }
    catch (error) {
        const message = error instanceof AuthServiceError
            ? error.message
            : "快速註冊失敗，請重新操作。";
        response = failureRedirect(request, message);
    }
    clearOAuthCookies(request, response);
    return response;
}
