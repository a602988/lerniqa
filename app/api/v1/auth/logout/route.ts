import { NextResponse } from "next/server";
import { logoutAccount } from "@/app/lib/auth-service";
import { clearSessionCookie, handleAuthError } from "../_shared";

export const runtime = "nodejs";

export async function POST(request: Request) {
    try {
        await logoutAccount(request);
        const response = NextResponse.json(
            { data: { loggedOut: true } },
            { headers: { "Cache-Control": "no-store" } },
        );
        clearSessionCookie(request, response);
        return response;
    }
    catch (error) {
        return handleAuthError(error);
    }
}
