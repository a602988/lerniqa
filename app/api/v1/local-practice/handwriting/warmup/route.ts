import { warmHandwritingOcr } from "@/app/lib/handwriting-ocr.mjs";
import {
    errorResponse,
    handleLocalPracticeError,
    localPracticeJsonResponse,
    localPracticeMeta,
    requireLocalPracticeAccount,
} from "../../_shared";

export const runtime = "nodejs";

/**
 * 在登入學習者進入手寫題時預先載入本機 OCR。
 * @param request 目前登入帳號的暖機請求。
 * @returns 本機辨識器是否已可接收作答。
 */
export async function POST(request: Request) {
    try {
        await requireLocalPracticeAccount(request);
        try {
            await warmHandwritingOcr();
            return localPracticeJsonResponse({ data: { ready: true }, meta: localPracticeMeta() });
        }
        catch {
            return errorResponse(
                "HANDWRITING_OCR_UNAVAILABLE",
                "手寫辨識預先載入失敗，送出時會再次嘗試。",
                503,
            );
        }
    }
    catch (error) {
        return handleLocalPracticeError(error);
    }
}
