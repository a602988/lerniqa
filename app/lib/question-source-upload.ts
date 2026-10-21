import type { QuestionSourceRole } from "./question-source-role.ts";
import { isQuestionSourceRole } from "./question-source-role.ts";
import {
    MAX_QUESTION_SOURCE_BYTES,
    type ValidatedQuestionSource,
    validateQuestionSource,
} from "./question-source-object-store.ts";

export const MAX_QUESTION_SOURCE_FILES = 20;

const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

export type PreparedQuestionSourceUpload = {
    fileName: string;
    role: QuestionSourceRole;
    source: ValidatedQuestionSource;
};

/** 表示題目來源檔案未通過上傳邊界驗證。 */
export class QuestionSourceUploadError extends Error
{
    readonly code: string;
    readonly status: number;

    /**
     * 建立可直接轉成 API 回應的上傳錯誤。
     *
     * @param code 穩定的錯誤代碼。
     * @param message 使用者可理解的錯誤訊息。
     * @param status HTTP 狀態碼。
     */
    constructor(
        code: string,
        message: string,
        status: number,
    ) {
        super(message);
        this.code = code;
        this.name = "QuestionSourceUploadError";
        this.status = status;
    }
}

/**
 * 清理來源上傳表單中的短文字欄位。
 *
 * @param value FormData 欄位值。
 * @param maximum 允許的最大字元數。
 * @returns 合法的正規化文字，否則回傳 null。
 */
export function cleanQuestionSourceUploadField(value: FormDataEntryValue | null, maximum: number): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.normalize("NFC").trim();
    return normalized && normalized.length <= maximum && !CONTROL_PATTERN.test(normalized) ? normalized : null;
}

/**
 * 檢查 HTTP 宣告的內容長度是否可能超出來源檔案上限。
 *
 * @param request 上傳請求。
 * @param fileLimit 本次請求允許的檔案數量。
 * @returns 宣告長度超出合理範圍時回傳 true。
 */
export function isQuestionSourceUploadTooLarge(request: Request, fileLimit = MAX_QUESTION_SOURCE_FILES): boolean {
    const contentLength = Number(request.headers.get("content-length"));
    return Number.isFinite(contentLength) && contentLength > MAX_QUESTION_SOURCE_BYTES * fileLimit + 1_000_000;
}

/**
 * 驗證並讀取題目來源檔案，讓建立批次與追加檔案共用同一套邊界規則。
 *
 * @param form 已解析的 multipart 表單。
 * @param maximum 本次請求允許的檔案數量。
 * @returns 已驗證的檔名、用途與實際檔案內容。
 */
export async function prepareQuestionSourceUploads(
    form: FormData,
    maximum = MAX_QUESTION_SOURCE_FILES,
): Promise<PreparedQuestionSourceUpload[]> {
    const files = form.getAll("file");
    const roles = form.getAll("role");
    if (files.length < 1 || files.length > maximum || files.some((file) => !(file instanceof File))
        || (roles.length > 0 && roles.length !== files.length)
        || roles.some((role) => !isQuestionSourceRole(role))) {
        throw new QuestionSourceUploadError("INVALID_SOURCE_UPLOAD", "上傳資料格式不正確。", 400);
    }

    const prepared: PreparedQuestionSourceUpload[] = [];
    for (const [position, entry] of files.entries()) {
        if (!(entry instanceof File)) {
            throw new QuestionSourceUploadError("INVALID_SOURCE_UPLOAD", "上傳資料格式不正確。", 400);
        }
        const fileName = entry.name.normalize("NFC").trim();
        if (!fileName || fileName.length > 255 || CONTROL_PATTERN.test(fileName) || entry.size > MAX_QUESTION_SOURCE_BYTES) {
            throw new QuestionSourceUploadError("INVALID_SOURCE_UPLOAD", "檔名不正確，或單一檔案超過 20 MB。", 400);
        }
        const source = validateQuestionSource(Buffer.from(await entry.arrayBuffer()));
        if (!source) {
            throw new QuestionSourceUploadError(
                "UNSUPPORTED_SOURCE",
                "只接受 JPG、PNG、WebP 或 PDF；HEIC／HEIF 請先在裝置上轉存為 JPG。",
                415,
            );
        }
        const role = roles[position];
        prepared.push({ fileName, role: isQuestionSourceRole(role) ? role : "auto", source });
    }
    return prepared;
}
