import { NextResponse } from "next/server";

import { adminDataResponse, handleAdminHttpError } from "@/app/lib/admin/admin-http";
import { loadAdminQuestionDetailRequest } from "@/app/lib/admin/question-read-handler";
import {
    requireAdminReadContext,
    withAdminReadOnlySnapshot,
} from "@/app/lib/admin/admin-server";
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
        const question = await loadAdminQuestionDetailRequest(
            request,
            () => context.params,
            {
                withSnapshot: withAdminReadOnlySnapshot,
                authorize: requireAdminReadContext,
                loadDetail: getQuestionDetail,
            },
        );

        return adminDataResponse({ question });
    }
    catch (error) {
        return handleAdminHttpError(error);
    }
}
