import { NextResponse } from "next/server";
import { parseGoogleQuickRegistrationRequest } from "@/app/lib/auth-input";
import {
    beginSocialQuickRegistration,
    SOCIAL_QUICK_REGISTRATION_COOKIE,
    SOCIAL_QUICK_REGISTRATION_MAX_AGE_SECONDS,
    AuthServiceError,
    socialQuickRegistrationTokenFromRequest,
    readSocialQuickRegistration,
    secureCookieForRequest,
} from "@/app/lib/auth-service";
import { googleOAuthClientId, verifyGoogleCredential } from "@/app/lib/google-identity";
import {
    authenticatedResponse,
    handleAuthError,
    readJsonBody,
    requireSafeCredentialTransport,
} from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearGoogleRegistrationCookie(request: Request, response: NextResponse): void {
    response.cookies.set({
        name: SOCIAL_QUICK_REGISTRATION_COOKIE,
        value: "",
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookieForRequest(request),
        path: "/",
        maxAge: 0,
    });
}

export async function GET(request: Request) {
    try {
        const clientId = googleOAuthClientId();
        let registration = null;
        if (socialQuickRegistrationTokenFromRequest(request)) {
            try {
                registration = await readSocialQuickRegistration(request);
            }
            catch (error) {
                if (!(error instanceof AuthServiceError)) throw error;
                if (error.code !== "SOCIAL_REGISTRATION_EXPIRED") throw error;
            }
        }
        return NextResponse.json(
            { data: { clientId, registration } },
            { headers: { "Cache-Control": "no-store" } },
        );
    }
    catch (error) {
        return handleAuthError(error);
    }
}

export async function POST(request: Request) {
    try {
        requireSafeCredentialTransport(request);
        const input = parseGoogleQuickRegistrationRequest(await readJsonBody(request));
        if (input.action !== "credential") {
            return NextResponse.json({ error: { message: "要求格式不正確。" } }, { status: 400 });
        }
        const identity = await verifyGoogleCredential(input.credential);
        const result = await beginSocialQuickRegistration("google", identity);
        if (result.kind === "authenticated") {
            const response = await authenticatedResponse(
                request,
                result.issued.account,
                result.issued.token,
            );
            clearGoogleRegistrationCookie(request, response);
            return response;
        }

        const response = NextResponse.json(
            { data: { registration: result.profile } },
            { headers: { "Cache-Control": "no-store" } },
        );
        response.cookies.set({
            name: SOCIAL_QUICK_REGISTRATION_COOKIE,
            value: result.token,
            httpOnly: true,
            sameSite: "lax",
            secure: secureCookieForRequest(request),
            path: "/",
            maxAge: SOCIAL_QUICK_REGISTRATION_MAX_AGE_SECONDS,
        });
        return response;
    }
    catch (error) {
        return handleAuthError(error);
    }
}
