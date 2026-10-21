import { parseRegisterAccountInput } from "@/app/lib/auth-input";
import { NextResponse } from "next/server";
import {
    beginEmailRegistration,
    EMAIL_REGISTRATION_COOKIE,
    EMAIL_REGISTRATION_MAX_AGE_SECONDS,
    secureCookieForRequest,
} from "@/app/lib/auth-service";
import {
    handleAuthError,
    readJsonBody,
    requireSafeCredentialTransport,
} from "../_shared";

export const runtime = "nodejs";

export async function POST(request: Request) {
    try {
        requireSafeCredentialTransport(request);
        const input = parseRegisterAccountInput(await readJsonBody(request));
        const registration = await beginEmailRegistration(input);
        const response = NextResponse.json(
            { data: { onboarding: true, email: registration.email } },
            { status: 201, headers: { "Cache-Control": "no-store" } },
        );
        response.cookies.set({
            name: EMAIL_REGISTRATION_COOKIE,
            value: registration.token,
            httpOnly: true,
            sameSite: "lax",
            secure: secureCookieForRequest(request),
            path: "/",
            maxAge: EMAIL_REGISTRATION_MAX_AGE_SECONDS,
        });
        return response;
    }
    catch (error) {
        return handleAuthError(error);
    }
}
