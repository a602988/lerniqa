import { NextResponse } from "next/server";
import { getAuthenticatedAccount } from "@/app/lib/auth-service";
import { handleAuthError, publicAccount } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    try {
        const account = await getAuthenticatedAccount(request);
        return NextResponse.json(
            {
                data: { account: publicAccount(account) },
                meta: {
                    persistence: "local-postgresql",
                    emailVerification: account.emailVerified ? "verified" : "pending",
                },
            },
            { headers: { "Cache-Control": "no-store" } },
        );
    }
    catch (error) {
        return handleAuthError(error);
    }
}
