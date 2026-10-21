import { NextResponse } from "next/server";
import { listRememberedAccounts } from "@/app/lib/auth-service";
import { handleAuthError } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    try {
        const accounts = await listRememberedAccounts(request);
        return NextResponse.json(
            { data: { accounts } },
            { headers: { "Cache-Control": "no-store" } },
        );
    }
    catch (error) {
        return handleAuthError(error);
    }
}
