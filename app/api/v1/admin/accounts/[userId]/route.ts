import { NextResponse } from "next/server";

import { getAccountDetail } from "@/app/lib/admin/account-repository";
import { adminDataResponse, handleAdminHttpError } from "@/app/lib/admin/admin-http";
import { parseUuid } from "@/app/lib/admin/admin-input";
import { requireAdminReadContext } from "@/app/lib/admin/admin-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AccountRouteContext {
    params: Promise<{ userId: string }>;
}

export async function GET(
    request: Request,
    context: AccountRouteContext,
): Promise<NextResponse> {
    try {
        const { runner } = await requireAdminReadContext(request);
        const { userId: rawUserId } = await context.params;
        const userId = parseUuid(rawUserId, "帳號識別碼");
        const account = await getAccountDetail(runner, userId);

        return adminDataResponse({ account });
    }
    catch (error) {
        return handleAdminHttpError(error);
    }
}
