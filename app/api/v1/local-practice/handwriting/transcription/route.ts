import {
    MAX_HANDWRITING_BYTES,
    validateHandwritingPngDataUrl,
} from "@/app/lib/handwriting-png";
import { transcribeLocalHandwriting } from "@/app/lib/handwriting-transcription.mjs";
import {
    errorResponse,
    handleLocalPracticeError,
    isRecord,
    localPracticeJsonResponse,
    localPracticeMeta,
    requireLocalPracticeAccount,
} from "../../_shared";

export const runtime = "nodejs";

/**
 * 辨識尚未送出的手寫內容，不保存影像或變更正式作答。
 * @param request 含手寫 PNG data URL 的登入請求。
 * @returns 清楚辨識的文字或無法辨識狀態。
 */
export async function POST(request: Request) {
    try {
        await requireLocalPracticeAccount(request);
        let body: unknown;
        try {
            body = await request.json();
        }
        catch {
            return errorResponse("INVALID_HANDWRITING_REQUEST", "手寫辨識資料格式不正確。", 400);
        }
        if (
            !isRecord(body)
            || !isRecord(body.handwriting)
            || typeof body.handwriting.dataUrl !== "string"
            || body.handwriting.dataUrl.length > Math.ceil(MAX_HANDWRITING_BYTES * 4 / 3) + 64
        ) {
            return errorResponse("INVALID_HANDWRITING_REQUEST", "手寫辨識資料格式不正確。", 400);
        }
        const handwriting = validateHandwritingPngDataUrl(body.handwriting.dataUrl);
        if (!handwriting) {
            return errorResponse("INVALID_HANDWRITING", "手寫板沒有有效筆跡，請先書寫後再分析。", 400);
        }
        try {
            const result = await transcribeLocalHandwriting(handwriting.bytes);
            return localPracticeJsonResponse({
                data: {
                    transcription: result.transcription,
                    legibility: result.legibility,
                },
                meta: localPracticeMeta(),
            });
        }
        catch {
            return errorResponse(
                "HANDWRITING_AI_UNAVAILABLE",
                "本機 AI 目前無法使用，可直接送出並等待人工批改。",
                503,
            );
        }
    }
    catch (error) {
        return handleLocalPracticeError(error);
    }
}
