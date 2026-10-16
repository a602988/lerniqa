import { NextResponse } from "next/server";

import { adminDataResponse, handleAdminHttpError } from "@/app/lib/admin/admin-http";
import { parseAuditListQuery } from "@/app/lib/admin/admin-input";
import { requireAdminReadContext } from "@/app/lib/admin/admin-server";
import { listAuditLogs } from "@/app/lib/admin/audit-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
    try {
        const { runner } = await requireAdminReadContext(request);
        const query = parseAuditListQuery(new URL(request.url).searchParams);
        const page = await listAuditLogs(runner, query);

        return adminDataResponse(
            { auditLogs: page.items },
            {
                page: page.page,
                pageSize: page.pageSize,
                total: page.total,
                timeZone: "Asia/Taipei",
            },
        );
    }
    catch (error) {
        return handleAdminHttpError(error);
    }
}
