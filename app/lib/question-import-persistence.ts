import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ImportQuestionDraft } from "./question-import-contract.ts";

type QueryClient = Pick<PoolClient, "query">;

export class QuestionImportStoreError extends Error
{
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status: number)
    {
        super(message);
        this.code = code;
        this.status = status;
    }
}

export async function replaceQuestionDraftItems(
    client: QueryClient,
    batchId: string,
    sourceDocumentId: string,
    questions: ImportQuestionDraft[],
): Promise<void> {
    await replaceQuestionDraftItemsBySource(client, batchId, questions.map((question) => ({ question, sourceDocumentId })));
}

export async function replaceQuestionDraftItemsBySource(
    client: QueryClient,
    batchId: string,
    questions: Array<{ question: ImportQuestionDraft; sourceDocumentId: string }>,
): Promise<void> {
    await client.query("DELETE FROM import_items WHERE import_batch_id = $1 AND review_status = 'pending'", [batchId]);
    for (const [position, item] of questions.entries()) {
        await client.query(`
            INSERT INTO import_items(
                id, import_batch_id, source_document_id, source_page,
                source_question_number, source_order, draft_payload, review_status
            ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'pending')
        `, [
            randomUUID(),
            batchId,
            item.sourceDocumentId,
            item.question.sourcePage,
            item.question.sourceQuestionNumber,
            position,
            JSON.stringify(item.question),
        ]);
    }
}
