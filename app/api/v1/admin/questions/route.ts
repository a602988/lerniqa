import { NextResponse } from "next/server";

import { adminDataResponse, handleAdminHttpError } from "@/app/lib/admin/admin-http";
import { parseQuestionListQuery } from "@/app/lib/admin/admin-input";
import { requireAdminReadContext } from "@/app/lib/admin/admin-server";
import { listQuestions } from "@/app/lib/admin/question-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
    try {
        const { runner } = await requireAdminReadContext(request);
        const query = parseQuestionListQuery(new URL(request.url).searchParams);
        const page = await listQuestions(runner, query);

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
