import { NextResponse } from "next/server";

import { listAccounts } from "@/app/lib/admin/account-repository";
import { adminDataResponse, handleAdminHttpError } from "@/app/lib/admin/admin-http";
import { parseAccountListQuery } from "@/app/lib/admin/admin-input";
import { requireAdminReadContext } from "@/app/lib/admin/admin-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
    try {
        const { runner } = await requireAdminReadContext(request);
        const query = parseAccountListQuery(new URL(request.url).searchParams);
        const page = await listAccounts(runner, query);

        return adminDataResponse(
            { accounts: page.items },
            {
                page: page.page,
                pageSize: page.pageSize,
                total: page.total,
            },
        );
    }
    catch (error) {
        return handleAdminHttpError(error);
    }
}
