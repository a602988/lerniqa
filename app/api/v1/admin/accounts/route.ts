import { NextResponse } from "next/server";

import { listAccounts } from "@/app/lib/admin/account-repository";
import { loadAdminAccountListRequest } from "@/app/lib/admin/admin-account-handler";
import { adminDataResponse, handleAdminHttpError } from "@/app/lib/admin/admin-http";
import {
    requireAdminReadContext,
    withAdminReadOnlySnapshot,
} from "@/app/lib/admin/admin-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
    try {
        const { page } = await loadAdminAccountListRequest(request, {
            withSnapshot: withAdminReadOnlySnapshot,
            authorize: requireAdminReadContext,
            list: listAccounts,
        });

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
