import { NextResponse } from "next/server";
import { AuthServiceError, getAuthenticatedAccount } from "@/app/lib/auth-service";
import { LocalPostgresUnavailableError, withLocalPostgresReadTransaction, withLocalPostgresTransaction } from "@/app/lib/local-postgres";
import {
    getQuestionSourceAnalysisState,
    queueQuestionSourceAnalysis,
    QuestionImportStoreError,
} from "@/app/lib/question-import-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function errorResponse(code: string, message: string, status: number) {
    return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function parseCorners(value: unknown): Record<string, Array<{ x: number; y: number }>> | null {
    if (value === undefined) return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const result: Record<string, Array<{ x: number; y: number }>> = {};
    for (const [page, points] of Object.entries(value)) {
        if (!/^[1-9]\d*$/u.test(page) || !Array.isArray(points) || points.length !== 4) return null;
        const parsed = points.flatMap((point): Array<{ x: number; y: number }> => (
            point && typeof point === "object" && !Array.isArray(point)
                && Object.keys(point).length === 2 && "x" in point && "y" in point
                && typeof point.x === "number" && typeof point.y === "number"
                && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
                ? [{ x: point.x, y: point.y }]
                : []
        ));
        if (parsed.length !== 4) return null;
        result[page] = parsed;
    }
    return result;
}

export async function GET(request: Request, context: { params: Promise<{ batchId: string }> }) {
    try {
        const account = await getAuthenticatedAccount(request);
        const { batchId } = await context.params;
        if (!UUID_PATTERN.test(batchId)) return errorResponse("IMPORT_SOURCE_JOB_NOT_FOUND", "找不到這次圖片分析工作。", 404);
        const state = await withLocalPostgresReadTransaction((client) => getQuestionSourceAnalysisState(client, batchId.toLowerCase(), account.userId));
        return NextResponse.json({ data: state }, { headers: { "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        if (error instanceof QuestionImportStoreError || error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            return errorResponse(error.code, error.message, error instanceof LocalPostgresUnavailableError ? 503 : error.status);
        }
        console.error("Question source job read failed", error);
        return errorResponse("SOURCE_JOB_READ_FAILED", "無法讀取圖片分析狀態。", 500);
    }
}

export async function POST(request: Request, context: { params: Promise<{ batchId: string }> }) {
    try {
        const account = await getAuthenticatedAccount(request);
        const { batchId } = await context.params;
        if (!UUID_PATTERN.test(batchId)) return errorResponse("IMPORT_SOURCE_BATCH_NOT_FOUND", "找不到這次掃描匯入。", 404);
        const body = await request.json().catch(() => ({})) as { analyze?: unknown; corners?: unknown; dewarp?: unknown };
        const corners = parseCorners(body.corners);
        if (!corners || (body.dewarp !== undefined && typeof body.dewarp !== "boolean")
            || (body.analyze !== undefined && typeof body.analyze !== "boolean")) {
            return errorResponse("INVALID_SCAN_SETTINGS", "頁面角點或展平設定格式不正確。", 400);
        }
        const state = await withLocalPostgresTransaction((client) => queueQuestionSourceAnalysis(client, batchId.toLowerCase(), {
            analyze: body.analyze !== false,
            corners,
            dewarp: body.dewarp !== false,
        }, account.userId));
        return NextResponse.json({ data: state }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        if (error instanceof QuestionImportStoreError || error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            return errorResponse(error.code, error.message, error instanceof LocalPostgresUnavailableError ? 503 : error.status);
        }
        console.error("Question source job creation failed", error);
        return errorResponse("SOURCE_JOB_CREATE_FAILED", "無法建立圖片分析工作。", 500);
    }
}
