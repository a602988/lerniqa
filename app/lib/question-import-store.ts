import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { getAccountPlanUsageInTransaction } from "./account-plan-service";
import { QuestionImportStoreError, replaceQuestionDraftItems } from "./question-import-persistence.ts";
import type { QuestionSourceRole, QuestionSourceRoleSource } from "./question-source-role.ts";
import {
    parseQuestionDraftPackage,
    type ImportContentBlock,
    type ImportPartDraft,
    type ImportQuestionDraft,
    type QuestionDraftPackage,
    type QuestionImportPackage,
} from "./question-import-contract";

export { QuestionImportStoreError } from "./question-import-persistence.ts";

export interface QuestionImportResult {
    batchId: string;
    importedCount: number;
    replayed: boolean;
}

export interface QuestionSourceBatchInput {
    analyze: boolean;
    idempotencyKey: string;
    learnerId: string;
    sources: Array<{
        asset: {
            byteSize: number;
            checksum: string;
            id: string;
            mimeType: string;
            storageKey: string;
        };
        fileName: string;
        role: QuestionSourceRole;
    }>;
}

export interface QuestionSourceAppendInput {
    sources: QuestionSourceBatchInput["sources"];
}

export interface QuestionDraftInput {
    draft: QuestionDraftPackage;
    idempotencyKey: string;
    learnerId: string;
}

export interface QuestionDraftSourceAsset {
    fileName: string;
    id: string;
    mimeType: string;
    position: number;
    role: QuestionSourceRole;
    roleConfidence: number | null;
    roleReason: string | null;
    roleSource: QuestionSourceRoleSource;
    sourceDocumentId: string;
    url: string;
}

export interface QuestionDraftRecord extends QuestionDraftPackage {
    batchId: string;
    createdAt: string;
    idempotencyKey: string;
    inputType: "image" | "pdf" | "text";
    learnerId: string;
    sourceAssets: QuestionDraftSourceAsset[];
    status: "draft" | "recognizing" | "review" | "failed";
}

export interface QuestionSourceAnalysisSettings {
    analyze: boolean;
    corners: Record<string, Array<{ x: number; y: number }>>;
    dewarp: boolean;
}

export interface QuestionSourceAnalysisState {
    batchId: string;
    errorCode: string | null;
    result: unknown;
    status: "queued" | "retry" | "running" | "completed" | "failed";
}

interface CatalogRow extends QueryResultRow {
    book_version_id: string | null;
    curriculum_unit_id: string | null;
    grade_id: string | null;
    question_type_id: string | null;
    semester_id: string | null;
    source_category_id: string | null;
    subject_id: string;
}

interface ExistingBatchRow extends QueryResultRow {
    id: string;
    status: string;
    item_count: number;
}

function contentSearchText(blocks: ImportContentBlock[]): string {
    return blocks.flatMap((block) => {
        if (block.kind === "text") return [block.text];
        if (block.kind === "formula") return [block.tex];
        if (block.kind === "table") return block.rows.flat();
        return [block.alt];
    }).join(" ");
}

function tableText(rows: string[][]): string {
    return rows.map((row) => row.join("\t")).join("\n");
}

async function requireLearnerAccess(client: PoolClient, learnerId: string, userId: string): Promise<void> {
    const access = await client.query(`
        SELECT 1
        FROM learner_access
        WHERE learner_id = $1
          AND user_id = $2
          AND accepted_at IS NOT NULL
          AND revoked_at IS NULL
    `, [learnerId, userId]);
    if (!access.rows.length) throw new QuestionImportStoreError("IMPORT_LEARNER_DENIED", "目前帳號不能替這位學習者新增題目。", 403);
}

async function requireQuota(client: PoolClient, userId: string, count: number): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`owned-questions:${userId}`]);
    const usage = await getAccountPlanUsageInTransaction(client, userId);
    if (usage.ownedQuestions.limit !== null && usage.ownedQuestions.used + count > usage.ownedQuestions.limit) {
        const remaining = Math.max(0, usage.ownedQuestions.limit - usage.ownedQuestions.used);
        throw new QuestionImportStoreError(
            "OWNED_QUESTION_LIMIT_REACHED",
            `免費方案最多保留 ${usage.ownedQuestions.limit} 題；本次最多還能新增 ${remaining} 題。`,
            409,
        );
    }
}

async function requireCatalog(
    client: PoolClient,
    input: QuestionImportPackage["catalog"],
    questions: ImportQuestionDraft[],
    userId: string,
): Promise<string> {
    const result = await client.query<CatalogRow>(`
        SELECT subject.id AS subject_id,
               grade.id AS grade_id,
               semester.id AS semester_id,
               version.id AS book_version_id,
               source.id AS source_category_id,
               type.id AS question_type_id,
               unit.id AS curriculum_unit_id
        FROM subjects AS subject
        LEFT JOIN grades AS grade
          ON grade.id = $2
         AND grade.status = 'active'
        LEFT JOIN question_types AS type
          ON type.id = $7
         AND type.status = 'active'
        LEFT JOIN semesters AS semester
          ON semester.id = $3
         AND semester.status = 'active'
        LEFT JOIN book_versions AS version
          ON version.id = $4
         AND version.status = 'active'
         AND version.subject_id = subject.id
         AND version.grade_id = grade.id
         AND (version.origin = 'system' OR version.owner_user_id = $8)
        LEFT JOIN difficulty_levels AS difficulty
          ON difficulty.id = $5
         AND difficulty.status = 'active'
        LEFT JOIN source_categories AS source
          ON source.id = $6
         AND source.status = 'active'
         AND (source.origin = 'system' OR source.owner_user_id = $8)
        LEFT JOIN curriculum_units AS unit
          ON unit.id = $9
         AND unit.status = 'active'
         AND unit.subject_id = subject.id
         AND (unit.origin = 'system' OR unit.owner_user_id = $8)
         AND ($2::uuid IS NULL OR unit.grade_id IS NULL OR unit.grade_id = $2)
         AND ($3::uuid IS NULL OR unit.semester_id IS NULL OR unit.semester_id = $3)
         AND ($4::uuid IS NULL OR unit.book_version_id IS NULL OR unit.book_version_id = $4)
        WHERE subject.id = $1
          AND subject.subject_kind = 'leaf'
          AND subject.status = 'active'
          AND (subject.origin = 'system' OR subject.owner_user_id = $8)
          AND ($2::uuid IS NULL OR grade.id IS NOT NULL)
          AND ($3::uuid IS NULL OR semester.id IS NOT NULL)
          AND ($4::uuid IS NULL OR version.id IS NOT NULL)
          AND ($5::uuid IS NULL OR difficulty.id IS NOT NULL)
          AND ($6::uuid IS NULL OR source.id IS NOT NULL)
          AND ($9::uuid IS NULL OR unit.id IS NOT NULL)
    `, [
        input.subjectId,
        input.gradeId,
        input.semesterId,
        input.bookVersionId,
        input.difficultyLevelId,
        input.sourceCategoryId,
        input.questionTypeId,
        userId,
        input.curriculumUnitId,
    ]);
    if (!result.rows.length) {
        throw new QuestionImportStoreError("IMPORT_CATALOG_MISMATCH", "題目的科目或選填分類不相容，或不屬於目前帳號。", 409);
    }
    const requestedType = result.rows[0]?.question_type_id;
    if (requestedType) return requestedType;
    const hasParts = questions.some((question) => question.parts.length > 1);
    const hasWritten = questions.some((question) => question.parts.some((part) => part.answerMode === "text"));
    const preferredCodes = hasParts
        ? ["multi-choice", "written", "single-choice", "single_choice"]
        : hasWritten
            ? ["written", "text", "single-choice", "single_choice"]
            : ["single-choice", "single_choice", "multi-choice", "written"];
    const derived = await client.query<{ id: string } & QueryResultRow>(`
        SELECT id
        FROM question_types
        WHERE status = 'active'
        ORDER BY array_position($1::text[], code), supports_parts DESC, id
        LIMIT 1
    `, [preferredCodes]);
    const questionTypeId = derived.rows[0]?.id;
    if (!questionTypeId) throw new QuestionImportStoreError("IMPORT_QUESTION_TYPE_UNAVAILABLE", "目前沒有可用的正式題型。", 409);
    return questionTypeId;
}

async function requireQuestionClassifications(
    client: PoolClient,
    questions: ImportQuestionDraft[],
    subjectId: string,
    userId: string,
): Promise<void> {
    const selections = questions.flatMap((question) => question.classifications.flatMap((classification) =>
        classification.optionIds.map((optionId) => ({
            draftKey: question.draftKey,
            fieldId: classification.fieldId,
            optionId,
        }))));
    if (!selections.length) return;
    const allowed = await client.query<{
        field_id: string;
        option_id: string;
        selection_mode: "single" | "multiple";
    } & QueryResultRow>(`
        SELECT DISTINCT field.id AS field_id,
               option.id AS option_id,
               field.selection_mode
        FROM filter_fields AS field
        JOIN filter_field_options AS option
          ON option.filter_field_id = field.id
         AND option.status = 'active'
        JOIN filter_field_scopes AS scope
          ON scope.filter_field_id = field.id
         AND scope.status = 'active'
        JOIN filter_field_scope_subjects AS subject_scope
          ON subject_scope.filter_field_scope_id = scope.id
         AND subject_scope.subject_id = $1
         AND subject_scope.effect = 'include'
        WHERE field.status = 'active'
          AND field.value_type = 'option'
          AND field.origin = 'account'
          AND field.owner_user_id = $2
    `, [subjectId, userId]);
    const allowedOptions = new Map(allowed.rows.map((row) => [`${row.field_id}:${row.option_id}`, row.selection_mode]));
    for (const selection of selections) {
        if (!allowedOptions.has(`${selection.fieldId}:${selection.optionId}`)) {
            throw new QuestionImportStoreError("IMPORT_CLASSIFICATION_DENIED", "部分題目分類不存在、不適用於這個科目，或不屬於目前帳號。", 403);
        }
    }
    for (const question of questions) {
        for (const classification of question.classifications) {
            const mode = allowedOptions.get(`${classification.fieldId}:${classification.optionIds[0]}`);
            if (mode === "single" && classification.optionIds.length > 1) {
                throw new QuestionImportStoreError("IMPORT_CLASSIFICATION_CARDINALITY", "單選分類只能指定一個選項。", 409);
            }
        }
    }
}

function collectAssetIds(questions: ImportQuestionDraft[]): string[] {
    const ids = new Set<string>();
    const collect = (blocks: ImportContentBlock[]) => {
        for (const block of blocks) {
            if (block.kind === "image" || block.kind === "page_crop") ids.add(block.assetId);
        }
    };
    for (const question of questions) {
        collect(question.sharedPrompt);
        for (const part of question.parts) {
            collect(part.prompt);
            for (const hint of part.hints) collect(hint);
            collect(part.explanation);
            for (const option of part.options) collect(option.blocks);
        }
    }
    return [...ids];
}

function findCropAssetId(question: ImportQuestionDraft): string | null {
    const blocks = [
        ...question.sharedPrompt,
        ...question.parts.flatMap((part) => [
            ...part.prompt,
            ...part.hints.flat(),
            ...part.explanation,
            ...part.options.flatMap((option) => option.blocks),
        ]),
    ];
    return blocks.find((block) => block.kind === "page_crop")?.assetId ?? null;
}

async function requireAssets(client: PoolClient, questions: ImportQuestionDraft[], userId: string): Promise<void> {
    const assetIds = collectAssetIds(questions);
    if (!assetIds.length) return;
    const result = await client.query<{ id: string } & QueryResultRow>(`
        SELECT id
        FROM assets
        WHERE id = ANY($1::uuid[])
          AND created_by_user_id = $2
          AND purpose IN ('question_content', 'page_crop')
          AND scan_status = 'clean'
          AND deleted_at IS NULL
    `, [assetIds, userId]);
    if (result.rows.length !== assetIds.length) {
        throw new QuestionImportStoreError("IMPORT_ASSET_DENIED", "部分圖片不存在、尚未通過檢查，或不屬於目前帳號。", 403);
    }
}

async function ensureDefaultBank(client: PoolClient, userId: string, learnerId: string): Promise<string> {
    const result = await client.query<{ id: string } & QueryResultRow>(`
        INSERT INTO question_banks(id, name, origin, owner_user_id, is_default)
        VALUES($1, '我的題庫', 'account', $2, true)
        ON CONFLICT(owner_user_id)
        WHERE origin = 'account' AND status = 'active' AND is_default = true
        DO UPDATE SET updated_at = transaction_timestamp()
        RETURNING id
    `, [randomUUID(), userId]);
    const bankId = result.rows[0]!.id;
    await client.query(`
        INSERT INTO question_bank_learners(question_bank_id, learner_id)
        VALUES($1, $2)
        ON CONFLICT DO NOTHING
    `, [bankId, learnerId]);
    return bankId;
}

async function ensureLearnerSubject(client: PoolClient, learnerId: string, subjectId: string): Promise<void> {
    await client.query(`
        INSERT INTO learner_subject_settings(
            id, learner_id, subject_id, book_version_id,
            enabled, is_default_subject, position
        ) VALUES(
            $1,$2,$3,NULL,true,false,
            COALESCE((SELECT max(position) + 1 FROM learner_subject_settings WHERE learner_id=$2),0)
        )
        ON CONFLICT(learner_id,subject_id) DO UPDATE
        SET enabled=true,
            position=CASE WHEN learner_subject_settings.enabled THEN learner_subject_settings.position ELSE EXCLUDED.position END,
            lock_version=learner_subject_settings.lock_version+1,
            updated_at=transaction_timestamp()
    `, [randomUUID(), learnerId, subjectId]);
}

export async function createQuestionDraft(
    client: PoolClient,
    input: QuestionDraftInput,
    userId: string,
): Promise<QuestionDraftRecord> {
    await requireLearnerAccess(client, input.learnerId, userId);
    await requireAssets(client, input.draft.questions, userId);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`question-draft:${userId}:${input.idempotencyKey}`]);
    const existing = await client.query<{ id: string } & QueryResultRow>(`
        SELECT id FROM import_batches
        WHERE created_by_user_id = $1 AND idempotency_key = $2
    `, [userId, input.idempotencyKey]);
    if (existing.rows.length) {
        const draft = (await listQuestionDrafts(client, userId)).find((item) => item.batchId === existing.rows[0]!.id);
        const sameDraft = draft
            && draft.learnerId === input.learnerId
            && JSON.stringify({ schemaVersion: draft.schemaVersion, sourceTitle: draft.sourceTitle, questions: draft.questions }) === JSON.stringify(input.draft);
        if (sameDraft) return draft;
        throw new QuestionImportStoreError("IMPORT_IDEMPOTENCY_CONFLICT", "相同識別碼已用於另一份題目草稿。", 409);
    }
    const bankId = await ensureDefaultBank(client, userId, input.learnerId);
    const sourceDocumentId = randomUUID();
    await client.query(`
        INSERT INTO source_documents(
            id, owner_user_id, input_type, pasted_text, document_title, status
        ) VALUES($1,$2,'text',$3,$4,'ready')
    `, [sourceDocumentId, userId, JSON.stringify(input.draft), input.draft.sourceTitle]);
    const batchId = randomUUID();
    const batch = await client.query<{ created_at: Date | string } & QueryResultRow>(`
        INSERT INTO import_batches(
            id, question_bank_id, learner_id, created_by_user_id,
            status, idempotency_key, recognizer_version
        ) VALUES($1,$2,$3,$4,'review',$5,'lerniqa-draft-v2')
        RETURNING created_at
    `, [batchId, bankId, input.learnerId, userId, input.idempotencyKey]);
    await client.query(`
        INSERT INTO import_batch_documents(import_batch_id, source_document_id, position)
        VALUES($1,$2,0)
    `, [batchId, sourceDocumentId]);
    await replaceQuestionDraftItems(client, batchId, sourceDocumentId, input.draft.questions);
    return {
        ...input.draft,
        batchId,
        idempotencyKey: input.idempotencyKey,
        inputType: "text",
        learnerId: input.learnerId,
        sourceAssets: [],
        status: "review",
        createdAt: new Date(batch.rows[0]!.created_at).toISOString(),
    };
}

export async function saveQuestionDraft(
    client: PoolClient,
    batchId: string,
    draft: QuestionDraftPackage,
    userId: string,
): Promise<void> {
    await requireAssets(client, draft.questions, userId);
    const result = await client.query<{ source_document_id: string } & QueryResultRow>(`
        SELECT link.source_document_id
        FROM import_batches AS batch
        JOIN import_batch_documents AS link
          ON link.import_batch_id = batch.id
         AND link.position = 0
        WHERE batch.id = $1
          AND batch.created_by_user_id = $2
          AND batch.status IN ('draft', 'review', 'failed')
        FOR UPDATE OF batch
    `, [batchId, userId]);
    const sourceDocumentId = result.rows[0]?.source_document_id;
    if (!sourceDocumentId) throw new QuestionImportStoreError("IMPORT_DRAFT_NOT_FOUND", "找不到這份題目草稿。", 404);
    const activeAnalysis = await client.query(`
        SELECT 1
        FROM question_source_analysis_jobs
        WHERE import_batch_id = $1 AND status IN ('queued', 'retry', 'running')
        LIMIT 1
    `, [batchId]);
    if (activeAnalysis.rowCount) {
        throw new QuestionImportStoreError("IMPORT_SOURCE_BATCH_BUSY", "背景分析尚未完成，請稍後再編輯。", 409);
    }
    await replaceQuestionDraftItems(client, batchId, sourceDocumentId, draft.questions);
    await client.query(`
        UPDATE source_documents
        SET document_title = $2,
            pasted_text = CASE WHEN input_type = 'text' THEN $3 ELSE NULL END,
            status = 'ready'
        WHERE id = $1 AND owner_user_id = $4
    `, [sourceDocumentId, draft.sourceTitle, JSON.stringify(draft), userId]);
    await client.query("UPDATE import_batches SET status = 'review' WHERE id = $1", [batchId]);
}

export async function listQuestionDrafts(client: PoolClient, userId: string): Promise<QuestionDraftRecord[]> {
    const result = await client.query<{
        batch_id: string;
        created_at: Date | string;
        document_title: string;
        draft_payload: unknown;
        idempotency_key: string;
        input_type: QuestionDraftRecord["inputType"];
        learner_id: string;
        asset_id: string | null;
        asset_mime_type: string | null;
        document_position: number;
        document_role: QuestionSourceRole;
        original_file_name: string | null;
        role_confidence: string | number | null;
        role_reason: string | null;
        role_source: QuestionSourceRoleSource;
        source_document_id: string;
        status: QuestionDraftRecord["status"];
    } & QueryResultRow>(`
        SELECT batch.id AS batch_id,
               batch.created_at,
               batch.idempotency_key,
               batch.learner_id,
               batch.status,
               document.document_title,
               document.input_type,
               document.original_file_name,
               document.id AS source_document_id,
               link.position AS document_position,
               link.document_role,
               link.role_source,
               link.role_confidence,
               link.role_reason,
               source_asset.id AS asset_id,
               source_asset.mime_type AS asset_mime_type,
               item.draft_payload
        FROM import_batches AS batch
        JOIN import_batch_documents AS link
          ON link.import_batch_id = batch.id
        JOIN source_documents AS document ON document.id = link.source_document_id
        LEFT JOIN assets AS source_asset
          ON source_asset.id = document.asset_id
         AND source_asset.created_by_user_id = batch.created_by_user_id
         AND source_asset.purpose = 'source_document'
         AND source_asset.scan_status = 'clean'
         AND source_asset.deleted_at IS NULL
        LEFT JOIN import_items AS item
          ON item.import_batch_id = batch.id
         AND item.source_document_id = link.source_document_id
         AND item.review_status = 'pending'
        WHERE batch.created_by_user_id = $1
          AND document.owner_user_id = $1
          AND batch.status IN ('draft', 'recognizing', 'review', 'failed')
        ORDER BY batch.created_at DESC, batch.id, link.position, item.source_order NULLS LAST
    `, [userId]);
    const grouped = new Map<string, QuestionDraftRecord>();
    for (const row of result.rows) {
        let current = grouped.get(row.batch_id);
        if (!current) {
            current = {
                batchId: row.batch_id,
                createdAt: new Date(row.created_at).toISOString(),
                idempotencyKey: row.idempotency_key,
                inputType: row.input_type,
                learnerId: row.learner_id,
                questions: [],
                schemaVersion: 2,
                sourceAssets: [],
                sourceTitle: row.document_title,
                status: row.status,
            };
            grouped.set(row.batch_id, current);
        }
        if (row.asset_id && row.asset_mime_type && !current.sourceAssets.some((asset) => asset.id === row.asset_id)) {
            current.sourceAssets.push({
                fileName: row.original_file_name ?? row.document_title,
                id: row.asset_id,
                mimeType: row.asset_mime_type,
                position: row.document_position,
                role: row.document_role,
                roleConfidence: row.role_confidence === null ? null : Number(row.role_confidence),
                roleReason: row.role_reason,
                roleSource: row.role_source,
                sourceDocumentId: row.source_document_id,
                url: `/api/v1/question-import-assets/${row.asset_id}`,
            });
            current.sourceAssets.sort((left, right) => left.position - right.position);
        }
        if (row.draft_payload === null) continue;
        const payload = row.draft_payload && typeof row.draft_payload === "object" && !Array.isArray(row.draft_payload)
            ? row.draft_payload as Record<string, unknown>
            : {};
        const parsed = parseQuestionDraftPackage({
            schemaVersion: "draftKey" in payload ? 2 : 1,
            sourceTitle: row.document_title,
            questions: [row.draft_payload],
        });
        if (!parsed.ok) continue;
        current.questions.push(parsed.value.questions[0]!);
    }
    return [...grouped.values()];
}

export async function cancelQuestionDraft(client: PoolClient, batchId: string, userId: string): Promise<void> {
    await client.query(`
        UPDATE question_source_analysis_jobs
        SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL,
            finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE import_batch_id = $1 AND status IN ('queued', 'retry')
    `, [batchId]);
    const result = await client.query(`
        UPDATE import_batches
        SET status = 'cancelled'
        WHERE id = $1
          AND created_by_user_id = $2
          AND status IN ('draft', 'review', 'failed')
        RETURNING id
    `, [batchId, userId]);
    if (!result.rowCount) throw new QuestionImportStoreError("IMPORT_DRAFT_NOT_FOUND", "找不到這份題目草稿。", 404);
}

export async function updateQuestionSourceRoles(
    client: PoolClient,
    batchId: string,
    roles: Array<{ sourceDocumentId: string; role: QuestionSourceRole }>,
    userId: string,
): Promise<void> {
    const documents = await client.query<{ source_document_id: string } & QueryResultRow>(`
        SELECT link.source_document_id
        FROM import_batches AS batch
        JOIN import_batch_documents AS link ON link.import_batch_id = batch.id
        WHERE batch.id = $1
          AND batch.created_by_user_id = $2
          AND batch.status IN ('draft', 'review', 'failed')
        ORDER BY link.position
        FOR UPDATE OF batch, link
    `, [batchId, userId]);
    const expected = documents.rows.map((row) => row.source_document_id);
    const received = roles.map((role) => role.sourceDocumentId);
    if (!expected.length || expected.length !== received.length || expected.some((id) => !received.includes(id))) {
        throw new QuestionImportStoreError("IMPORT_SOURCE_ROLE_MISMATCH", "來源圖片清單已變更，請重新整理後再設定。", 409);
    }
    const active = await client.query(`
        SELECT 1
        FROM question_source_analysis_jobs
        WHERE import_batch_id = $1 AND status IN ('queued', 'retry', 'running')
        LIMIT 1
    `, [batchId]);
    if (active.rowCount) {
        throw new QuestionImportStoreError("IMPORT_SOURCE_BATCH_BUSY", "背景分析尚未完成，請稍後再調整圖片用途。", 409);
    }
    for (const source of roles) {
        await client.query(`
            UPDATE import_batch_documents
            SET document_role = $3::varchar(20),
                role_source = CASE WHEN $3::varchar(20) = 'auto' THEN 'pending' ELSE 'user' END,
                role_confidence = NULL,
                role_reason = NULL
            WHERE import_batch_id = $1 AND source_document_id = $2
        `, [batchId, source.sourceDocumentId, source.role]);
    }
}

/**
 * 將新的圖片或 PDF 追加到既有草稿，並在同一交易中排入整份草稿的重新分析工作。
 *
 * @param client 目前資料庫交易的連線。
 * @param batchId 要追加來源的匯入批次。
 * @param input 已驗證的檔案資產與本次操作識別碼。
 * @param userId 目前登入的帳號。
 * @returns 更新後的來源總數，以及本次是否為重送。
 */
export async function appendQuestionSourceBatch(
    client: PoolClient,
    batchId: string,
    input: QuestionSourceAppendInput,
    userId: string,
): Promise<{ batchId: string; replayed: boolean; sourceCount: number }> {
    if (input.sources.length < 1 || input.sources.length > 20) {
        throw new QuestionImportStoreError("INVALID_SOURCE_UPLOAD", "每次必須選擇 1 至 20 個來源檔案。", 400);
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`question-source-batch:${batchId}`]);
    const batch = await client.query<{ status: string } & QueryResultRow>(`
        SELECT status
        FROM import_batches
        WHERE id = $1 AND created_by_user_id = $2
        FOR UPDATE
    `, [batchId, userId]);
    const status = batch.rows[0]?.status;
    if (!status) throw new QuestionImportStoreError("IMPORT_SOURCE_BATCH_NOT_FOUND", "找不到這份題目草稿。", 404);
    if (status === "confirmed" || status === "cancelled") {
        throw new QuestionImportStoreError("IMPORT_SOURCE_BATCH_CLOSED", "這份草稿已結束，不能再新增原始檔案。", 409);
    }
    const documents = await client.query<{
        asset_id: string;
        checksum: string;
        document_role: QuestionSourceRole;
        original_file_name: string;
        position: number;
    } & QueryResultRow>(`
        SELECT document.asset_id, asset.checksum, link.document_role,
               document.original_file_name, link.position
        FROM import_batch_documents AS link
        JOIN source_documents AS document ON document.id = link.source_document_id
        JOIN assets AS asset ON asset.id = document.asset_id
        WHERE link.import_batch_id = $1
        ORDER BY link.position
        FOR UPDATE OF link, document, asset
    `, [batchId]);
    const appended = input.sources.map((source) => documents.rows.find((document) => document.asset_id === source.asset.id));
    if (appended.every(Boolean)) {
        const matches = appended.every((document, position) => document
            && document.checksum === input.sources[position]!.asset.checksum
            && document.document_role === input.sources[position]!.role
            && document.original_file_name === input.sources[position]!.fileName);
        if (!matches) {
            throw new QuestionImportStoreError("IMPORT_IDEMPOTENCY_CONFLICT", "相同識別碼已用於另一組來源檔案。", 409);
        }
        return { batchId, replayed: true, sourceCount: documents.rows.length };
    }
    if (appended.some(Boolean)) {
        throw new QuestionImportStoreError("IMPORT_IDEMPOTENCY_CONFLICT", "這次追加檔案只有部分完成，請重新整理草稿。", 409);
    }
    const active = await client.query(`
        SELECT 1
        FROM question_source_analysis_jobs
        WHERE import_batch_id = $1 AND status IN ('queued', 'retry', 'running')
        LIMIT 1
    `, [batchId]);
    if (active.rowCount) {
        throw new QuestionImportStoreError("IMPORT_SOURCE_BATCH_BUSY", "背景分析尚未完成，請稍後再新增圖片。", 409);
    }
    const occupiedAssets = await client.query<{ id: string } & QueryResultRow>(`
        SELECT id
        FROM assets
        WHERE id = ANY($1::uuid[])
    `, [input.sources.map((source) => source.asset.id)]);
    if (occupiedAssets.rowCount) {
        throw new QuestionImportStoreError("IMPORT_IDEMPOTENCY_CONFLICT", "相同識別碼已用於另一組來源檔案。", 409);
    }
    if (documents.rows.length + input.sources.length > 20) {
        throw new QuestionImportStoreError("IMPORT_SOURCE_LIMIT_REACHED", "每份草稿最多可保留 20 個原始檔案。", 409);
    }

    for (const [offset, source] of input.sources.entries()) {
        await client.query(`
            INSERT INTO assets(
                id, storage_key, mime_type, byte_size, checksum, purpose,
                sensitivity, scan_status, created_by_user_id
            ) VALUES($1,$2,$3,$4,$5,'source_document','private','clean',$6)
        `, [source.asset.id, source.asset.storageKey, source.asset.mimeType, source.asset.byteSize, source.asset.checksum, userId]);
        const sourceDocumentId = randomUUID();
        const inputType = source.asset.mimeType === "application/pdf" ? "pdf" : "image";
        await client.query(`
            INSERT INTO source_documents(
                id, owner_user_id, asset_id, input_type, original_file_name,
                document_title, status
            ) VALUES($1,$2,$3,$4,$5,$5,'uploaded')
        `, [sourceDocumentId, userId, source.asset.id, inputType, source.fileName]);
        const roleSource: QuestionSourceRoleSource = source.role === "auto" ? "pending" : "user";
        await client.query(`
            INSERT INTO import_batch_documents(
                import_batch_id, source_document_id, position,
                document_role, role_source
            ) VALUES($1,$2,$3,$4,$5)
        `, [batchId, sourceDocumentId, documents.rows.length + offset, source.role, roleSource]);
    }
    await client.query("UPDATE import_batches SET status = 'draft' WHERE id = $1", [batchId]);
    await client.query(`
        UPDATE source_documents AS document
        SET status = 'uploaded'
        FROM import_batch_documents AS link
        WHERE link.import_batch_id = $1
          AND link.source_document_id = document.id
    `, [batchId]);
    await client.query(`
        INSERT INTO question_source_analysis_jobs(
            id, import_batch_id, analyze_questions, settings, status
        ) VALUES($1,$2,true,$3::jsonb,'queued')
    `, [randomUUID(), batchId, JSON.stringify({ dewarp: true, corners: {} })]);
    return { batchId, replayed: false, sourceCount: documents.rows.length + input.sources.length };
}

export async function createQuestionSourceBatch(
    client: PoolClient,
    input: QuestionSourceBatchInput,
    userId: string,
): Promise<{ batchId: string; replayed: boolean }> {
    await requireLearnerAccess(client, input.learnerId, userId);
    if (input.sources.length < 1 || input.sources.length > 20) {
        throw new QuestionImportStoreError("INVALID_SOURCE_UPLOAD", "每次必須選擇 1 至 20 個來源檔案。", 400);
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`question-source:${userId}:${input.idempotencyKey}`]);
    const existing = await client.query<{ checksums: string[]; id: string; roles: QuestionSourceRole[] } & QueryResultRow>(`
        SELECT batch.id,
               array_agg(asset.checksum ORDER BY link.position) AS checksums,
               array_agg(link.document_role ORDER BY link.position) AS roles
        FROM import_batches AS batch
        JOIN import_batch_documents AS link ON link.import_batch_id = batch.id
        JOIN source_documents AS document ON document.id = link.source_document_id
        JOIN assets AS asset ON asset.id = document.asset_id
        WHERE batch.created_by_user_id = $1 AND batch.idempotency_key = $2
        GROUP BY batch.id
    `, [userId, input.idempotencyKey]);
    if (existing.rows[0]) {
        const checksums = input.sources.map((source) => source.asset.checksum);
        const roles = input.sources.map((source) => source.role);
        if (JSON.stringify(existing.rows[0].checksums) !== JSON.stringify(checksums)
            || JSON.stringify(existing.rows[0].roles) !== JSON.stringify(roles)) {
            throw new QuestionImportStoreError("IMPORT_IDEMPOTENCY_CONFLICT", "相同識別碼已用於另一組來源檔案。", 409);
        }
        return { batchId: existing.rows[0].id, replayed: true };
    }
    const bankId = await ensureDefaultBank(client, userId, input.learnerId);
    const batchId = randomUUID();
    await client.query(`
        INSERT INTO import_batches(
            id, question_bank_id, learner_id, created_by_user_id,
            status, idempotency_key, recognizer_version
        ) VALUES($1,$2,$3,$4,'draft',$5,'lerniqa-scan-v2')
    `, [batchId, bankId, input.learnerId, userId, input.idempotencyKey]);
    for (const [position, source] of input.sources.entries()) {
        await client.query(`
            INSERT INTO assets(
                id, storage_key, mime_type, byte_size, checksum, purpose,
                sensitivity, scan_status, created_by_user_id
            ) VALUES($1,$2,$3,$4,$5,'source_document','private','clean',$6)
        `, [source.asset.id, source.asset.storageKey, source.asset.mimeType, source.asset.byteSize, source.asset.checksum, userId]);
        const sourceDocumentId = randomUUID();
        const inputType = source.asset.mimeType === "application/pdf" ? "pdf" : "image";
        await client.query(`
            INSERT INTO source_documents(
                id, owner_user_id, asset_id, input_type, original_file_name,
                document_title, status
            ) VALUES($1,$2,$3,$4,$5,$5,'uploaded')
        `, [sourceDocumentId, userId, source.asset.id, inputType, source.fileName]);
        const roleSource: QuestionSourceRoleSource = source.role === "auto" ? "pending" : "user";
        await client.query(`
            INSERT INTO import_batch_documents(
                import_batch_id, source_document_id, position,
                document_role, role_source
            ) VALUES($1,$2,$3,$4,$5)
        `, [batchId, sourceDocumentId, position, source.role, roleSource]);
    }
    await client.query(`
        INSERT INTO question_source_analysis_jobs(
            id, import_batch_id, analyze_questions, settings, status
        ) VALUES($1,$2,$3,$4::jsonb,'queued')
    `, [randomUUID(), batchId, input.analyze, JSON.stringify({ dewarp: true, corners: {} })]);
    return { batchId, replayed: false };
}

export async function queueQuestionSourceAnalysis(
    client: PoolClient,
    batchId: string,
    settings: QuestionSourceAnalysisSettings,
    userId: string,
): Promise<QuestionSourceAnalysisState> {
    const target = await client.query<{ status: string } & QueryResultRow>(`
        SELECT batch.status
        FROM import_batches AS batch
        WHERE batch.id = $1 AND batch.created_by_user_id = $2
          AND EXISTS (
              SELECT 1
              FROM import_batch_documents AS link
              JOIN source_documents AS document ON document.id = link.source_document_id
              WHERE link.import_batch_id = batch.id
                AND document.input_type IN ('image', 'pdf')
          )
        FOR UPDATE OF batch
    `, [batchId, userId]);
    const row = target.rows[0];
    if (!row) throw new QuestionImportStoreError("IMPORT_SOURCE_BATCH_NOT_FOUND", "找不到這次掃描匯入。", 404);
    if (row.status === "confirmed" || row.status === "cancelled") {
        throw new QuestionImportStoreError("IMPORT_SOURCE_BATCH_CLOSED", "這次掃描已結束，不能重新處理。", 409);
    }
    const active = await client.query<{ id: string; last_error_code: string | null; result_payload: unknown; status: QuestionSourceAnalysisState["status"] } & QueryResultRow>(`
        SELECT id, status, last_error_code, result_payload
        FROM question_source_analysis_jobs
        WHERE import_batch_id = $1 AND status IN ('queued', 'retry', 'running')
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `, [batchId]);
    if (active.rows[0]) {
        return {
            batchId,
            errorCode: active.rows[0].last_error_code,
            result: active.rows[0].result_payload,
            status: active.rows[0].status,
        };
    }
    await client.query(`
        UPDATE import_batches SET status = 'draft' WHERE id = $1
    `, [batchId]);
    await client.query(`
        UPDATE source_documents AS document
        SET status = 'uploaded'
        FROM import_batch_documents AS link
        WHERE link.import_batch_id = $1
          AND link.source_document_id = document.id
    `, [batchId]);
    const job = await client.query<{ status: QuestionSourceAnalysisState["status"] } & QueryResultRow>(`
        INSERT INTO question_source_analysis_jobs(
            id, import_batch_id, analyze_questions, settings, status
        ) VALUES($1,$2,$3,$4::jsonb,'queued')
        RETURNING status
    `, [randomUUID(), batchId, settings.analyze, JSON.stringify({ dewarp: settings.dewarp, corners: settings.corners })]);
    return { batchId, errorCode: null, result: null, status: job.rows[0]!.status };
}

export async function getQuestionSourceAnalysisState(
    client: PoolClient,
    batchId: string,
    userId: string,
): Promise<QuestionSourceAnalysisState> {
    const result = await client.query<{
        last_error_code: string | null;
        result_payload: unknown;
        status: QuestionSourceAnalysisState["status"];
    } & QueryResultRow>(`
        SELECT job.status, job.last_error_code, job.result_payload
        FROM question_source_analysis_jobs AS job
        JOIN import_batches AS batch ON batch.id = job.import_batch_id
        WHERE job.import_batch_id = $1 AND batch.created_by_user_id = $2
        ORDER BY job.created_at DESC, job.id DESC
        LIMIT 1
    `, [batchId, userId]);
    const row = result.rows[0];
    if (!row) throw new QuestionImportStoreError("IMPORT_SOURCE_JOB_NOT_FOUND", "找不到這次圖片分析工作。", 404);
    return { batchId, errorCode: row.last_error_code, result: row.result_payload, status: row.status };
}

async function findExistingBatch(client: PoolClient, userId: string, idempotencyKey: string): Promise<QuestionImportResult | null> {
    const result = await client.query<ExistingBatchRow>(`
        SELECT batch.id,
               batch.status,
               count(item.id)::integer AS item_count
        FROM import_batches AS batch
        LEFT JOIN import_items AS item ON item.import_batch_id = batch.id
        WHERE batch.created_by_user_id = $1
          AND batch.idempotency_key = $2
        GROUP BY batch.id
    `, [userId, idempotencyKey]);
    const existing = result.rows[0];
    if (!existing) return null;
    if (existing.status !== "confirmed") {
        throw new QuestionImportStoreError("IMPORT_IDEMPOTENCY_CONFLICT", "相同識別碼已有尚未完成的匯入批次。", 409);
    }
    return { batchId: existing.id, importedCount: existing.item_count, replayed: true };
}

async function requireSourceBatch(
    client: PoolClient,
    input: QuestionImportPackage,
    userId: string,
): Promise<{ batchId: string; bankId: string; confirmedCount: number | null; sourceDocumentId: string } | null> {
    if (!input.sourceBatchId) return null;
    const result = await client.query<{
        bank_id: string;
        id: string;
        source_document_id: string;
        status: string;
        idempotency_key: string;
    } & QueryResultRow>(`
        SELECT batch.id,
               batch.question_bank_id AS bank_id,
               batch.status,
               batch.idempotency_key,
               document.source_document_id
        FROM import_batches AS batch
        JOIN import_batch_documents AS document ON document.import_batch_id = batch.id
        WHERE batch.id = $1
          AND batch.created_by_user_id = $2
          AND batch.learner_id = $3
          AND document.position = 0
    `, [input.sourceBatchId, userId, input.learnerId]);
    const batch = result.rows[0];
    if (!batch) throw new QuestionImportStoreError("IMPORT_SOURCE_BATCH_NOT_FOUND", "找不到這次掃描匯入。", 404);
    if (batch.idempotency_key !== input.idempotencyKey) {
        throw new QuestionImportStoreError("IMPORT_IDEMPOTENCY_CONFLICT", "掃描批次與確認識別碼不一致。", 409);
    }
    if (batch.status === "confirmed") {
        const count = await client.query<{ count: number } & QueryResultRow>(`
            SELECT count(*)::integer AS count FROM import_items WHERE import_batch_id = $1 AND review_status = 'approved'
        `, [batch.id]);
        return {
            batchId: batch.id,
            bankId: batch.bank_id,
            confirmedCount: count.rows[0]?.count ?? 0,
            sourceDocumentId: batch.source_document_id,
        };
    }
    if (!['draft', 'review', 'failed'].includes(batch.status)) {
        throw new QuestionImportStoreError("IMPORT_SOURCE_BATCH_BUSY", "掃描仍在處理，完成後才能確認題目。", 409);
    }
    return { batchId: batch.id, bankId: batch.bank_id, confirmedCount: null, sourceDocumentId: batch.source_document_id };
}

async function insertContentBlocks(
    client: PoolClient,
    revisionId: string,
    partId: string | null,
    optionId: string | null,
    placement: "prompt" | "option" | "hint" | "explanation",
    blocks: ImportContentBlock[],
    hintIndex: number | null = null,
): Promise<void> {
    for (const [position, block] of blocks.entries()) {
        const textContent = block.kind === "text"
            ? block.text
            : block.kind === "formula"
                ? block.tex
                : block.kind === "table"
                    ? tableText(block.rows)
                    : null;
        const assetId = block.kind === "image" || block.kind === "page_crop" ? block.assetId : null;
        const altText = block.kind === "image" || block.kind === "page_crop" ? block.alt : null;
        await client.query(`
            INSERT INTO question_content_blocks(
                id, question_revision_id, question_part_id, question_option_id,
                placement, content_type, position, text_content, asset_id, alt_text, hint_index
            ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [randomUUID(), revisionId, partId, optionId, placement, block.kind, position, textContent, assetId, altText, hintIndex]);
    }
}

async function insertPart(
    client: PoolClient,
    revisionId: string,
    part: ImportPartDraft,
    position: number,
    partIds: Map<string, string>,
): Promise<void> {
    const partId = partIds.get(part.stableKey)!;
    const parentId = part.parentStableKey ? partIds.get(part.parentStableKey)! : null;
    await client.query(`
        INSERT INTO question_parts(
            id, question_revision_id, parent_part_id, stable_key, position,
            answer_mode, answer_field_count, grading_policy
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    `, [partId, revisionId, parentId, part.stableKey, position, part.answerMode, part.answerFieldCount, part.gradingPolicy]);
    await insertContentBlocks(client, revisionId, partId, null, "prompt", part.prompt);
    for (const [hintIndex, hint] of part.hints.entries()) {
        await insertContentBlocks(client, revisionId, partId, null, "hint", hint, hintIndex);
    }
    await insertContentBlocks(client, revisionId, partId, null, "explanation", part.explanation);

    const optionIds = new Map<string, string>();
    for (const [optionPosition, option] of part.options.entries()) {
        const optionId = randomUUID();
        optionIds.set(option.key, optionId);
        await client.query(`
            INSERT INTO question_options(id, question_part_id, option_key, position)
            VALUES($1,$2,$3,$4)
        `, [optionId, partId, option.key, optionPosition]);
        await insertContentBlocks(client, revisionId, partId, optionId, "option", option.blocks);
    }

    for (const answer of part.answers) {
        const answerKey = part.answerMode === "text" ? null : answer;
        const acceptedValue = part.answerMode === "text" ? answer : null;
        await client.query(`
            INSERT INTO question_answers(id, question_part_id, answer_key, accepted_value)
            VALUES($1,$2,$3,$4)
        `, [randomUUID(), partId, answerKey, acceptedValue]);
        if (answerKey && !optionIds.has(answerKey)) {
            throw new QuestionImportStoreError("IMPORT_ANSWER_OPTION_MISMATCH", "答案鍵值不屬於同一小題的選項。", 409);
        }
    }
}

async function insertQuestion(
    client: PoolClient,
    input: QuestionImportPackage,
    question: ImportQuestionDraft,
    sourceDocumentId: string,
    batchId: string,
    bankId: string,
    userId: string,
    position: number,
    questionTypeId: string,
): Promise<void> {
    const questionId = randomUUID();
    const revisionId = randomUUID();
    const importItemId = randomUUID();
    const cropAssetId = findCropAssetId(question);
    const searchText = [
        contentSearchText(question.sharedPrompt),
        ...question.parts.flatMap((part) => [
            contentSearchText(part.prompt),
            ...part.options.map((option) => contentSearchText(option.blocks)),
        ]),
    ].join(" ").trim();
    await client.query(`
        INSERT INTO questions(id, origin, owner_user_id, status, created_method, created_by_user_id)
        VALUES($1, 'account', $2, 'published', 'import', $2)
    `, [questionId, userId]);
    await client.query(`
        INSERT INTO question_revisions(
            id, question_id, revision_number, question_type_id, subject_id, grade_id,
            semester_id, book_version_id, difficulty_level_id, source_category_id,
            search_text, status, created_by_type, created_by_user_id, published_at
        ) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,'published','user',$11,transaction_timestamp())
    `, [
        revisionId,
        questionId,
        questionTypeId,
        input.catalog.subjectId,
        input.catalog.gradeId,
        input.catalog.semesterId,
        input.catalog.bookVersionId,
        input.catalog.difficultyLevelId,
        input.catalog.sourceCategoryId,
        searchText,
        userId,
    ]);
    if (input.catalog.curriculumUnitId) {
        await client.query(`
            INSERT INTO question_revision_units(
                question_revision_id, curriculum_unit_id, assignment_type,
                is_primary, value_source, confidence
            ) VALUES($1,$2,'native',true,'user',NULL)
        `, [revisionId, input.catalog.curriculumUnitId]);
    }

    for (const classification of question.classifications) {
        for (const optionId of classification.optionIds) {
            await client.query(`
                INSERT INTO question_revision_filter_values(
                    id, question_revision_id, filter_field_id, filter_option_id,
                    value_source, confidence
                ) VALUES($1,$2,$3,$4,'user',NULL)
            `, [randomUUID(), revisionId, classification.fieldId, optionId]);
        }
    }

    await insertContentBlocks(client, revisionId, null, null, "prompt", question.sharedPrompt);
    const partIds = new Map(question.parts.map((part) => [part.stableKey, randomUUID()]));
    for (const [partPosition, part] of question.parts.entries()) {
        await insertPart(client, revisionId, part, partPosition, partIds);
    }
    await client.query("UPDATE questions SET current_revision_id = $2 WHERE id = $1", [questionId, revisionId]);
    await client.query(`
        INSERT INTO question_bank_items(question_bank_id, question_id, added_by_user_id)
        VALUES($1,$2,$3)
    `, [bankId, questionId, userId]);
    await client.query(`
        INSERT INTO import_items(
            id, import_batch_id, source_document_id, source_question_number, source_order,
            source_page,
            draft_payload, recognition_confidence, review_status, question_id,
            question_revision_id, reviewed_by_user_id, reviewed_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,NULL,'approved',$8,$9,$10,transaction_timestamp())
    `, [importItemId, batchId, sourceDocumentId, question.sourceQuestionNumber, position, question.sourcePage, JSON.stringify(question), questionId, revisionId, userId]);
    await client.query(`
        INSERT INTO question_revision_sources(
            id, question_revision_id, source_document_id, import_item_id,
            source_page, source_question_number, crop_asset_id, is_primary
        ) VALUES($1,$2,$3,$4,$5,$6,$7,true)
    `, [randomUUID(), revisionId, sourceDocumentId, importItemId, question.sourcePage, question.sourceQuestionNumber, cropAssetId]);
}

export async function importQuestionPackage(
    client: PoolClient,
    input: QuestionImportPackage,
    userId: string,
): Promise<QuestionImportResult> {
    const sourceBatch = await requireSourceBatch(client, input, userId);
    if (sourceBatch?.confirmedCount !== null && sourceBatch?.confirmedCount !== undefined) {
        return { batchId: sourceBatch.batchId, importedCount: sourceBatch.confirmedCount, replayed: true };
    }
    if (!sourceBatch) {
        const existing = await findExistingBatch(client, userId, input.idempotencyKey);
        if (existing) return existing;
    }
    await requireLearnerAccess(client, input.learnerId, userId);
    await requireQuota(client, userId, input.questions.length);
    const questionTypeId = await requireCatalog(client, input.catalog, input.questions, userId);
    await requireQuestionClassifications(client, input.questions, input.catalog.subjectId, userId);
    await requireAssets(client, input.questions, userId);
    await ensureLearnerSubject(client, input.learnerId, input.catalog.subjectId);
    const bankId = sourceBatch?.bankId ?? await ensureDefaultBank(client, userId, input.learnerId);
    const sourceDocumentId = sourceBatch?.sourceDocumentId ?? randomUUID();
    if (!sourceBatch) {
        await client.query(`
            INSERT INTO source_documents(
                id, owner_user_id, input_type, pasted_text, document_title, status
            ) VALUES($1,$2,'text',$3,$4,'ready')
        `, [sourceDocumentId, userId, JSON.stringify({ schemaVersion: input.schemaVersion, questions: input.questions }), input.sourceTitle]);
    }
    const batchId = sourceBatch?.batchId ?? randomUUID();
    if (sourceBatch) {
        await client.query("DELETE FROM import_items WHERE import_batch_id = $1 AND review_status = 'pending'", [batchId]);
    }
    else {
        await client.query(`
            INSERT INTO import_batches(
                id, question_bank_id, learner_id, created_by_user_id, status,
                idempotency_key, recognizer_version, confirmed_at
            ) VALUES($1,$2,$3,$4,'confirmed',$5,'lerniqa-structured-v1',transaction_timestamp())
        `, [batchId, bankId, input.learnerId, userId, input.idempotencyKey]);
        await client.query(`
            INSERT INTO import_batch_documents(import_batch_id, source_document_id, position)
            VALUES($1,$2,0)
        `, [batchId, sourceDocumentId]);
    }
    for (const [position, question] of input.questions.entries()) {
        await insertQuestion(client, input, question, sourceDocumentId, batchId, bankId, userId, position, questionTypeId);
    }
    if (sourceBatch) {
        await client.query(`
            UPDATE import_batches
            SET status = 'confirmed',
                recognizer_version = CASE
                    WHEN recognizer_version LIKE 'lerniqa-scan%' THEN 'lerniqa-scan-v1'
                    ELSE 'lerniqa-structured-v1'
                END,
                confirmed_at = transaction_timestamp()
            WHERE id = $1
        `, [batchId]);
        await client.query("UPDATE source_documents SET status = 'ready' WHERE id = $1", [sourceDocumentId]);
    }
    return { batchId, importedCount: input.questions.length, replayed: false };
}

export async function listQuestionImportCatalog(client: PoolClient, userId: string): Promise<Record<string, unknown>> {
    const [subjects, grades, semesters, versions, units, difficulties, sources, types, fields] = await Promise.all([
        client.query(`SELECT id,code,name,origin FROM subjects WHERE subject_kind='leaf' AND status='active' AND (origin='system' OR owner_user_id=$1) ORDER BY origin DESC, normalized_name, id`, [userId]),
        client.query(`SELECT id,code,name FROM grades WHERE status='active' ORDER BY sort_order,id`),
        client.query(`SELECT id,code,name FROM semesters WHERE status='active' ORDER BY sort_order,id`),
        client.query(`SELECT id,subject_id AS "subjectId",grade_id AS "gradeId",name FROM book_versions WHERE status='active' AND (origin='system' OR owner_user_id=$1) ORDER BY name,id`, [userId]),
        client.query(`
            SELECT id,subject_id AS "subjectId",grade_id AS "gradeId",semester_id AS "semesterId",
                   book_version_id AS "bookVersionId",parent_unit_id AS "parentUnitId",unit_type AS "unitType",name
            FROM curriculum_units
            WHERE status='active' AND unit_type <> 'volume' AND (origin='system' OR owner_user_id=$1)
            ORDER BY subject_id,book_version_id,parent_unit_id,position,id
        `, [userId]),
        client.query(`SELECT id,code,name FROM difficulty_levels WHERE status='active' ORDER BY sort_order,id`),
        client.query(`SELECT id,code,name FROM source_categories WHERE status='active' AND (origin='system' OR owner_user_id=$1) ORDER BY name,id`, [userId]),
        client.query(`SELECT id,code,name FROM question_types WHERE status='active' ORDER BY name,id`),
        client.query(`
            SELECT field.id,
                   field.name,
                   field.selection_mode AS "selectionMode",
                   array_agg(DISTINCT subject_scope.subject_id ORDER BY subject_scope.subject_id) AS "subjectIds",
                   COALESCE((
                       SELECT jsonb_agg(
                           jsonb_build_object('id', option.id, 'label', option.label, 'value', option.value, 'sortOrder', option.sort_order)
                           ORDER BY option.sort_order, option.id
                       )
                       FROM filter_field_options AS option
                       WHERE option.filter_field_id = field.id
                         AND option.status = 'active'
                   ), '[]'::jsonb) AS options
            FROM filter_fields AS field
            JOIN filter_field_scopes AS scope
              ON scope.filter_field_id = field.id
             AND scope.status = 'active'
            JOIN filter_field_scope_subjects AS subject_scope
              ON subject_scope.filter_field_scope_id = scope.id
             AND subject_scope.effect = 'include'
            WHERE field.status = 'active'
              AND field.value_type = 'option'
              AND field.origin = 'account'
              AND field.owner_user_id = $1
            GROUP BY field.id, field.name, field.selection_mode, field.sort_order
            ORDER BY field.sort_order, field.id
        `, [userId]),
    ]);
    return {
        subjects: subjects.rows,
        grades: grades.rows,
        semesters: semesters.rows,
        bookVersions: versions.rows,
        curriculumUnits: units.rows,
        difficulties: difficulties.rows,
        sourceCategories: sources.rows,
        questionTypes: types.rows,
        classificationFields: fields.rows,
    };
}

export async function createAccountSubject(client: PoolClient, name: string, userId: string): Promise<{ id: string; code: string; name: string; origin: "account" }> {
    const normalizedName = name.normalize("NFC").trim().toLowerCase();
    const conflict = await client.query(`
        SELECT 1 FROM subjects
        WHERE normalized_name = $1
          AND (
              (origin = 'system' AND status = 'active')
              OR (origin = 'account' AND owner_user_id = $2)
          )
    `, [normalizedName, userId]);
    if (conflict.rows.length) throw new QuestionImportStoreError("SUBJECT_NAME_ALREADY_EXISTS", "這個科目已存在，請直接從清單選擇。", 409);
    const id = randomUUID();
    const code = `custom-${id}`;
    await client.query(`
        INSERT INTO subjects(id,code,name,normalized_name,subject_kind,origin,owner_user_id,status)
        VALUES($1,$2,$3,$4,'leaf','account',$5,'active')
    `, [id, code, name, normalizedName, userId]);
    return { id, code, name, origin: "account" };
}

export async function createAccountClassificationField(
    client: PoolClient,
    subjectId: string,
    name: string,
    selectionMode: "single" | "multiple",
    userId: string,
): Promise<{ id: string; name: string; selectionMode: "single" | "multiple"; subjectIds: string[]; options: [] }> {
    const subject = await client.query(`
        SELECT 1 FROM subjects
        WHERE id=$1 AND subject_kind='leaf' AND status='active'
          AND (origin='system' OR owner_user_id=$2)
    `, [subjectId, userId]);
    if (!subject.rows.length) throw new QuestionImportStoreError("SUBJECT_NOT_FOUND", "找不到可使用的科目。", 404);
    const duplicate = await client.query(`
        SELECT 1
        FROM filter_fields AS field
        JOIN filter_field_scopes AS scope ON scope.filter_field_id=field.id AND scope.status='active'
        JOIN filter_field_scope_subjects AS subject_scope ON subject_scope.filter_field_scope_id=scope.id AND subject_scope.subject_id=$1
        WHERE field.owner_user_id=$2 AND lower(field.name)=lower($3) AND field.status='active'
    `, [subjectId, userId, name]);
    if (duplicate.rows.length) throw new QuestionImportStoreError("CLASSIFICATION_FIELD_EXISTS", "這個分類欄位已存在。", 409);
    const id = randomUUID();
    const scopeId = randomUUID();
    const order = await client.query<{ next_order: number } & QueryResultRow>(`
        SELECT COALESCE(max(sort_order), -1) + 1 AS next_order FROM filter_fields WHERE owner_user_id=$1
    `, [userId]);
    await client.query(`
        INSERT INTO filter_fields(id,key,name,value_type,selection_mode,sort_order,status,origin,owner_user_id)
        VALUES($1,$2,$3,'option',$4,$5,'active','account',$6)
    `, [id, `custom-${id}`, name, selectionMode, order.rows[0]!.next_order, userId]);
    await client.query(`
        INSERT INTO filter_field_scopes(id,filter_field_id,name,required_on_publish,status)
        VALUES($1,$2,$3,false,'active')
    `, [scopeId, id, `${name}適用科目`]);
    await client.query(`
        INSERT INTO filter_field_scope_subjects(filter_field_scope_id,subject_id,effect)
        VALUES($1,$2,'include')
    `, [scopeId, subjectId]);
    return { id, name, selectionMode, subjectIds: [subjectId], options: [] };
}

export async function createAccountClassificationOption(
    client: PoolClient,
    fieldId: string,
    label: string,
    userId: string,
): Promise<{ id: string; label: string; value: string; sortOrder: number }> {
    const field = await client.query(`SELECT 1 FROM filter_fields WHERE id=$1 AND owner_user_id=$2 AND origin='account' AND status='active'`, [fieldId, userId]);
    if (!field.rows.length) throw new QuestionImportStoreError("CLASSIFICATION_FIELD_NOT_FOUND", "找不到可編輯的分類欄位。", 404);
    const duplicate = await client.query(`SELECT 1 FROM filter_field_options WHERE filter_field_id=$1 AND lower(label)=lower($2) AND status='active'`, [fieldId, label]);
    if (duplicate.rows.length) throw new QuestionImportStoreError("CLASSIFICATION_OPTION_EXISTS", "這個分類選項已存在。", 409);
    const order = await client.query<{ next_order: number } & QueryResultRow>(`SELECT COALESCE(max(sort_order), -1) + 1 AS next_order FROM filter_field_options WHERE filter_field_id=$1`, [fieldId]);
    const id = randomUUID();
    const sortOrder = order.rows[0]!.next_order;
    const value = `custom-${id}`;
    await client.query(`
        INSERT INTO filter_field_options(id,filter_field_id,value,label,sort_order,status)
        VALUES($1,$2,$3,$4,$5,'active')
    `, [id, fieldId, value, label, sortOrder]);
    return { id, label, value, sortOrder };
}
