import { NextResponse } from "next/server";

import { adminDataResponse, handleAdminHttpError } from "@/app/lib/admin/admin-http";
import { parseQuestionDetailQuery, parseUuid } from "@/app/lib/admin/admin-input";
import { requireAdminReadContext } from "@/app/lib/admin/admin-server";
import { getQuestionDetail } from "@/app/lib/admin/question-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface QuestionRouteContext {
    params: Promise<{ questionId: string }>;
}

export async function GET(
    request: Request,
    context: QuestionRouteContext,
): Promise<NextResponse> {
    try {
        const { runner } = await requireAdminReadContext(request);
        const { questionId: rawQuestionId } = await context.params;
        const questionId = parseUuid(rawQuestionId, "題目識別碼");
        const query = parseQuestionDetailQuery(new URL(request.url).searchParams);
        const question = await getQuestionDetail(runner, questionId, query);

        return adminDataResponse({ question });
    }
    catch (error) {
        return handleAdminHttpError(error);
    }
}
