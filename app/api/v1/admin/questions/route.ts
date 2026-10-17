import { NextResponse } from "next/server";

import { adminDataResponse, handleAdminHttpError } from "@/app/lib/admin/admin-http";
import { loadAdminQuestionListRequest } from "@/app/lib/admin/question-read-handler";
import {
    requireAdminReadContext,
    withAdminReadOnlySnapshot,
} from "@/app/lib/admin/admin-server";
import { listQuestions } from "@/app/lib/admin/question-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
    try {
        const page = await loadAdminQuestionListRequest(request, {
            withSnapshot: withAdminReadOnlySnapshot,
            authorize: requireAdminReadContext,
            loadPage: listQuestions,
        });

        return adminDataResponse(
            { questions: page.items },
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
