import type { QueryResultRow } from "pg";

import type { AdminQueryRunner } from "./admin-auth.ts";
import { AdminApiError } from "./admin-types.ts";

export type MutableQuestionRevisionStatus = "draft" | "rejected";
export type QuestionRevisionLifecycleStatus =
    | MutableQuestionRevisionStatus
    | "published"
    | "superseded";
export type QuestionReviewDecision =
    | "approved"
    | "rejected"
    | "changes_requested";

export interface LockedQuestionRecord {
    id: string;
    origin: "system" | "account";
    status: "draft" | "published" | "archived";
    currentRevisionId: string | null;
}

export interface LockedQuestionRevisionRecord {
    id: string;
    questionId: string;
    revisionNumber: number;
    status: QuestionRevisionLifecycleStatus;
    changeNote: string | null;
    createdByType: string;
    createdByUserId: string | null;
}

export interface RevisionCloneKeys {
    partIds: string[];
    optionIds: string[];
    blockIds: string[];
    textBlockIds: string[];
    answerIds: string[];
    answerContracts: RevisionAnswerEditContract[];
    filterValueIds: string[];
    sourceIds: string[];
}

export interface RevisionAnswerEditContract {
    answerId: string;
    answerMode: "single_choice" | "multiple_choice" | "boolean" | "text";
    optionKeys: string[];
}

export interface RevisionIdMapEntry {
    oldId: string;
    newId: string;
}

export interface RevisionCloneIdMaps {
    parts: RevisionIdMapEntry[];
    options: RevisionIdMapEntry[];
    blocks: RevisionIdMapEntry[];
    answers: RevisionIdMapEntry[];
    filterValues: RevisionIdMapEntry[];
    sources: RevisionIdMapEntry[];
}

interface QuestionRow extends QueryResultRow {
    id: string;
    origin: string;
    status: string;
    current_revision_id: string | null;
}

interface RevisionRow extends QueryResultRow {
    id: string;
    question_id: string;
    revision_number: number | string;
    status: string;
    change_note: string | null;
    created_by_type: string;
    created_by_user_id: string | null;
}

interface RevisionNumberRow extends QueryResultRow {
    next_revision_number: number | string;
}

interface CloneKeysRow extends QueryResultRow {
    part_ids: unknown;
    option_ids: unknown;
    block_ids: unknown;
    text_block_ids: unknown;
    answer_ids: unknown;
    answer_contracts: unknown;
    filter_value_ids: unknown;
    source_ids: unknown;
}

interface ReturnedIdRow extends QueryResultRow {
    id: string;
}

interface LatestReviewRow extends QueryResultRow {
    decision: string;
}

interface IncompleteAutomaticPartRow extends QueryResultRow {
    id: string;
    answer_mode: string;
}

interface DraftBaseRevisionRow extends QueryResultRow {
    base_revision_id: string;
}

export interface DraftTextBlockEdit {
    blockId: string;
    textContent: string;
}

export interface DraftAnswerEdit {
    answerId: string;
    answerKey: string | null;
    acceptedValue: string | null;
}

function asPositiveInteger(value: number | string, label: string): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new AdminApiError(
            "INTERNAL_ERROR",
            `${label}資料格式不正確。`,
            500,
        );
    }
    return parsed;
}

function asUuidArray(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new AdminApiError(
            "INTERNAL_ERROR",
            `${label}資料格式不正確。`,
            500,
        );
    }
    return value as string[];
}

function asAnswerContracts(value: unknown): RevisionAnswerEditContract[] {
    if (!Array.isArray(value)) {
        throw new AdminApiError("INTERNAL_ERROR", "題目答案契約資料格式不正確。", 500);
    }
    return value.map((item) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
            throw new AdminApiError("INTERNAL_ERROR", "題目答案契約資料格式不正確。", 500);
        }
        const record = item as Record<string, unknown>;
        const answerId = record.answerId;
        const answerMode = record.answerMode;
        const optionKeys = record.optionKeys;
        if (
            typeof answerId !== "string"
            || !["single_choice", "multiple_choice", "boolean", "text"].includes(
                String(answerMode),
            )
            || !Array.isArray(optionKeys)
            || optionKeys.some((key) => typeof key !== "string")
        ) {
            throw new AdminApiError("INTERNAL_ERROR", "題目答案契約資料格式不正確。", 500);
        }
        return {
            answerId,
            answerMode: answerMode as RevisionAnswerEditContract["answerMode"],
            optionKeys: optionKeys as string[],
        };
    });
}

function assertReturnedId(
    result: { rows: ReturnedIdRow[] },
    message: string,
): string {
    const id = result.rows[0]?.id;
    if (!id) {
        throw new AdminApiError("STALE_VERSION", message, 409);
    }
    return id;
}

/** Serialize all admin mutations for one stable question identity. */
export async function acquireQuestionMutationLock(
    runner: AdminQueryRunner,
    questionId: string,
): Promise<void> {
    await runner.query(`
        SELECT pg_advisory_xact_lock(
            hashtextextended('lerniqa-admin-question:' || $1::uuid::text, 0)
        )
    `, [questionId]);
}

export async function lockQuestionForMutation(
    runner: AdminQueryRunner,
    questionId: string,
): Promise<LockedQuestionRecord> {
    const result = await runner.query<QuestionRow>(`
        SELECT id, origin, status, current_revision_id
        FROM questions
        WHERE id = $1::uuid
        FOR UPDATE
    `, [questionId]);
    const row = result.rows[0];
    if (!row) {
        throw new AdminApiError("NOT_FOUND", "找不到指定的題目。", 404);
    }
    if (row.origin !== "system" && row.origin !== "account") {
        throw new AdminApiError("INTERNAL_ERROR", "題目來源資料格式不正確。", 500);
    }
    if (row.status !== "draft" && row.status !== "published" && row.status !== "archived") {
        throw new AdminApiError("INTERNAL_ERROR", "題目狀態資料格式不正確。", 500);
    }
    return {
        id: row.id,
        origin: row.origin,
        status: row.status,
        currentRevisionId: row.current_revision_id,
    };
}

export async function lockRevisionForMutation(
    runner: AdminQueryRunner,
    questionId: string,
    revisionId: string,
): Promise<LockedQuestionRevisionRecord> {
    const result = await runner.query<RevisionRow>(`
        SELECT
            id,
            question_id,
            revision_number,
            status,
            change_note,
            created_by_type,
            created_by_user_id
        FROM question_revisions
        WHERE id = $1::uuid
            AND question_id = $2::uuid
        FOR UPDATE
    `, [revisionId, questionId]);
    const row = result.rows[0];
    if (!row) {
        throw new AdminApiError("NOT_FOUND", "找不到指定的題目版本。", 404);
    }
    if (
        row.status !== "draft"
        && row.status !== "published"
        && row.status !== "superseded"
        && row.status !== "rejected"
    ) {
        throw new AdminApiError("INTERNAL_ERROR", "題目版本狀態資料格式不正確。", 500);
    }
    return {
        id: row.id,
        questionId: row.question_id,
        revisionNumber: asPositiveInteger(row.revision_number, "題目版本號"),
        status: row.status,
        changeNote: row.change_note,
        createdByType: row.created_by_type,
        createdByUserId: row.created_by_user_id,
    };
}

export async function readNextRevisionNumber(
    runner: AdminQueryRunner,
    questionId: string,
): Promise<number> {
    const result = await runner.query<RevisionNumberRow>(`
        SELECT coalesce(max(revision_number), 0) + 1 AS next_revision_number
        FROM question_revisions
        WHERE question_id = $1::uuid
    `, [questionId]);
    const value = result.rows[0]?.next_revision_number;
    if (value === undefined) {
        throw new AdminApiError("INTERNAL_ERROR", "無法取得下一個題目版本號。", 500);
    }
    return asPositiveInteger(value, "下一個題目版本號");
}

export async function readRevisionCloneKeys(
    runner: AdminQueryRunner,
    baseRevisionId: string,
): Promise<RevisionCloneKeys> {
    const result = await runner.query<CloneKeysRow>(`
        SELECT
            coalesce((
                SELECT jsonb_agg(part.id::text ORDER BY part.id)
                FROM question_parts AS part
                WHERE part.question_revision_id = $1::uuid
            ), '[]'::jsonb) AS part_ids,
            coalesce((
                SELECT jsonb_agg(option.id::text ORDER BY option.id)
                FROM question_options AS option
                JOIN question_parts AS part ON part.id = option.question_part_id
                WHERE part.question_revision_id = $1::uuid
            ), '[]'::jsonb) AS option_ids,
            coalesce((
                SELECT jsonb_agg(block.id::text ORDER BY block.id)
                FROM question_content_blocks AS block
                WHERE block.question_revision_id = $1::uuid
            ), '[]'::jsonb) AS block_ids,
            coalesce((
                SELECT jsonb_agg(block.id::text ORDER BY block.id)
                FROM question_content_blocks AS block
                WHERE block.question_revision_id = $1::uuid
                    AND block.content_type IN ('text', 'transcript', 'formula', 'table')
            ), '[]'::jsonb) AS text_block_ids,
            coalesce((
                SELECT jsonb_agg(answer.id::text ORDER BY answer.id)
                FROM question_answers AS answer
                JOIN question_parts AS part ON part.id = answer.question_part_id
                WHERE part.question_revision_id = $1::uuid
            ), '[]'::jsonb) AS answer_ids,
            coalesce((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'answerId', answer.id::text,
                        'answerMode', part.answer_mode,
                        'optionKeys', coalesce((
                            SELECT jsonb_agg(option.option_key ORDER BY option.option_key)
                            FROM question_options AS option
                            WHERE option.question_part_id = part.id
                        ), '[]'::jsonb)
                    )
                    ORDER BY answer.id
                )
                FROM question_answers AS answer
                JOIN question_parts AS part ON part.id = answer.question_part_id
                WHERE part.question_revision_id = $1::uuid
            ), '[]'::jsonb) AS answer_contracts,
            coalesce((
                SELECT jsonb_agg(value.id::text ORDER BY value.id)
                FROM question_revision_filter_values AS value
                WHERE value.question_revision_id = $1::uuid
            ), '[]'::jsonb) AS filter_value_ids,
            coalesce((
                SELECT jsonb_agg(source.id::text ORDER BY source.id)
                FROM question_revision_sources AS source
                WHERE source.question_revision_id = $1::uuid
            ), '[]'::jsonb) AS source_ids
    `, [baseRevisionId]);
    const row = result.rows[0];
    if (!row) {
        throw new AdminApiError("INTERNAL_ERROR", "無法讀取題目版本內容。", 500);
    }
    return {
        partIds: asUuidArray(row.part_ids, "題目小題"),
        optionIds: asUuidArray(row.option_ids, "題目選項"),
        blockIds: asUuidArray(row.block_ids, "題目內容"),
        textBlockIds: asUuidArray(row.text_block_ids, "題目文字內容"),
        answerIds: asUuidArray(row.answer_ids, "題目答案"),
        answerContracts: asAnswerContracts(row.answer_contracts),
        filterValueIds: asUuidArray(row.filter_value_ids, "題目篩選值"),
        sourceIds: asUuidArray(row.source_ids, "題目來源"),
    };
}

/**
 * Applies a deliberately narrow patch to the newly cloned draft. The caller
 * supplies only IDs produced by the clone map; relationship, asset, source and
 * placement columns are never writable through this contract.
 */
export async function applyDraftRevisionContentEdits(
    runner: AdminQueryRunner,
    input: Readonly<{
        revisionId: string;
        textBlocks: readonly DraftTextBlockEdit[];
        answers: readonly DraftAnswerEdit[];
    }>,
): Promise<void> {
    if (input.textBlocks.length > 0) {
        const textResult = await runner.query<ReturnedIdRow>(`
            WITH edits AS (
                SELECT
                    (entry->>'blockId')::uuid AS block_id,
                    entry->>'textContent' AS text_content
                FROM jsonb_array_elements($2::jsonb) AS item(entry)
            )
            UPDATE question_content_blocks AS block
            SET text_content = edits.text_content
            FROM edits
            WHERE block.id = edits.block_id
                AND block.question_revision_id = $1::uuid
                AND block.content_type IN ('text', 'transcript', 'formula', 'table')
            RETURNING block.id
        `, [input.revisionId, JSON.stringify(input.textBlocks)]);
        if (textResult.rows.length !== input.textBlocks.length) {
            throw new AdminApiError(
                "INVALID_QUESTION_REVISION",
                "文字內容編修目標不屬於新草稿。",
                422,
            );
        }
    }

    if (input.answers.length > 0) {
        const answerResult = await runner.query<ReturnedIdRow>(`
            WITH edits AS (
                SELECT
                    (entry->>'answerId')::uuid AS answer_id,
                    entry->>'answerKey' AS answer_key,
                    entry->>'acceptedValue' AS accepted_value
                FROM jsonb_array_elements($2::jsonb) AS item(entry)
            )
            UPDATE question_answers AS answer
            SET
                answer_key = edits.answer_key,
                accepted_value = edits.accepted_value
            FROM edits, question_parts AS part
            WHERE answer.id = edits.answer_id
                AND part.id = answer.question_part_id
                AND part.question_revision_id = $1::uuid
            RETURNING answer.id
        `, [input.revisionId, JSON.stringify(input.answers)]);
        if (answerResult.rows.length !== input.answers.length) {
            throw new AdminApiError(
                "INVALID_QUESTION_REVISION",
                "答案編修目標不屬於新草稿。",
                422,
            );
        }
    }
}

export async function readLatestRevisionReviewDecision(
    runner: AdminQueryRunner,
    revisionId: string,
): Promise<QuestionReviewDecision | null> {
    const result = await runner.query<LatestReviewRow>(`
        SELECT decision
        FROM question_revision_reviews
        WHERE question_revision_id = $1::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `, [revisionId]);
    const decision = result.rows[0]?.decision;
    if (decision === undefined) return null;
    if (
        decision !== "approved"
        && decision !== "rejected"
        && decision !== "changes_requested"
    ) {
        throw new AdminApiError("INTERNAL_ERROR", "題目審核資料格式不正確。", 500);
    }
    return decision;
}

/**
 * Mirrors migration 0009 by calling its canonical completeness predicate.
 * This keeps a malformed draft on the safe side of the deferred publish
 * constraint and lets the API return a stable 422 instead of a commit-time 500.
 */
export async function assertRevisionAutomaticAnswersComplete(
    runner: AdminQueryRunner,
    revisionId: string,
): Promise<void> {
    const result = await runner.query<IncompleteAutomaticPartRow>(`
        SELECT part.id, part.answer_mode
        FROM question_parts AS part
        WHERE part.question_revision_id = $1::uuid
            AND part.grading_policy = 'automatic'
            AND NOT lerniqa_automatic_part_has_complete_answer(
                part.id,
                part.answer_mode
            )
        ORDER BY part.position, part.id
        LIMIT 1
    `, [revisionId]);
    if (result.rows.length > 0) {
        throw new AdminApiError(
            "INVALID_QUESTION_REVISION",
            "草稿含有參考答案不完整的自動判分小題，不能發布；請建立新的修正版。",
            422,
        );
    }
}

/**
 * 0001-0007 have no formal base_revision_id column. Draft creation therefore
 * records the immutable base in the append-only creation audit, and publish
 * fails closed unless exactly one matching lineage record exists.
 */
export async function readDraftBaseRevisionId(
    runner: AdminQueryRunner,
    input: Readonly<{
        questionId: string;
        revisionId: string;
        revisionNumber: number;
    }>,
): Promise<string> {
    const result = await runner.query<DraftBaseRevisionRow>(`
        SELECT audit.after_data->>'baseRevisionId' AS base_revision_id
        FROM admin_audit_logs AS audit
        WHERE audit.action = 'system_question_revision_draft_created'
            AND audit.target_type = 'question_revision'
            AND audit.target_id = $1::uuid
            AND audit.after_data->>'questionId' = $2::uuid::text
            AND audit.after_data->>'revisionNumber' = $3::integer::text
            AND audit.after_data->>'status' = 'draft'
            AND jsonb_typeof(audit.after_data->'baseRevisionId') = 'string'
        ORDER BY audit.created_at, audit.id
        LIMIT 2
    `, [input.revisionId, input.questionId, input.revisionNumber]);
    const baseRevisionId = result.rows[0]?.base_revision_id;
    if (result.rows.length !== 1 || typeof baseRevisionId !== "string") {
        throw new AdminApiError(
            "INVALID_STATUS_TRANSITION",
            "草稿缺少唯一且可驗證的基準版本紀錄，不能發布。",
            422,
        );
    }
    return baseRevisionId;
}

export async function rebuildDraftRevisionSearchText(
    runner: AdminQueryRunner,
    revisionId: string,
): Promise<void> {
    const result = await runner.query<ReturnedIdRow>(`
        UPDATE question_revisions AS revision
        SET search_text = coalesce((
            SELECT string_agg(
                block.text_content,
                E'\n'
                ORDER BY block.placement, block.position, block.id
            )
            FROM question_content_blocks AS block
            WHERE block.question_revision_id = revision.id
                AND block.content_type IN ('text', 'transcript', 'formula', 'table')
        ), '')
        WHERE revision.id = $1::uuid
            AND revision.status = 'draft'
        RETURNING revision.id
    `, [revisionId]);
    assertReturnedId(result, "草稿搜尋內容已變更，請重新載入後再試。");
}

export async function insertDraftRevisionClone(
    runner: AdminQueryRunner,
    input: Readonly<{
        questionId: string;
        baseRevisionId: string;
        revisionId: string;
        revisionNumber: number;
        changeNote: string | null;
        actorUserId: string;
        idMaps: RevisionCloneIdMaps;
    }>,
): Promise<void> {
    const revisionResult = await runner.query<ReturnedIdRow>(`
        INSERT INTO question_revisions (
            id,
            question_id,
            revision_number,
            question_type_id,
            original_question_type_label,
            subject_id,
            grade_id,
            semester_id,
            book_version_id,
            exam_program_level_id,
            difficulty_level_id,
            source_category_id,
            search_text,
            status,
            change_note,
            created_by_type,
            created_by_user_id,
            published_at
        )
        SELECT
            $3::uuid,
            source.question_id,
            $4::integer,
            source.question_type_id,
            source.original_question_type_label,
            source.subject_id,
            source.grade_id,
            source.semester_id,
            source.book_version_id,
            source.exam_program_level_id,
            source.difficulty_level_id,
            source.source_category_id,
            source.search_text,
            'draft',
            $5::varchar,
            'user',
            $6::uuid,
            NULL
        FROM question_revisions AS source
        WHERE source.id = $2::uuid
            AND source.question_id = $1::uuid
        RETURNING id
    `, [
        input.questionId,
        input.baseRevisionId,
        input.revisionId,
        input.revisionNumber,
        input.changeNote,
        input.actorUserId,
    ]);
    assertReturnedId(revisionResult, "基準版本已變更，請重新載入後再試。");

    const partsJson = JSON.stringify(input.idMaps.parts);
    const optionsJson = JSON.stringify(input.idMaps.options);
    const blocksJson = JSON.stringify(input.idMaps.blocks);
    const answersJson = JSON.stringify(input.idMaps.answers);
    const filterValuesJson = JSON.stringify(input.idMaps.filterValues);
    const sourcesJson = JSON.stringify(input.idMaps.sources);

    await runner.query(`
        WITH id_map AS (
            SELECT
                (entry->>'oldId')::uuid AS old_id,
                (entry->>'newId')::uuid AS new_id
            FROM jsonb_array_elements($3::jsonb) AS item(entry)
        )
        INSERT INTO question_parts (
            id,
            question_revision_id,
            parent_part_id,
            stable_key,
            position,
            answer_mode,
            grading_policy,
            is_independently_gradable
        )
        SELECT
            self_map.new_id,
            $2::uuid,
            parent_map.new_id,
            source.stable_key,
            source.position,
            source.answer_mode,
            source.grading_policy,
            source.is_independently_gradable
        FROM question_parts AS source
        JOIN id_map AS self_map ON self_map.old_id = source.id
        LEFT JOIN id_map AS parent_map ON parent_map.old_id = source.parent_part_id
        WHERE source.question_revision_id = $1::uuid
    `, [input.baseRevisionId, input.revisionId, partsJson]);

    await runner.query(`
        WITH part_map AS (
            SELECT (entry->>'oldId')::uuid AS old_id, (entry->>'newId')::uuid AS new_id
            FROM jsonb_array_elements($1::jsonb) AS item(entry)
        ),
        option_map AS (
            SELECT (entry->>'oldId')::uuid AS old_id, (entry->>'newId')::uuid AS new_id
            FROM jsonb_array_elements($2::jsonb) AS item(entry)
        )
        INSERT INTO question_options (id, question_part_id, option_key, position)
        SELECT option_map.new_id, part_map.new_id, source.option_key, source.position
        FROM question_options AS source
        JOIN option_map ON option_map.old_id = source.id
        JOIN part_map ON part_map.old_id = source.question_part_id
    `, [partsJson, optionsJson]);

    await runner.query(`
        WITH part_map AS (
            SELECT (entry->>'oldId')::uuid AS old_id, (entry->>'newId')::uuid AS new_id
            FROM jsonb_array_elements($3::jsonb) AS item(entry)
        ),
        option_map AS (
            SELECT (entry->>'oldId')::uuid AS old_id, (entry->>'newId')::uuid AS new_id
            FROM jsonb_array_elements($4::jsonb) AS item(entry)
        ),
        block_map AS (
            SELECT (entry->>'oldId')::uuid AS old_id, (entry->>'newId')::uuid AS new_id
            FROM jsonb_array_elements($5::jsonb) AS item(entry)
        )
        INSERT INTO question_content_blocks (
            id,
            question_revision_id,
            question_part_id,
            question_option_id,
            parent_block_id,
            placement,
            content_type,
            position,
            text_content,
            asset_id,
            alt_text
        )
        SELECT
            self_map.new_id,
            $2::uuid,
            part_map.new_id,
            option_map.new_id,
            parent_map.new_id,
            source.placement,
            source.content_type,
            source.position,
            source.text_content,
            source.asset_id,
            source.alt_text
        FROM question_content_blocks AS source
        JOIN block_map AS self_map ON self_map.old_id = source.id
        LEFT JOIN block_map AS parent_map ON parent_map.old_id = source.parent_block_id
        LEFT JOIN part_map ON part_map.old_id = source.question_part_id
        LEFT JOIN option_map ON option_map.old_id = source.question_option_id
        WHERE source.question_revision_id = $1::uuid
    `, [input.baseRevisionId, input.revisionId, partsJson, optionsJson, blocksJson]);

    await runner.query(`
        WITH part_map AS (
            SELECT (entry->>'oldId')::uuid AS old_id, (entry->>'newId')::uuid AS new_id
            FROM jsonb_array_elements($1::jsonb) AS item(entry)
        ),
        answer_map AS (
            SELECT (entry->>'oldId')::uuid AS old_id, (entry->>'newId')::uuid AS new_id
            FROM jsonb_array_elements($2::jsonb) AS item(entry)
        )
        INSERT INTO question_answers (
            id, question_part_id, answer_key, accepted_value, position
        )
        SELECT
            answer_map.new_id,
            part_map.new_id,
            source.answer_key,
            source.accepted_value,
            source.position
        FROM question_answers AS source
        JOIN answer_map ON answer_map.old_id = source.id
        JOIN part_map ON part_map.old_id = source.question_part_id
    `, [partsJson, answersJson]);

    await runner.query(`
        INSERT INTO question_revision_units (
            question_revision_id, curriculum_unit_id, assignment_type,
            is_primary, value_source, confidence
        )
        SELECT $2::uuid, curriculum_unit_id, assignment_type,
            is_primary, value_source, confidence
        FROM question_revision_units
        WHERE question_revision_id = $1::uuid
    `, [input.baseRevisionId, input.revisionId]);

    await runner.query(`
        INSERT INTO question_revision_topics (
            question_revision_id, topic_id, is_primary, value_source
        )
        SELECT $2::uuid, topic_id, is_primary, value_source
        FROM question_revision_topics
        WHERE question_revision_id = $1::uuid
    `, [input.baseRevisionId, input.revisionId]);

    await runner.query(`
        INSERT INTO question_revision_knowledge_points (
            question_revision_id, knowledge_point_id, is_primary, value_source
        )
        SELECT $2::uuid, knowledge_point_id, is_primary, value_source
        FROM question_revision_knowledge_points
        WHERE question_revision_id = $1::uuid
    `, [input.baseRevisionId, input.revisionId]);

    await runner.query(`
        INSERT INTO question_revision_curriculum_codes (
            question_revision_id, curriculum_code_id, is_primary, value_source, confidence
        )
        SELECT $2::uuid, curriculum_code_id, is_primary, value_source, confidence
        FROM question_revision_curriculum_codes
        WHERE question_revision_id = $1::uuid
    `, [input.baseRevisionId, input.revisionId]);

    await runner.query(`
        WITH id_map AS (
            SELECT (entry->>'oldId')::uuid AS old_id, (entry->>'newId')::uuid AS new_id
            FROM jsonb_array_elements($3::jsonb) AS item(entry)
        )
        INSERT INTO question_revision_filter_values (
            id, question_revision_id, filter_field_id, filter_option_id,
            raw_label, raw_value, normalized_value, value_source, confidence
        )
        SELECT
            id_map.new_id,
            $2::uuid,
            source.filter_field_id,
            source.filter_option_id,
            source.raw_label,
            source.raw_value,
            source.normalized_value,
            source.value_source,
            source.confidence
        FROM question_revision_filter_values AS source
        JOIN id_map ON id_map.old_id = source.id
        WHERE source.question_revision_id = $1::uuid
    `, [input.baseRevisionId, input.revisionId, filterValuesJson]);

    // An import item is evidence for the revision that import created; its
    // composite FK includes that original revision. Reusing it here would
    // falsely claim the admin edit was imported. Preserve the document, page,
    // source question number and crop, while the draft audit records the base
    // revision used for this clone.
    await runner.query(`
        WITH id_map AS (
            SELECT (entry->>'oldId')::uuid AS old_id, (entry->>'newId')::uuid AS new_id
            FROM jsonb_array_elements($3::jsonb) AS item(entry)
        )
        INSERT INTO question_revision_sources (
            id, question_revision_id, source_document_id, import_item_id,
            source_page, source_question_number, crop_asset_id, is_primary
        )
        SELECT
            id_map.new_id,
            $2::uuid,
            source.source_document_id,
            NULL,
            source.source_page,
            source.source_question_number,
            source.crop_asset_id,
            source.is_primary
        FROM question_revision_sources AS source
        JOIN id_map ON id_map.old_id = source.id
        WHERE source.question_revision_id = $1::uuid
    `, [input.baseRevisionId, input.revisionId, sourcesJson]);
}

export async function insertQuestionRevisionReview(
    runner: AdminQueryRunner,
    input: Readonly<{
        reviewId: string;
        revisionId: string;
        reviewerUserId: string;
        decision: QuestionReviewDecision;
        reason: string | null;
        fromStatus: "draft" | "published" | "rejected";
        toStatus: QuestionRevisionLifecycleStatus;
    }>,
): Promise<void> {
    const result = await runner.query<ReturnedIdRow>(`
        INSERT INTO question_revision_reviews (
            id,
            question_revision_id,
            reviewer_type,
            reviewer_user_id,
            decision,
            reason,
            from_status,
            to_status,
            created_at
        )
        VALUES (
            $1::uuid, $2::uuid, 'user', $3::uuid, $4::varchar,
            $5::text, $6::varchar, $7::varchar, transaction_timestamp()
        )
        RETURNING id
    `, [
        input.reviewId,
        input.revisionId,
        input.reviewerUserId,
        input.decision,
        input.reason,
        input.fromStatus,
        input.toStatus,
    ]);
    assertReturnedId(result, "題目版本審核未完成，請重新載入後再試。");
}

export async function transitionQuestionRevision(
    runner: AdminQueryRunner,
    input: Readonly<{
        questionId: string;
        revisionId: string;
        revisionNumber: number;
        expectedStatus: QuestionRevisionLifecycleStatus;
        targetStatus: QuestionRevisionLifecycleStatus;
    }>,
): Promise<void> {
    const publishedAtSql = input.targetStatus === "published"
        ? "transaction_timestamp()"
        : input.targetStatus === "superseded"
            ? "published_at"
            : "NULL";
    const result = await runner.query<ReturnedIdRow>(`
        UPDATE question_revisions
        SET
            status = $5::varchar,
            published_at = ${publishedAtSql}
        WHERE id = $1::uuid
            AND question_id = $2::uuid
            AND revision_number = $3::integer
            AND status = $4::varchar
        RETURNING id
    `, [
        input.revisionId,
        input.questionId,
        input.revisionNumber,
        input.expectedStatus,
        input.targetStatus,
    ]);
    assertReturnedId(result, "題目版本狀態已變更，請重新載入後再試。");
}

export async function replaceQuestionCurrentRevision(
    runner: AdminQueryRunner,
    input: Readonly<{
        questionId: string;
        expectedCurrentRevisionId: string | null;
        currentRevisionId: string;
    }>,
): Promise<void> {
    const result = await runner.query<ReturnedIdRow>(`
        UPDATE questions
        SET
            current_revision_id = $3::uuid,
            status = 'published',
            archived_at = NULL
        WHERE id = $1::uuid
            AND current_revision_id IS NOT DISTINCT FROM $2::uuid
            AND status <> 'archived'
        RETURNING id
    `, [input.questionId, input.expectedCurrentRevisionId, input.currentRevisionId]);
    assertReturnedId(result, "題目的目前版本已變更，請重新載入後再試。");
}

export async function insertQuestionMutationAudit(
    runner: AdminQueryRunner,
    input: Readonly<{
        auditId: string;
        actorUserId: string;
        action:
            | "system_question_revision_draft_created"
            | "system_question_revision_reviewed"
            | "system_question_revision_status_changed";
        targetId: string;
        beforeData: Readonly<Record<string, string | number | boolean | null>> | null;
        afterData: Readonly<Record<string, string | number | boolean | null>> | null;
        requestId: string;
    }>,
): Promise<void> {
    const result = await runner.query<ReturnedIdRow>(`
        INSERT INTO admin_audit_logs (
            id,
            actor_type,
            actor_user_id,
            action,
            target_type,
            target_id,
            before_data,
            after_data,
            request_id,
            created_at
        )
        VALUES (
            $1::uuid, 'user', $2::uuid, $3::varchar,
            'question_revision', $4::uuid, $5::jsonb, $6::jsonb,
            $7::varchar, transaction_timestamp()
        )
        RETURNING id
    `, [
        input.auditId,
        input.actorUserId,
        input.action,
        input.targetId,
        input.beforeData === null ? null : JSON.stringify(input.beforeData),
        input.afterData === null ? null : JSON.stringify(input.afterData),
        input.requestId,
    ]);
    assertReturnedId(result, "題目版本稽核未完成，請重新提交。");
}
