import { NextResponse } from "next/server";
import { parseCompleteEmailRegistrationInput } from "@/app/lib/auth-input";
import {
    AuthServiceError,
    completeEmailRegistration,
    EMAIL_REGISTRATION_COOKIE,
    emailRegistrationTokenFromRequest,
    readEmailRegistration,
    secureCookieForRequest,
} from "@/app/lib/auth-service";
import {
    authenticatedResponse,
    handleAuthError,
    readJsonBody,
    requireSafeCredentialTransport,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearRegistrationCookie(request: Request, response: NextResponse): void {
    response.cookies.set({
        name: EMAIL_REGISTRATION_COOKIE,
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
        const registration = emailRegistrationTokenFromRequest(request)
            ? await readEmailRegistration(request)
            : null;
        return NextResponse.json(
            { data: { registration } },
            { headers: { "Cache-Control": "no-store" } },
        );
    }
    catch (error) {
        if (error instanceof AuthServiceError && error.code === "EMAIL_REGISTRATION_EXPIRED") {
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
        const input = parseCompleteEmailRegistrationInput(await readJsonBody(request));
        const issued = await completeEmailRegistration(request, input);
        const response = await authenticatedResponse(request, issued.account, issued.token, 201);
        clearRegistrationCookie(request, response);
        return response;
    }
    catch (error) {
        return handleAuthError(error);
    }
}
