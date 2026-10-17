import { NextResponse } from "next/server";

import { adminDataResponse, handleAdminHttpError } from "@/app/lib/admin/admin-http";
import { loadAdminReportRequest } from "@/app/lib/admin/admin-report-handler";
import { getAdminReportSnapshot } from "@/app/lib/admin/report-repository";
import {
    requireAdminReadContext,
    withAdminReadOnlySnapshot,
} from "@/app/lib/admin/admin-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
    try {
        const { range, report } = await loadAdminReportRequest(request, {
            withSnapshot: withAdminReadOnlySnapshot,
            authorize: requireAdminReadContext,
            loadSnapshot: getAdminReportSnapshot,
        });

        return adminDataResponse(
            { report },
            {
                range,
                timeZone: report.range.timeZone,
                granularity: report.range.granularity,
                startLocalDate: report.range.startLocalDate,
                endLocalDate: report.range.endLocalDate,
                generatedAt: report.generatedAt,
            },
        );
    }
    catch (error) {
        return handleAdminHttpError(error);
    }
}
