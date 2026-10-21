import { NextResponse } from "next/server";
import {
    createSocialOAuthAttempt,
    SOCIAL_OAUTH_ATTEMPT_COOKIE,
    SOCIAL_OAUTH_MAX_AGE_SECONDS,
    SOCIAL_OAUTH_NONCE_COOKIE,
    secureCookieForRequest,
    type RedirectIdentityProvider,
} from "@/app/lib/auth-service";
import { socialAuthorizationUrl } from "@/app/lib/social-identity";
import { handleAuthError, requireSafeCredentialTransport } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function providerFromRoute(value: string): RedirectIdentityProvider | null {
    return value === "line" || value === "facebook" ? value : null;
}

export async function GET(
    request: Request,
    context: { params: Promise<{ provider: string }> },
) {
    try {
        requireSafeCredentialTransport(request);
        const provider = providerFromRoute((await context.params).provider);
        if (!provider) return NextResponse.json({ error: { message: "不支援的快速註冊方式。" } }, { status: 404 });
        const attempt = await createSocialOAuthAttempt(provider);
        const response = NextResponse.redirect(socialAuthorizationUrl(
            request,
            provider,
            attempt.state,
            attempt.nonce,
        ));
        response.cookies.set({
            name: SOCIAL_OAUTH_ATTEMPT_COOKIE,
            value: attempt.token,
            httpOnly: true,
            sameSite: "lax",
            secure: secureCookieForRequest(request),
            path: "/",
            maxAge: SOCIAL_OAUTH_MAX_AGE_SECONDS,
        });
        if (attempt.nonce) {
            response.cookies.set({
                name: SOCIAL_OAUTH_NONCE_COOKIE,
                value: attempt.nonce,
                httpOnly: true,
                sameSite: "lax",
                secure: secureCookieForRequest(request),
                path: "/",
                maxAge: SOCIAL_OAUTH_MAX_AGE_SECONDS,
            });
        }
        return response;
    }
    catch (error) {
        return handleAuthError(error);
    }
}
