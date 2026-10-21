import { NextResponse } from "next/server";
import { parseGoogleQuickRegistrationRequest } from "@/app/lib/auth-input";
import {
    AuthServiceError,
    completeSocialQuickRegistration,
    readSocialQuickRegistration,
    SOCIAL_QUICK_REGISTRATION_COOKIE,
    secureCookieForRequest,
    socialQuickRegistrationTokenFromRequest,
} from "@/app/lib/auth-service";
import {
    authenticatedResponse,
    handleAuthError,
    readJsonBody,
    requireSafeCredentialTransport,
} from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearRegistrationCookie(request: Request, response: NextResponse): void {
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
        const registration = socialQuickRegistrationTokenFromRequest(request)
            ? await readSocialQuickRegistration(request)
            : null;
        return NextResponse.json(
            { data: { registration } },
            { headers: { "Cache-Control": "no-store" } },
        );
    }
    catch (error) {
        if (error instanceof AuthServiceError && error.code === "SOCIAL_REGISTRATION_EXPIRED") {
            const response = NextResponse.json(
                { data: { registration: null } },
                { headers: { "Cache-Control": "no-store" } },
            );
            clearRegistrationCookie(request, response);
            return response;
        }
        return handleAuthError(error);
    }
}

export async function POST(request: Request) {
    try {
        requireSafeCredentialTransport(request);
        const input = parseGoogleQuickRegistrationRequest(await readJsonBody(request));
        if (input.action !== "complete") {
            return NextResponse.json({ error: { message: "要求格式不正確。" } }, { status: 400 });
        }
        const issued = await completeSocialQuickRegistration(request, input.registration);
        const response = await authenticatedResponse(request, issued.account, issued.token, 201);
        clearRegistrationCookie(request, response);
        return response;
    }
    catch (error) {
        return handleAuthError(error);
    }
}
