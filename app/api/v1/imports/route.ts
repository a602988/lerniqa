import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { PoolClient, QueryResultRow } from "pg";
import { AuthServiceError, getAuthenticatedAccount } from "@/app/lib/auth-service";
import { getAccountPlanUsageInTransaction } from "@/app/lib/account-plan-service";
import { LocalPostgresUnavailableError, withLocalPostgresTransaction } from "@/app/lib/local-postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImportQuestion = { prompt: string; answer: string; subject: string; grade: string; semester: string; source: string; questionNumber: string };
type ImportRequest = { fileNames: string[]; book: { name: string; learnerId: string }; questions: ImportQuestion[] };

class ImportError extends Error {
    constructor(readonly code: string, message: string, readonly status: number) {
        super(message);
    }
}

function clean(value: unknown, maximum: number): string | null {
    if (typeof value !== "string") return null;
    const result = value.normalize("NFC").trim();
    return result && result.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(result) ? result : null;
}

function parseRequest(value: unknown): ImportRequest | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const book = row.book && typeof row.book === "object" && !Array.isArray(row.book) ? row.book as Record<string, unknown> : null;
    if (!book || !Array.isArray(row.fileNames) || !Array.isArray(row.questions) || row.questions.length < 1 || row.questions.length > 100) return null;
    const name = clean(book.name, 120);
    const learnerId = clean(book.learnerId, 36);
    if (!name || !learnerId) return null;
    const questions = row.questions.flatMap((entry): ImportQuestion[] => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const item = entry as Record<string, unknown>;
        const prompt = clean(item.prompt, 10000);
        const answer = clean(item.answer, 10000);
        const subject = clean(item.subject, 120);
        const grade = clean(item.grade, 80);
        if (!prompt || !answer || !subject || !grade) return [];
        return [{ prompt, answer, subject, grade, semester: clean(item.semester, 80) ?? "", source: clean(item.source, 160) ?? "自建題目", questionNumber: clean(item.questionNumber, 80) ?? "" }];
    });
    return questions.length === row.questions.length ? { fileNames: row.fileNames.filter((item): item is string => Boolean(clean(item, 255))), book: { name, learnerId }, questions } : null;
}

async function catalogId(client: PoolClient, sql: string, values: unknown[], label: string): Promise<string> {
    const result = await client.query<{ id: string } & QueryResultRow>(sql, values);
    const id = result.rows[0]?.id;
    if (!id) throw new ImportError("IMPORT_CATALOG_MISMATCH", `找不到「${label}」對應的正式分類。`, 409);
    return id;
}

async function writeImport(client: PoolClient, input: ImportRequest, userId: string): Promise<number> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`owned-questions:${userId}`]);
    const usage = await getAccountPlanUsageInTransaction(client, userId);
    const limit = usage.ownedQuestions.limit;
    if (limit !== null && usage.ownedQuestions.used + input.questions.length > limit) {
        throw new ImportError("OWNED_QUESTION_LIMIT_REACHED", `免費方案最多保留 ${limit} 題；本次最多還能匯入 ${Math.max(0, limit - usage.ownedQuestions.used)} 題。`, 409);
    }
    const access = await client.query(`SELECT 1 FROM learner_access WHERE user_id=$1 AND learner_id=$2 AND accepted_at IS NOT NULL AND revoked_at IS NULL`, [userId, input.book.learnerId]);
    if (!access.rows.length) throw new ImportError("IMPORT_LEARNER_DENIED", "目前帳號不能替這位學習者匯入題目。", 403);
    const bank = await client.query<{ id: string } & QueryResultRow>(`INSERT INTO question_banks(id,name,origin,owner_user_id,is_default) VALUES($1,$2,'account',$3,true) ON CONFLICT(owner_user_id) WHERE origin='account' AND status='active' AND is_default=true DO UPDATE SET updated_at=transaction_timestamp() RETURNING id`, [randomUUID(), input.book.name, userId]);
    const bankId = bank.rows[0]!.id;
    await client.query(`INSERT INTO question_bank_learners(question_bank_id,learner_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [bankId, input.book.learnerId]);
    const sourceId = randomUUID();
    const title = input.fileNames.join("、").slice(0, 255) || "貼上文字";
    await client.query(`INSERT INTO source_documents(id,owner_user_id,input_type,pasted_text,document_title,status) VALUES($1,$2,'text',$3,$4,'ready')`, [sourceId, userId, input.questions.map((item) => `${item.prompt}\n${item.answer}`).join("\n\n"), title]);
    const batchId = randomUUID();
    await client.query(`INSERT INTO import_batches(id,question_bank_id,learner_id,created_by_user_id,status,idempotency_key,confirmed_at) VALUES($1,$2,$3,$4,'confirmed',$1::text,transaction_timestamp())`, [batchId, bankId, input.book.learnerId, userId]);
    await client.query(`INSERT INTO import_batch_documents(import_batch_id,source_document_id,position) VALUES($1,$2,0)`, [batchId, sourceId]);
    const typeId = await catalogId(client, `SELECT id FROM question_types WHERE status='active' ORDER BY (code='written') DESC,id LIMIT 1`, [], "文字作答題型");
    for (const [position, item] of input.questions.entries()) {
        const subjectId = await catalogId(client, `SELECT id FROM subjects WHERE name=$1 AND subject_kind='leaf' AND status='active' ORDER BY id LIMIT 1`, [item.subject], item.subject);
        const gradeId = await catalogId(client, `SELECT id FROM grades WHERE name=$1 AND status='active' ORDER BY id LIMIT 1`, [item.grade], item.grade);
        const semesterId = item.semester ? await catalogId(client, `SELECT id FROM semesters WHERE name=$1 AND status='active' ORDER BY id LIMIT 1`, [item.semester], item.semester) : null;
        const questionId = randomUUID(); const revisionId = randomUUID(); const partId = randomUUID(); const importItemId = randomUUID();
        await client.query(`INSERT INTO questions(id,origin,owner_user_id,status,created_method,created_by_user_id) VALUES($1,'account',$2,'published','import',$2)`, [questionId, userId]);
        await client.query(`INSERT INTO question_revisions(id,question_id,revision_number,question_type_id,subject_id,grade_id,semester_id,search_text,status,created_by_type,created_by_user_id,published_at) VALUES($1,$2,1,$3,$4,$5,$6,$7,'published','user',$8,transaction_timestamp())`, [revisionId, questionId, typeId, subjectId, gradeId, semesterId, `${item.prompt} ${item.source}`, userId]);
        await client.query(`UPDATE questions SET current_revision_id=$2 WHERE id=$1`, [questionId, revisionId]);
        await client.query(`INSERT INTO question_parts(id,question_revision_id,stable_key,position,answer_mode,grading_policy) VALUES($1,$2,'main',0,'text','automatic')`, [partId, revisionId]);
        await client.query(`INSERT INTO question_content_blocks(id,question_revision_id,question_part_id,placement,content_type,position,text_content) VALUES($1,$2,$3,'prompt','text',0,$4),($5,$2,$3,'answer','text',0,$6)`, [randomUUID(), revisionId, partId, item.prompt, randomUUID(), item.answer]);
        await client.query(`INSERT INTO question_answers(id,question_part_id,accepted_value) VALUES($1,$2,$3)`, [randomUUID(), partId, item.answer]);
        await client.query(`INSERT INTO question_bank_items(question_bank_id,question_id,added_by_user_id) VALUES($1,$2,$3)`, [bankId, questionId, userId]);
        await client.query(`INSERT INTO import_items(id,import_batch_id,source_document_id,source_question_number,source_order,draft_payload,review_status,question_id,question_revision_id,reviewed_by_user_id,reviewed_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,'approved',$7,$8,$9,transaction_timestamp())`, [importItemId, batchId, sourceId, item.questionNumber || null, position, JSON.stringify(item), questionId, revisionId, userId]);
        await client.query(`INSERT INTO question_revision_sources(id,question_revision_id,source_document_id,import_item_id,source_question_number) VALUES($1,$2,$3,$4,$5)`, [randomUUID(), revisionId, sourceId, importItemId, item.questionNumber || null]);
    }
    return input.questions.length;
}

/** Imports reviewed account-owned text questions atomically. */
export async function POST(request: Request) {
    try {
        const account = await getAuthenticatedAccount(request);
        const input = parseRequest(await request.json());
        if (!input) throw new ImportError("INVALID_IMPORT_REQUEST", "匯入內容格式不正確，或單次超過 100 題。", 400);
        const importedCount = await withLocalPostgresTransaction((client) => writeImport(client, input, account.userId));
        return NextResponse.json({ data: { importedCount } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        if (error instanceof ImportError || error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            const status = error instanceof LocalPostgresUnavailableError ? 503 : error.status;
            return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
        }
        console.error("Question import failed", error);
        return NextResponse.json({ error: { code: "IMPORT_FAILED", message: "題目匯入失敗，未寫入任何題目。" } }, { status: 500 });
    }
}
