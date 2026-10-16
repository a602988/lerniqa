import { NextResponse } from "next/server";
import { getAuthenticatedAccount } from "@/app/lib/auth-service";
import { handleAuthError, publicAccount } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    try {
        const account = await getAuthenticatedAccount(request);
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
            { headers: { "Cache-Control": "no-store" } },
        );
    }
    catch (error) {
        return handleAuthError(error);
    }
}
