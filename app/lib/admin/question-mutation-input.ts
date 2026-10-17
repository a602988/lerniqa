import type {
    CreateSystemQuestionDraftInput,
    PublishSystemQuestionRevisionInput,
    ReviewSystemQuestionRevisionInput,
} from "./question-mutation-service.ts";
import { AdminApiError } from "./admin-types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function invalid(message: string): never {
    throw new AdminApiError("INVALID_QUESTION_REVISION", message, 400);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(
    value: Record<string, unknown>,
    keys: readonly string[],
    label: string,
): void {
    const expected = new Set(keys);
    const actual = Object.keys(value);
    if (
        actual.length !== expected.size
        || actual.some((key) => !expected.has(key))
    ) {
        invalid(`${label}含有缺少或不支援的欄位。`);
    }
}

function parseUuid(value: unknown, label: string): string {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        invalid(`${label}格式不正確。`);
    }
    return value.toLowerCase();
}

function parsePositiveInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2_147_483_647) {
        invalid(`${label}必須是正整數。`);
    }
    return Number(value);
}

function parseString(value: unknown, label: string): string {
    if (typeof value !== "string") invalid(`${label}格式不正確。`);
    return value;
}

function parseNullableString(value: unknown, label: string): string | null {
    if (value === null) return null;
    return parseString(value, label);
}

function parseContentPatch(
    value: unknown,
): CreateSystemQuestionDraftInput["contentPatch"] {
    if (!isPlainRecord(value)) invalid("題目內容編修資料格式不正確。");
    assertExactKeys(value, ["textBlocks", "answers"], "題目內容編修資料");
    if (!Array.isArray(value.textBlocks) || !Array.isArray(value.answers)) {
        invalid("題目內容編修清單格式不正確。");
    }

    const textBlocks = value.textBlocks.map((entry) => {
        if (!isPlainRecord(entry)) invalid("文字內容編修資料格式不正確。");
        assertExactKeys(entry, ["blockId", "textContent"], "文字內容編修資料");
        return {
            blockId: parseUuid(entry.blockId, "文字內容識別碼"),
            textContent: parseString(entry.textContent, "文字內容"),
        };
    });
    const answers = value.answers.map((entry) => {
        if (!isPlainRecord(entry)) invalid("答案編修資料格式不正確。");
        assertExactKeys(
            entry,
            ["answerId", "answerKey", "acceptedValue"],
            "答案編修資料",
        );
        return {
            answerId: parseUuid(entry.answerId, "答案識別碼"),
            answerKey: parseNullableString(entry.answerKey, "答案選項鍵"),
            acceptedValue: parseNullableString(entry.acceptedValue, "文字答案"),
        };
    });

    if (textBlocks.length + answers.length === 0) {
        invalid("建立新版本時至少要編修一段文字或一個答案。");
    }
    return { textBlocks, answers };
}

export function parseCreateQuestionDraftInput(
    body: Readonly<Record<string, unknown>>,
    rawQuestionId: unknown,
): CreateSystemQuestionDraftInput {
    assertExactKeys(
        body as Record<string, unknown>,
        ["baseRevisionId", "baseRevisionNumber", "changeNote", "contentPatch"],
        "題目草稿",
    );
    return {
        questionId: parseUuid(rawQuestionId, "題目識別碼"),
        baseRevisionId: parseUuid(body.baseRevisionId, "基準版本識別碼"),
        baseRevisionNumber: parsePositiveInteger(body.baseRevisionNumber, "基準版本號"),
        changeNote: parseString(body.changeNote, "修改原因"),
        contentPatch: parseContentPatch(body.contentPatch),
    };
}

export function parseReviewQuestionRevisionInput(
    body: Readonly<Record<string, unknown>>,
    rawQuestionId: unknown,
    rawRevisionId: unknown,
): ReviewSystemQuestionRevisionInput {
    assertExactKeys(
        body as Record<string, unknown>,
        ["expectedRevisionNumber", "decision", "reason"],
        "題目審核",
    );
    if (body.decision !== "changes_requested" && body.decision !== "rejected") {
        invalid("題目審核決定不正確。");
    }
    return {
        questionId: parseUuid(rawQuestionId, "題目識別碼"),
        revisionId: parseUuid(rawRevisionId, "題目版本識別碼"),
        expectedRevisionNumber: parsePositiveInteger(
            body.expectedRevisionNumber,
            "預期版本號",
        ),
        decision: body.decision,
        reason: parseString(body.reason, "審核原因"),
    };
}

export function parsePublishQuestionRevisionInput(
    body: Readonly<Record<string, unknown>>,
    rawQuestionId: unknown,
    rawRevisionId: unknown,
): PublishSystemQuestionRevisionInput {
    assertExactKeys(
        body as Record<string, unknown>,
        ["expectedCurrentRevisionId", "expectedCurrentRevisionNumber", "changeNote"],
        "題目發布",
    );
    return {
        questionId: parseUuid(rawQuestionId, "題目識別碼"),
        draftRevisionId: parseUuid(rawRevisionId, "草稿版本識別碼"),
        expectedCurrentRevisionId: parseUuid(
            body.expectedCurrentRevisionId,
            "預期目前版本識別碼",
        ),
        expectedCurrentRevisionNumber: parsePositiveInteger(
            body.expectedCurrentRevisionNumber,
            "預期目前版本號",
        ),
        changeNote: parseString(body.changeNote, "修改原因"),
    };
}
