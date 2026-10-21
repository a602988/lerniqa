import { getAuthenticatedAccount, AuthServiceError } from "@/app/lib/auth-service";
import { getAccountPlanUsage } from "@/app/lib/account-plan-service";
import { LocalPostgresUnavailableError } from "@/app/lib/local-postgres";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns the authenticated account's enforced plan and current usage. */
export async function GET(request: Request) {
    try {
        const account = await getAuthenticatedAccount(request);
        const usage = await getAccountPlanUsage(account.userId);
        return NextResponse.json({ data: usage }, {
            headers: { "Cache-Control": "private, no-store" },
        });
    }
    catch (error) {
        if (error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            const status = error instanceof AuthServiceError ? error.status : 503;
            return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
        }
        console.error("Account plan API failed", error);
        return NextResponse.json({ error: { code: "PLAN_USAGE_FAILED", message: "目前無法讀取方案額度。" } }, { status: 500 });
    }
}
