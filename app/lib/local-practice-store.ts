import { createHash, randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import type { ValidatedHandwritingPng } from "@/app/lib/handwriting-png";
import {
    deriveHandwritingObjectIdentity,
    removeHandwritingObject,
    storeHandwritingObject,
    type StoredHandwritingObject,
} from "@/app/lib/handwriting-object-store";
import {
    canDiscloseLocalPracticeReferenceAnswers,
    deriveLocalPracticeGradingSource,
    deriveLocalPracticeOverallResult,
    gradeLocalPracticePart,
    LOCAL_PRACTICE_DEFAULT_FILTERS,
    LOCAL_PRACTICE_MAX_QUESTIONS,
    LOCAL_PRACTICE_MAX_RECOMMENDATIONS,
    normalizeLocalPracticeText,
    type LocalPracticeAnswerInput,
    type LocalPracticeAttempt,
    type LocalPracticeAttemptPartResult,
    type LocalPracticeAttemptReceipt,
    type LocalPracticeAttemptSubmission,
    type LocalPracticeContentBlock,
    type LocalPracticeFilters,
    type LocalPracticeGradingSource,
    type LocalPracticeQuestion,
    type LocalPracticeQuestionPart,
    type LocalPracticeRecommendationKind,
    type LocalPracticeRecommendationResult,
    type LocalPracticeReferenceAnswer,
    type LocalPracticeResult,
    type LocalPracticeHistory,
    type LocalPracticeScoreSummary,
    type LocalPracticeSession,
    type LocalPracticeSessionMetadata,
    type LocalPracticeSessionRead,
    type LocalPracticeSessionSettings,
    type LocalPracticeSessionTarget,
    type LocalPracticeSessionHistory,
} from "@/app/lib/local-practice-types";
import {
    queryLocalPostgres,
    withLocalPostgresSerializableTransaction,
    withLocalPostgresTransaction,
} from "@/app/lib/local-postgres";
import {
    attachPracticeCatalogKnowledge,
    PRACTICE_CATALOG_KNOWLEDGE_SQL,
    type PracticeCatalogKnowledgeRow,
} from "@/app/lib/practice-catalog-knowledge";
import { recommendationClassificationLabel } from "@/app/lib/practice-recommendations";
import { getSubjectLookupLabels } from "@/app/lib/subject-labels";

export interface LocalPracticeActor {
    userId: string;
    learnerId: string;
}

export class LocalPracticeRequestError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status: number) {
        super(message);
        this.name = "LocalPracticeRequestError";
        this.code = code;
        this.status = status;
    }
}

async function requireLocalPracticeResultAccess(
    client: PoolClient,
    actor: LocalPracticeActor,
): Promise<void> {
    const result = await client.query<{ id: string } & QueryResultRow>(`
        SELECT access.id
        FROM learner_access AS access
        JOIN users AS app_user
            ON app_user.id = access.user_id
            AND app_user.status = 'active'
        JOIN learners AS learner
            ON learner.id = access.learner_id
            AND learner.status = 'active'
        WHERE access.user_id = $1
            AND access.learner_id = $2
            AND access.can_view_results = true
            AND access.accepted_at IS NOT NULL
            AND access.revoked_at IS NULL
        ORDER BY access.id
        LIMIT 1
        FOR SHARE OF access
    `, [actor.userId, actor.learnerId]);
    if (result.rows.length === 0) {
        throw new LocalPracticeRequestError(
            "RESULT_ACCESS_DENIED",
            "目前帳號沒有查看這位學習者成果的權限。",
            403,
        );
    }
}

interface QuestionRow extends QueryResultRow {
    question_id: string;
    revision_id: string;
    revision_number: number;
    question_code: string | null;
    question_type_id: string;
    question_type_code: string;
    question_type_name: string;
    original_question_type_label: string | null;
    grade_id: string;
    grade_code: string;
    grade_name: string;
    subject_id: string;
    subject_code: string;
    subject_name: string;
    semester_id: string | null;
    semester_code: string | null;
    semester_name: string | null;
    publisher_id: string | null;
    publisher_code: string | null;
    publisher_name: string | null;
    book_version_id: string;
    book_version_name: string;
    unit_id: string;
    unit_code: string | null;
    unit_name: string;
    unit_type: string;
    difficulty_id: string | null;
    difficulty_code: string | null;
    difficulty_name: string | null;
    source_category_id?: string | null;
    source_category_code?: string | null;
    source_category_name?: string | null;
    total_count: string | number;
}

interface PartRow extends QueryResultRow {
    id: string;
    question_revision_id: string;
    stable_key: string;
    position: number;
    answer_mode: LocalPracticeQuestionPart["answerMode"];
    grading_policy: LocalPracticeGradingSource;
    is_independently_gradable: boolean;
}

interface OptionRow extends QueryResultRow {
    id: string;
    question_part_id: string;
    option_key: string;
    position: number;
}

interface BlockRow extends QueryResultRow {
    id: string;
    question_revision_id: string;
    question_part_id: string | null;
    question_option_id: string | null;
    content_type: LocalPracticeContentBlock["contentType"];
    position: number;
    text_content: string | null;
    asset_id: string | null;
    mime_type: string | null;
    width: number | null;
    height: number | null;
    alt_text: string | null;
}

interface MetadataRow extends QueryResultRow {
    question_revision_id: string;
    key: string;
    label: string;
    raw_value: string;
    value: string;
    value_source: "document" | "path" | "ai" | "user" | "migration";
    confidence: number | null;
}

interface SessionItemRow extends QueryResultRow {
    id: string;
    question_id: string;
    question_revision_id: string;
    question_part_id: string | null;
    position: number;
    answered: boolean;
}

interface SessionRow extends QueryResultRow {
    id: string;
    learner_id: string;
    created_by_user_id: string;
    mode: LocalPracticeSessionSettings["mode"];
    check_mode: LocalPracticeSessionSettings["checkMode"];
    status: LocalPracticeSession["status"];
    started_at: Date | string;
    completed_at: Date | string | null;
}

interface AttemptRow extends QueryResultRow {
    session_mode?: LocalPracticeSessionSettings["mode"];
    session_check_mode?: LocalPracticeSessionSettings["checkMode"];
    session_status?: LocalPracticeSession["status"];
    session_created_by_user_id?: string;
    id: string;
    practice_session_item_id: string;
    practice_session_id: string;
    question_id: string;
    question_revision_id: string;
    session_item_part_id?: string | null;
    overall_result: LocalPracticeResult;
    grading_source: LocalPracticeGradingSource;
    duration_seconds: number | null;
    submitted_at: Date | string;
}

interface AttemptPartRow extends QueryResultRow {
    id: string;
    answer_attempt_id: string;
    question_part_id: string;
    answer_payload: unknown;
    current_result: LocalPracticeResult;
    grading_source: LocalPracticeGradingSource;
}

interface AttemptAssetRow extends QueryResultRow {
    answer_attempt_id: string;
    question_part_id: string;
    asset_id: string;
    mime_type: "image/png";
    width: number;
    height: number;
    checksum: string;
}

interface ScoreReceiptRow extends QueryResultRow {
    id: string;
    practice_session_item_id: string;
    practice_session_id: string;
    session_check_mode: LocalPracticeSessionSettings["checkMode"];
    session_status: LocalPracticeSession["status"];
    session_created_by_user_id: string;
    question_id: string;
    question_revision_id: string;
    session_item_part_id: string | null;
    submitted_at: Date | string;
}

interface GradePartRow extends QueryResultRow {
    id: string;
    answer_mode: LocalPracticeQuestionPart["answerMode"];
    grading_policy: LocalPracticeGradingSource;
    position: number;
    answer_key: string | null;
    accepted_value: string | null;
    valid_option_keys: string[];
}

interface ReferenceAnswerRow extends QueryResultRow {
    answer_attempt_id: string;
    part_id: string;
    answer_mode: LocalPracticeQuestionPart["answerMode"];
    answer_key: string | null;
    accepted_value: string | null;
    option_key: string | null;
    option_label: string | null;
    explanation: string | null;
}

interface SessionHistoryRow extends QueryResultRow {
    id: string;
    mode: LocalPracticeSessionSettings["mode"];
    check_mode: LocalPracticeSessionSettings["checkMode"];
    status: LocalPracticeSession["status"];
    started_at: Date | string;
    completed_at: Date | string | null;
    item_count: number;
    attempted_item_count: number;
    correct_count: number;
    wrong_count: number;
    pending_count: number;
}

interface WrongQueueRow extends QueryResultRow {
    id: string;
    question_id: string;
    question_revision_id: string;
    question_part_id: string | null;
    created_at: Date | string;
    total_count: string | number;
}

interface RecommendationSourceRow extends QueryResultRow {
    queue_item_id: string;
    source_answer_part_result_id: string;
    question_id: string;
    revision_id: string;
    part_id: string;
    question_type_id: string;
    question_type_code: string;
    question_type_name: string;
    original_question_type_label: string | null;
    source_category_id: string | null;
    subject_id: string;
    grade_id: string;
    semester_id: string | null;
    book_version_id: string;
    exam_program_level_id: string | null;
    difficulty_level_id: string | null;
    unit_id: string;
}

interface RecommendationQuestionRow extends QuestionRow {
    recommendation_kind: Exclude<LocalPracticeRecommendationKind, "none">;
    similarity_group_id: string | null;
    matched_topic_id: string | null;
    shared_topic_count: number;
    volume_name: string;
}

interface RecommendationRequestRow extends QueryResultRow {
    practice_session_id: string;
    learner_id: string;
    created_by_user_id: string;
    source_queue_item_ids: string[];
    source_answer_part_result_ids: string[];
    requested_limit: number;
    check_mode: LocalPracticeSessionSettings["checkMode"];
    request_hash: string;
}

interface StoredRecommendationQuestionRow extends QuestionRow {
    selection_reason: string;
    similarity_group_id: string | null;
    match_basis: string | null;
    matched_topic_id: string | null;
    volume_name: string;
}

export interface LocalPracticeAssetRecord {
    id: string;
    storageKey: string;
    mimeType: string;
    byteSize: number;
    checksum: string;
    width?: number;
    height?: number;
}

function asIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toContentBlock(row: BlockRow, filters: LocalPracticeFilters): LocalPracticeContentBlock {
    const assetQuery = new URLSearchParams([
        ["grade", filters.grade],
        ["subject", filters.subject],
        ["publisher", filters.publisher],
        ["volume", filters.volume],
        ["lesson", filters.lesson],
    ]).toString();
    return {
        id: row.id,
        contentType: row.content_type,
        position: row.position,
        text: row.text_content,
        altText: row.alt_text,
        asset: row.asset_id && row.mime_type
            ? {
                id: row.asset_id,
                mimeType: row.mime_type,
                width: row.width,
                height: row.height,
                url: `/api/v1/local-practice/assets/${row.asset_id}?${assetQuery}`,
            }
            : null,
    };
}

function blocksToText(blocks: readonly LocalPracticeContentBlock[]): string {
    return blocks
        .map((block) => block.text ?? "")
        .filter(Boolean)
        .join("\n")
        .trim();
}

interface LocalPracticeQueryRunner {
    <Row extends QueryResultRow>(text: string, params?: readonly unknown[]): Promise<Row[]>;
}

async function hydrateLocalPracticeQuestions(
    baseRows: readonly QuestionRow[],
    filtersFor: (row: QuestionRow) => LocalPracticeFilters,
    runQuery: LocalPracticeQueryRunner,
): Promise<LocalPracticeQuestion[]> {
    if (baseRows.length === 0) return [];
    const revisionIds = baseRows.map((row) => row.revision_id);
    const [partRows, optionRows, blockRows, metadataRows] = await Promise.all([
        runQuery<PartRow>(`
            SELECT id, question_revision_id, stable_key, position, answer_mode,
                grading_policy, is_independently_gradable
            FROM question_parts
            WHERE question_revision_id = ANY($1::uuid[])
                AND is_independently_gradable = true
            ORDER BY question_revision_id, position, id
        `, [revisionIds]),
        runQuery<OptionRow>(`
            SELECT option.id, option.question_part_id, option.option_key, option.position
            FROM question_options AS option
            JOIN question_parts AS part ON part.id = option.question_part_id
            WHERE part.question_revision_id = ANY($1::uuid[])
                AND part.is_independently_gradable = true
            ORDER BY part.question_revision_id, part.position, option.position, option.id
        `, [revisionIds]),
        runQuery<BlockRow>(`
            SELECT
                block.id,
                block.question_revision_id,
                block.question_part_id,
                block.question_option_id,
                block.content_type,
                block.position,
                block.text_content,
                block.asset_id,
                asset.mime_type,
                asset.width,
                asset.height,
                block.alt_text
            FROM question_content_blocks AS block
            LEFT JOIN assets AS asset
                ON asset.id = block.asset_id
                AND asset.deleted_at IS NULL
                AND asset.scan_status = 'clean'
                AND (
                    (block.content_type = 'page_crop' AND asset.purpose = 'page_crop')
                    OR (
                        block.content_type IN ('image', 'audio')
                        AND asset.purpose = 'question_content'
                    )
                )
            WHERE block.question_revision_id = ANY($1::uuid[])
                AND block.placement IN ('prompt', 'option')
            ORDER BY block.question_revision_id, block.position, block.id
        `, [revisionIds]),
        runQuery<MetadataRow>(`
            SELECT
                filter_value.question_revision_id,
                field.key,
                field.name AS label,
                COALESCE(filter_value.raw_value, option.label, filter_value.normalized_value, '') AS raw_value,
                COALESCE(option.value, filter_value.normalized_value, '') AS value,
                filter_value.value_source,
                filter_value.confidence::double precision AS confidence
            FROM question_revision_filter_values AS filter_value
            JOIN filter_fields AS field
                ON field.id = filter_value.filter_field_id
                AND field.status = 'active'
            LEFT JOIN filter_field_options AS option
                ON option.id = filter_value.filter_option_id
                AND option.filter_field_id = filter_value.filter_field_id
                AND option.status = 'active'
            WHERE filter_value.question_revision_id = ANY($1::uuid[])
            ORDER BY filter_value.question_revision_id, field.sort_order, field.key, option.sort_order, option.value
        `, [revisionIds]),
    ]);

    const partsByRevision = new Map<string, PartRow[]>();
    for (const part of partRows) {
        const current = partsByRevision.get(part.question_revision_id) ?? [];
        current.push(part);
        partsByRevision.set(part.question_revision_id, current);
    }
    const optionsByPart = new Map<string, OptionRow[]>();
    for (const option of optionRows) {
        const current = optionsByPart.get(option.question_part_id) ?? [];
        current.push(option);
        optionsByPart.set(option.question_part_id, current);
    }
    const blocksByRevision = new Map<string, BlockRow[]>();
    for (const block of blockRows) {
        const current = blocksByRevision.get(block.question_revision_id) ?? [];
        current.push(block);
        blocksByRevision.set(block.question_revision_id, current);
    }
    const metadataByRevision = new Map<string, LocalPracticeQuestion["metadata"]>();
    for (const row of metadataRows) {
        if (!row.value) continue;
        const current = metadataByRevision.get(row.question_revision_id) ?? [];
        const existing = current.find((field) => field.key === row.key);
        if (existing) {
            if (!existing.values.includes(row.value)) existing.values.push(row.value);
        }
        else {
            current.push({
                key: row.key,
                label: row.label,
                rawValue: row.raw_value || row.value,
                values: [row.value],
                valueSource: row.value_source,
                confidence: row.confidence,
            });
        }
        metadataByRevision.set(row.question_revision_id, current);
    }

    return baseRows.map<LocalPracticeQuestion>((row) => {
        const filters = filtersFor(row);
        const revisionBlocks = blocksByRevision.get(row.revision_id) ?? [];
        const rootPromptBlocks = revisionBlocks
            .filter((block) => block.question_part_id === null && block.question_option_id === null)
            .map((block) => toContentBlock(block, filters));
        const parts = (partsByRevision.get(row.revision_id) ?? []).map<LocalPracticeQuestionPart>((part) => {
            const promptBlocks = revisionBlocks
                .filter((block) => block.question_part_id === part.id && block.question_option_id === null)
                .map((block) => toContentBlock(block, filters));
            const options = (optionsByPart.get(part.id) ?? []).map((option) => {
                const contentBlocks = revisionBlocks
                    .filter((block) => block.question_option_id === option.id)
                    .map((block) => toContentBlock(block, filters));
                return {
                    id: option.id,
                    key: option.option_key,
                    position: option.position,
                    label: blocksToText(contentBlocks) || option.option_key,
                    contentBlocks,
                };
            });
            return {
                id: part.id,
                stableKey: part.stable_key,
                position: part.position,
                answerMode: part.answer_mode,
                gradingPolicy: part.grading_policy,
                isIndependentlyGradable: part.is_independently_gradable,
                prompt: blocksToText(promptBlocks),
                promptBlocks,
                options,
            };
        });
        const prompt = blocksToText(rootPromptBlocks)
            || parts.map((part) => part.prompt).filter(Boolean).join("\n");

        return {
            id: row.question_id,
            revisionId: row.revision_id,
            revisionNumber: row.revision_number,
            code: row.question_code,
            type: { id: row.question_type_id, code: row.question_type_code, name: row.question_type_name },
            originalTypeLabel: row.original_question_type_label,
            grade: { id: row.grade_id, code: row.grade_code, name: row.grade_name },
            subject: { id: row.subject_id, code: row.subject_code, name: row.subject_name },
            semester: row.semester_id && row.semester_name
                ? { id: row.semester_id, code: row.semester_code, name: row.semester_name }
                : null,
            publisher: row.publisher_id && row.publisher_name
                ? { id: row.publisher_id, code: row.publisher_code, name: row.publisher_name }
                : null,
            bookVersion: { id: row.book_version_id, code: null, name: row.book_version_name },
            unit: { id: row.unit_id, code: row.unit_code, name: row.unit_name, unitType: row.unit_type },
            difficulty: row.difficulty_id && row.difficulty_name
                ? { id: row.difficulty_id, code: row.difficulty_code, name: row.difficulty_name }
                : null,
            sourceCategory: row.source_category_id && row.source_category_name
                ? { id: row.source_category_id, code: row.source_category_code ?? null, name: row.source_category_name }
                : null,
            metadata: metadataByRevision.get(row.revision_id) ?? [],
            prompt,
            promptBlocks: rootPromptBlocks,
            parts,
        };
    });
}

const TARGET_QUESTION_FROM_SQL = `
    FROM questions AS question
    JOIN question_revisions AS revision
        ON revision.id = question.current_revision_id
        AND revision.question_id = question.id
    JOIN question_types AS question_type ON question_type.id = revision.question_type_id
    JOIN grades AS grade ON grade.id = revision.grade_id
    JOIN subjects AS subject ON subject.id = revision.subject_id
    LEFT JOIN semesters AS semester ON semester.id = revision.semester_id
    JOIN book_versions AS book_version ON book_version.id = revision.book_version_id
    LEFT JOIN publishers AS publisher ON publisher.id = book_version.publisher_id
    JOIN question_revision_units AS revision_unit
        ON revision_unit.question_revision_id = revision.id
        AND revision_unit.is_primary = true
    JOIN curriculum_units AS unit ON unit.id = revision_unit.curriculum_unit_id
    LEFT JOIN curriculum_units AS volume_unit ON volume_unit.id = unit.parent_unit_id
    LEFT JOIN difficulty_levels AS difficulty ON difficulty.id = revision.difficulty_level_id
    LEFT JOIN source_categories AS source_category ON source_category.id = revision.source_category_id
    LEFT JOIN LATERAL (
        SELECT identifier.value
        FROM question_identifiers AS identifier
        WHERE identifier.question_id = question.id
        ORDER BY
            CASE identifier.identifier_type WHEN 'publisher_question' THEN 0 ELSE 1 END,
            identifier.value
        LIMIT 1
    ) AS question_identifier ON true
    WHERE question.status = 'published'
        AND revision.status = 'published'
        AND question.current_revision_id = revision.id
        AND grade.stage = 'junior_high'
        AND grade.status = 'active'
        AND subject.status = 'active'
        AND book_version.status = 'active'
        AND unit.status = 'active'
        AND (grade.name = $1 OR grade.code = $1)
        AND (
            subject.name = ANY($2::text[])
            OR subject.normalized_name = ANY($2::text[])
            OR subject.code = ANY($2::text[])
            OR EXISTS (
                SELECT 1
                FROM subject_aliases AS alias
                WHERE alias.subject_id = subject.id
                    AND alias.status = 'active'
                    AND (alias.alias = ANY($2::text[]) OR alias.normalized_alias = ANY($2::text[]))
            )
        )
        AND (
            publisher.name = $3
            OR publisher.code = $3
            OR position($3 IN book_version.name) > 0
        )
        AND (
            unit.name = $4
            OR unit.code = $4
            OR volume_unit.name = $4
            OR volume_unit.code = $4
        )
        AND (
            unit.name = $5
            OR (
                left(unit.name, char_length($5)) = $5
                AND substring(unit.name FROM char_length($5) + 1 FOR 1) IN (' ', '　', ':', '：')
            )
            OR unit.code = $5
        )
        AND EXISTS (
            SELECT 1
            FROM question_bank_items AS bank_item
            JOIN question_banks AS bank
                ON bank.id = bank_item.question_bank_id
                AND bank.status = 'active'
            JOIN question_bank_learners AS bank_learner
                ON bank_learner.question_bank_id = bank.id
            WHERE bank_item.question_id = question.id
                AND bank_learner.learner_id = $6
        )
`;

/** Returns only public prompt/option content for the selected published revision. */
export async function listLocalPracticeQuestions(
    filters: LocalPracticeFilters,
    page: number,
    limit: number,
    actor: LocalPracticeActor,
): Promise<{ questions: LocalPracticeQuestion[]; total: number }> {
    const offset = (page - 1) * limit;
    const params = [
        filters.grade,
        getSubjectLookupLabels(filters.subject),
        filters.publisher,
        filters.volume,
        filters.lesson,
        actor.learnerId,
        limit,
        offset,
    ] as const;
    const base = await queryLocalPostgres<QuestionRow>(`
        SELECT
            question.id AS question_id,
            revision.id AS revision_id,
            revision.revision_number,
            question_identifier.value AS question_code,
            question_type.id AS question_type_id,
            question_type.code AS question_type_code,
            question_type.name AS question_type_name,
            revision.original_question_type_label,
            grade.id AS grade_id,
            grade.code AS grade_code,
            grade.name AS grade_name,
            subject.id AS subject_id,
            subject.code AS subject_code,
            subject.name AS subject_name,
            semester.id AS semester_id,
            semester.code AS semester_code,
            semester.name AS semester_name,
            publisher.id AS publisher_id,
            publisher.code AS publisher_code,
            publisher.name AS publisher_name,
            book_version.id AS book_version_id,
            book_version.name AS book_version_name,
            unit.id AS unit_id,
            unit.code AS unit_code,
            unit.name AS unit_name,
            unit.unit_type,
            difficulty.id AS difficulty_id,
            difficulty.code AS difficulty_code,
            difficulty.name AS difficulty_name,
            source_category.id AS source_category_id,
            source_category.code AS source_category_code,
            source_category.name AS source_category_name,
            count(*) OVER () AS total_count
        ${TARGET_QUESTION_FROM_SQL}
        ORDER BY
            CASE
                WHEN regexp_replace(question_identifier.value, '^[0-9A-Fa-f]{16}:', '') ~ '^[0-9]+$'
                    THEN regexp_replace(question_identifier.value, '^[0-9A-Fa-f]{16}:', '')::numeric
                ELSE NULL
            END NULLS LAST,
            regexp_replace(question_identifier.value, '^[0-9A-Fa-f]{16}:', '') NULLS LAST,
            question.created_at,
            question.id
        LIMIT $7 OFFSET $8
    `, params);

    if (base.rows.length === 0) return { questions: [], total: 0 };

    const questions = await hydrateLocalPracticeQuestions(
        base.rows,
        () => filters,
        async <Row extends QueryResultRow>(text: string, values: readonly unknown[] = []) => (
            await queryLocalPostgres<Row>(text, values)
        ).rows,
    );

    return { questions, total: Number(base.rows[0]?.total_count ?? 0) };
}

async function readRecommendationSources(
    client: PoolClient,
    queueItemIds: readonly string[],
    actor: LocalPracticeActor,
    lock: boolean,
): Promise<RecommendationSourceRow[]> {
    const sourceResult = await client.query<RecommendationSourceRow>(`
        SELECT
            queue.id AS queue_item_id,
            source_result.id AS source_answer_part_result_id,
            source_item.question_id,
            source_item.question_revision_id AS revision_id,
            source_result.question_part_id AS part_id,
            source_revision.question_type_id,
            source_type.code AS question_type_code,
            source_type.name AS question_type_name,
            source_revision.original_question_type_label,
            source_revision.source_category_id,
            source_revision.subject_id,
            source_revision.grade_id,
            source_revision.semester_id,
            source_revision.book_version_id,
            source_revision.exam_program_level_id,
            source_revision.difficulty_level_id,
            source_unit.curriculum_unit_id AS unit_id
        FROM learner_practice_queue_items AS queue
        JOIN answer_part_results AS source_result
            ON source_result.id = queue.source_answer_part_result_id
        JOIN answer_attempts AS source_attempt
            ON source_attempt.id = source_result.answer_attempt_id
            AND source_attempt.learner_id = queue.learner_id
        JOIN practice_session_items AS source_item
            ON source_item.id = source_attempt.practice_session_item_id
            AND source_item.question_id = queue.question_id
            AND source_item.question_revision_id = queue.question_revision_id
        JOIN practice_sessions AS source_session
            ON source_session.id = source_item.practice_session_id
            AND source_session.learner_id = queue.learner_id
        JOIN questions AS source_question
            ON source_question.id = queue.question_id
            AND source_question.current_revision_id = queue.question_revision_id
            AND source_question.status = 'published'
        JOIN question_revisions AS source_revision
            ON source_revision.id = source_item.question_revision_id
            AND source_revision.question_id = source_item.question_id
            AND source_revision.status = 'published'
        JOIN question_types AS source_type ON source_type.id = source_revision.question_type_id
        JOIN question_revision_units AS source_unit
            ON source_unit.question_revision_id = source_revision.id
            AND source_unit.is_primary = true
        WHERE queue.id = ANY($1::uuid[])
            AND queue.learner_id = $2
            AND queue.reason = 'wrong_review'
            AND queue.status = 'pending'
            AND source_result.current_result = 'wrong'
            AND source_result.question_part_id = queue.question_part_id
            AND (
                source_session.check_mode = 'instant'
                OR (
                    source_session.check_mode = 'complete'
                    AND source_session.status = 'completed'
                )
            )
            AND NOT EXISTS (
                SELECT 1
                FROM answer_part_results AS newer_result
                JOIN answer_attempts AS newer_attempt
                    ON newer_attempt.id = newer_result.answer_attempt_id
                    AND newer_attempt.learner_id = queue.learner_id
                JOIN practice_session_items AS newer_item
                    ON newer_item.id = newer_attempt.practice_session_item_id
                    AND newer_item.question_id = source_item.question_id
                JOIN practice_sessions AS newer_session
                    ON newer_session.id = newer_item.practice_session_id
                    AND newer_session.learner_id = queue.learner_id
                WHERE newer_result.question_part_id = source_result.question_part_id
                    AND (
                        newer_session.check_mode = 'instant'
                        OR (
                            newer_session.check_mode = 'complete'
                            AND newer_session.status = 'completed'
                        )
                    )
                    AND (newer_attempt.submitted_at, newer_attempt.id)
                        > (source_attempt.submitted_at, source_attempt.id)
            )
        ORDER BY queue.id
        ${lock ? "FOR SHARE OF queue, source_result, source_attempt, source_item, source_session" : ""}
    `, [queueItemIds, actor.learnerId]);

    const uniqueRequested = new Set(queueItemIds);
    const sourceIdentity = new Set(sourceResult.rows.map((row) => `${row.question_id}:${row.revision_id}`));
    if (
        uniqueRequested.size !== queueItemIds.length
        || sourceResult.rows.length !== queueItemIds.length
        || sourceIdentity.size !== 1
    ) {
        throw new LocalPracticeRequestError(
            "WRONG_REVIEW_SOURCE_INVALID",
            "這筆錯題已不是目前可延伸練習的錯題，請重新整理成果紀錄。",
            409,
        );
    }
    return sourceResult.rows;
}

async function selectRecommendationQuestions(
    client: PoolClient,
    source: RecommendationSourceRow,
    actor: LocalPracticeActor,
    limit: number,
): Promise<RecommendationQuestionRow[]> {
    const candidateResult = await client.query<RecommendationQuestionRow>(`
        WITH eligible AS (
            SELECT
                candidate.id AS question_id,
                candidate_revision.id AS revision_id,
                candidate_revision.revision_number,
                candidate_identifier.value AS question_code,
                candidate_type.id AS question_type_id,
                candidate_type.code AS question_type_code,
                candidate_type.name AS question_type_name,
                candidate_revision.original_question_type_label,
                grade.id AS grade_id,
                grade.code AS grade_code,
                grade.name AS grade_name,
                subject.id AS subject_id,
                subject.code AS subject_code,
                subject.name AS subject_name,
                semester.id AS semester_id,
                semester.code AS semester_code,
                semester.name AS semester_name,
                publisher.id AS publisher_id,
                publisher.code AS publisher_code,
                publisher.name AS publisher_name,
                book_version.id AS book_version_id,
                book_version.name AS book_version_name,
                unit.id AS unit_id,
                unit.code AS unit_code,
                unit.name AS unit_name,
                unit.unit_type,
                COALESCE(volume_unit.name, unit.name) AS volume_name,
                difficulty.id AS difficulty_id,
                difficulty.code AS difficulty_code,
                difficulty.name AS difficulty_name,
                confirmed_match.similarity_group_id,
                topic_match.matched_topic_id,
                topic_match.shared_topic_count,
                latest_result.current_result IS NOT NULL AS has_previous_attempt,
                (
                    candidate_revision.question_type_id = $4
                    AND candidate_revision_unit.curriculum_unit_id = $13
                    AND (
                        CASE
                            WHEN $5 = ANY(ARRAY['single-choice', 'multi-choice', 'written']::text[])
                            THEN $7::uuid IS NOT NULL
                                AND candidate_revision.source_category_id = $7::uuid
                                AND NULLIF(btrim($6::text), '') IS NOT NULL
                                AND NULLIF(btrim(candidate_revision.original_question_type_label), '') IS NOT NULL
                                AND candidate_revision.original_question_type_label = $6::text
                            ELSE true
                        END
                    )
                ) AS is_same_type
            FROM questions AS candidate
            JOIN question_revisions AS candidate_revision
                ON candidate_revision.id = candidate.current_revision_id
                AND candidate_revision.question_id = candidate.id
                AND candidate_revision.status = 'published'
            JOIN question_types AS candidate_type
                ON candidate_type.id = candidate_revision.question_type_id
                AND candidate_type.status = 'active'
            JOIN subjects AS subject
                ON subject.id = candidate_revision.subject_id
                AND subject.status = 'active'
            JOIN grades AS grade
                ON grade.id = candidate_revision.grade_id
                AND grade.status = 'active'
            LEFT JOIN semesters AS semester ON semester.id = candidate_revision.semester_id
            JOIN book_versions AS book_version
                ON book_version.id = candidate_revision.book_version_id
                AND book_version.status = 'active'
            LEFT JOIN publishers AS publisher ON publisher.id = book_version.publisher_id
            JOIN question_revision_units AS candidate_revision_unit
                ON candidate_revision_unit.question_revision_id = candidate_revision.id
                AND candidate_revision_unit.is_primary = true
            JOIN curriculum_units AS unit
                ON unit.id = candidate_revision_unit.curriculum_unit_id
                AND unit.status = 'active'
            LEFT JOIN curriculum_units AS volume_unit ON volume_unit.id = unit.parent_unit_id
            LEFT JOIN difficulty_levels AS difficulty
                ON difficulty.id = candidate_revision.difficulty_level_id
            JOIN learner_subject_settings AS subject_setting
                ON subject_setting.learner_id = $1
                AND subject_setting.subject_id = candidate_revision.subject_id
                AND subject_setting.enabled = true
                AND (
                    subject_setting.book_version_id IS NULL
                    OR subject_setting.book_version_id = candidate_revision.book_version_id
                )
            LEFT JOIN LATERAL (
                SELECT identifier.value
                FROM question_identifiers AS identifier
                WHERE identifier.question_id = candidate.id
                ORDER BY
                    CASE identifier.identifier_type WHEN 'publisher_question' THEN 0 ELSE 1 END,
                    identifier.value
                LIMIT 1
            ) AS candidate_identifier ON true
            LEFT JOIN LATERAL (
                SELECT similarity_group.id AS similarity_group_id
                FROM question_similarity_memberships AS source_membership
                JOIN question_similarity_groups AS similarity_group
                    ON similarity_group.id = source_membership.similarity_group_id
                    AND similarity_group.status = 'confirmed'
                JOIN question_similarity_memberships AS target_membership
                    ON target_membership.similarity_group_id = similarity_group.id
                    AND target_membership.question_id = candidate.id
                    AND target_membership.based_on_revision_id = candidate_revision.id
                    AND target_membership.status = 'confirmed'
                WHERE source_membership.question_id = $2
                    AND source_membership.based_on_revision_id = $3
                    AND source_membership.status = 'confirmed'
                ORDER BY similarity_group.id
                LIMIT 1
            ) AS confirmed_match ON true
            LEFT JOIN LATERAL (
                SELECT
                    min(candidate_topic.topic_id::text)::uuid AS matched_topic_id,
                    count(*)::integer AS shared_topic_count
                FROM question_revision_topics AS candidate_topic
                JOIN question_revision_topics AS source_topic
                    ON source_topic.topic_id = candidate_topic.topic_id
                    AND source_topic.question_revision_id = $3
                JOIN topics AS topic
                    ON topic.id = candidate_topic.topic_id
                    AND topic.status = 'active'
                WHERE candidate_topic.question_revision_id = candidate_revision.id
            ) AS topic_match ON true
            LEFT JOIN LATERAL (
                SELECT latest_attempt.overall_result AS current_result
                FROM answer_attempts AS latest_attempt
                JOIN practice_session_items AS latest_item
                    ON latest_item.id = latest_attempt.practice_session_item_id
                    AND latest_item.question_id = candidate.id
                JOIN practice_sessions AS latest_session
                    ON latest_session.id = latest_item.practice_session_id
                    AND latest_session.learner_id = $1
                WHERE latest_attempt.learner_id = $1
                    AND (
                        latest_session.check_mode = 'instant'
                        OR (
                        latest_session.check_mode = 'complete'
                        AND latest_session.status = 'completed'
                        )
                    )
                ORDER BY latest_attempt.submitted_at DESC, latest_attempt.id DESC
                LIMIT 1
            ) AS latest_result ON true
            WHERE candidate.status = 'published'
                AND candidate.id <> $2
                AND candidate_revision.subject_id = $8
                AND candidate_revision.grade_id = $9
                AND candidate_revision.semester_id IS NOT DISTINCT FROM $10::uuid
                AND candidate_revision.book_version_id = $11
                AND candidate_revision.exam_program_level_id IS NOT DISTINCT FROM $12::uuid
                AND candidate_revision.source_category_id IS NOT DISTINCT FROM $7::uuid
                AND latest_result.current_result IS DISTINCT FROM 'correct'
                AND EXISTS (
                    SELECT 1
                    FROM question_bank_items AS bank_item
                    JOIN question_banks AS bank
                        ON bank.id = bank_item.question_bank_id
                        AND bank.status = 'active'
                    JOIN question_bank_learners AS bank_learner
                        ON bank_learner.question_bank_id = bank.id
                        AND bank_learner.learner_id = $1
                    WHERE bank_item.question_id = candidate.id
                )
                AND EXISTS (
                    SELECT 1
                    FROM question_parts AS part
                    WHERE part.question_revision_id = candidate_revision.id
                        AND part.is_independently_gradable = true
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM question_parts AS part
                    WHERE part.question_revision_id = candidate_revision.id
                        AND part.is_independently_gradable = true
                        AND (
                            NOT lerniqa_automatic_part_has_complete_answer(part.id, part.answer_mode)
                            OR NOT (
                                EXISTS (
                                    SELECT 1
                                    FROM question_content_blocks AS root_prompt
                                    LEFT JOIN assets AS root_prompt_asset
                                        ON root_prompt_asset.id = root_prompt.asset_id
                                        AND root_prompt_asset.deleted_at IS NULL
                                        AND root_prompt_asset.scan_status = 'clean'
                                        AND (
                                            (
                                                root_prompt.content_type = 'page_crop'
                                                AND root_prompt_asset.purpose = 'page_crop'
                                            )
                                            OR (
                                                root_prompt.content_type IN ('image', 'audio')
                                                AND root_prompt_asset.purpose = 'question_content'
                                            )
                                        )
                                    WHERE root_prompt.question_revision_id = candidate_revision.id
                                        AND root_prompt.question_part_id IS NULL
                                        AND root_prompt.question_option_id IS NULL
                                        AND root_prompt.placement = 'prompt'
                                        AND (
                                            lerniqa_text_has_non_whitespace(
                                                COALESCE(root_prompt.text_content, '')
                                            )
                                            OR root_prompt_asset.id IS NOT NULL
                                        )
                                )
                                OR EXISTS (
                                    SELECT 1
                                    FROM question_content_blocks AS part_prompt
                                    LEFT JOIN assets AS part_prompt_asset
                                        ON part_prompt_asset.id = part_prompt.asset_id
                                        AND part_prompt_asset.deleted_at IS NULL
                                        AND part_prompt_asset.scan_status = 'clean'
                                        AND (
                                            (
                                                part_prompt.content_type = 'page_crop'
                                                AND part_prompt_asset.purpose = 'page_crop'
                                            )
                                            OR (
                                                part_prompt.content_type IN ('image', 'audio')
                                                AND part_prompt_asset.purpose = 'question_content'
                                            )
                                        )
                                    WHERE part_prompt.question_revision_id = candidate_revision.id
                                        AND part_prompt.question_part_id = part.id
                                        AND part_prompt.question_option_id IS NULL
                                        AND part_prompt.placement = 'prompt'
                                        AND (
                                            lerniqa_text_has_non_whitespace(
                                                COALESCE(part_prompt.text_content, '')
                                            )
                                            OR part_prompt_asset.id IS NOT NULL
                                        )
                                )
                            )
                            OR (
                                part.answer_mode IN ('single_choice', 'multiple_choice', 'boolean')
                                AND (
                                    SELECT count(*)
                                    FROM question_options AS option
                                    WHERE option.question_part_id = part.id
                                ) < 2
                            )
                            OR (
                                part.answer_mode IN ('single_choice', 'multiple_choice', 'boolean')
                                AND EXISTS (
                                    SELECT 1
                                    FROM question_options AS option
                                    WHERE option.question_part_id = part.id
                                        AND NOT EXISTS (
                                            SELECT 1
                                            FROM question_content_blocks AS option_block
                                            LEFT JOIN assets AS option_asset
                                                ON option_asset.id = option_block.asset_id
                                                AND option_asset.deleted_at IS NULL
                                                AND option_asset.scan_status = 'clean'
                                                AND (
                                                    (
                                                        option_block.content_type = 'page_crop'
                                                        AND option_asset.purpose = 'page_crop'
                                                    )
                                                    OR (
                                                        option_block.content_type IN ('image', 'audio')
                                                        AND option_asset.purpose = 'question_content'
                                                    )
                                                )
                                            WHERE option_block.question_revision_id = candidate_revision.id
                                                AND option_block.question_part_id = part.id
                                                AND option_block.question_option_id = option.id
                                                AND option_block.placement = 'option'
                                                AND (
                                                    lerniqa_text_has_non_whitespace(
                                                        COALESCE(option_block.text_content, '')
                                                    )
                                                    OR option_asset.id IS NOT NULL
                                                )
                                        )
                                )
                            )
                        )
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM question_content_blocks AS invalid_media
                    LEFT JOIN assets AS invalid_media_asset
                        ON invalid_media_asset.id = invalid_media.asset_id
                        AND invalid_media_asset.deleted_at IS NULL
                        AND invalid_media_asset.scan_status = 'clean'
                        AND (
                            (
                                invalid_media.content_type = 'page_crop'
                                AND invalid_media_asset.purpose = 'page_crop'
                            )
                            OR (
                                invalid_media.content_type IN ('image', 'audio')
                                AND invalid_media_asset.purpose = 'question_content'
                            )
                        )
                    WHERE invalid_media.question_revision_id = candidate_revision.id
                        AND invalid_media.content_type IN ('image', 'audio', 'page_crop')
                        AND (
                            invalid_media.asset_id IS NULL
                            OR invalid_media_asset.id IS NULL
                        )
                )
        ), same_type AS (
            SELECT eligible.*, 'same_type'::text AS recommendation_kind
            FROM eligible
            WHERE eligible.is_same_type = true
        ), confirmed_similar AS (
            SELECT eligible.*, 'confirmed_similar'::text AS recommendation_kind
            FROM eligible
            WHERE eligible.similarity_group_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM same_type)
        ), topic_similar AS (
            SELECT eligible.*, 'topic_similar'::text AS recommendation_kind
            FROM eligible
            WHERE eligible.shared_topic_count > 0
                AND NOT EXISTS (SELECT 1 FROM same_type)
                AND NOT EXISTS (SELECT 1 FROM confirmed_similar)
        ), selected AS (
            SELECT * FROM same_type
            UNION ALL
            SELECT * FROM confirmed_similar
            UNION ALL
            SELECT * FROM topic_similar
        ), ranked AS (
            SELECT selected.*, count(*) OVER () AS total_count
            FROM selected
        )
        SELECT *
        FROM ranked
        ORDER BY
            has_previous_attempt ASC,
            shared_topic_count DESC,
            CASE WHEN difficulty_id IS NOT DISTINCT FROM $14::uuid THEN 0 ELSE 1 END,
            CASE
                WHEN regexp_replace(question_code, '^[0-9A-Fa-f]{16}:', '') ~ '^[0-9]+$'
                    THEN regexp_replace(question_code, '^[0-9A-Fa-f]{16}:', '')::numeric
                ELSE NULL
            END NULLS LAST,
            question_code NULLS LAST,
            question_id
        LIMIT $15
    `, [
        actor.learnerId,
        source.question_id,
        source.revision_id,
        source.question_type_id,
        source.question_type_code,
        source.original_question_type_label,
        source.source_category_id,
        source.subject_id,
        source.grade_id,
        source.semester_id,
        source.book_version_id,
        source.exam_program_level_id,
        source.unit_id,
        source.difficulty_level_id,
        limit,
    ]);
    return candidateResult.rows;
}

async function buildRecommendationResult(
    client: PoolClient,
    queueItemIds: readonly string[],
    limit: number,
    actor: LocalPracticeActor,
    lock: boolean,
): Promise<{
    result: LocalPracticeRecommendationResult;
    sources: RecommendationSourceRow[];
    candidates: RecommendationQuestionRow[];
}> {
    await requireLocalPracticeResultAccess(client, actor);
    const sources = await readRecommendationSources(client, queueItemIds, actor, lock);
    const source = sources[0]!;
    const candidates = await selectRecommendationQuestions(client, source, actor, limit);
    const recommendationKind = candidates[0]?.recommendation_kind ?? "none";
    const classificationLabel = recommendationClassificationLabel(
        source.original_question_type_label,
        source.question_type_name,
    );
    const runQuery: LocalPracticeQueryRunner = async <Row extends QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
    ) => (await client.query<Row>(text, [...values])).rows;
    const publicQuestions = await hydrateLocalPracticeQuestions(
        candidates,
        (candidate) => ({
            grade: candidate.grade_name,
            subject: candidate.subject_name,
            publisher: candidate.publisher_name ?? candidate.book_version_name,
            volume: candidate.volume_name,
            lesson: candidate.unit_name,
        }),
        runQuery,
    );
    const knowledgeRows = candidates.length === 0
        ? []
        : (await client.query<PracticeCatalogKnowledgeRow>(
            PRACTICE_CATALOG_KNOWLEDGE_SQL,
            [candidates.map((candidate) => candidate.revision_id)],
        )).rows;
    const questions = attachPracticeCatalogKnowledge(publicQuestions, knowledgeRows);
    return {
        sources,
        candidates,
        result: {
            recommendationKind,
            availableCount: Number(candidates[0]?.total_count ?? 0),
            classificationLabel,
            explanation: recommendationExplanation(recommendationKind, classificationLabel),
            questions,
            session: null,
        },
    };
}

function validateRecommendationRequest(queueItemIds: readonly string[], limit: number): void {
    if (
        queueItemIds.length === 0
        || queueItemIds.length > LOCAL_PRACTICE_MAX_QUESTIONS
        || new Set(queueItemIds).size !== queueItemIds.length
        || !Number.isSafeInteger(limit)
        || limit < 1
        || limit > LOCAL_PRACTICE_MAX_RECOMMENDATIONS
    ) {
        throw new LocalPracticeRequestError(
            "INVALID_RECOMMENDATION_REQUEST",
            "錯題來源或延伸練習題數不正確。",
            400,
        );
    }
}

interface RecommendationSourcePair {
    queueItemId: string;
    sourceResultId: string;
}

function canonicalRecommendationSourcePairs(
    queueItemIds: readonly string[],
    sourceResultIds: readonly string[],
): RecommendationSourcePair[] {
    if (queueItemIds.length !== sourceResultIds.length) {
        throw new LocalPracticeRequestError(
            "SESSION_IDEMPOTENCY_CONFLICT",
            "這個練習識別碼的來源紀錄不完整。",
            409,
        );
    }
    return queueItemIds.map((queueItemId, index) => ({
        queueItemId: queueItemId.toLowerCase(),
        sourceResultId: sourceResultIds[index]!.toLowerCase(),
    })).sort((left, right) => (
        left.queueItemId.localeCompare(right.queueItemId)
        || left.sourceResultId.localeCompare(right.sourceResultId)
    ));
}

function recommendationRequestHash(
    pairs: readonly RecommendationSourcePair[],
    limit: number,
    checkMode: LocalPracticeSessionSettings["checkMode"],
): string {
    return createHash("sha256").update(JSON.stringify({
        version: 1,
        sourcePairs: pairs,
        limit,
        checkMode,
    })).digest("hex");
}

function recommendationReceiptMatches(
    receipt: RecommendationRequestRow,
    queueItemIds: readonly string[],
    limit: number,
    actor: LocalPracticeActor,
    checkMode: LocalPracticeSessionSettings["checkMode"],
): boolean {
    const storedPairs = canonicalRecommendationSourcePairs(
        receipt.source_queue_item_ids,
        receipt.source_answer_part_result_ids,
    );
    const incomingQueueIds = [...queueItemIds].map((id) => id.toLowerCase()).sort();
    return receipt.learner_id === actor.learnerId
        && receipt.created_by_user_id === actor.userId
        && Number(receipt.requested_limit) === limit
        && receipt.check_mode === checkMode
        && storedPairs.map((pair) => pair.queueItemId).join("\n") === incomingQueueIds.join("\n")
        && recommendationRequestHash(storedPairs, limit, checkMode) === receipt.request_hash.trim();
}

function recommendationExplanation(
    recommendationKind: LocalPracticeRecommendationKind,
    classificationLabel: string,
): string {
    return recommendationKind === "same_type"
        ? `只選出同為「${classificationLabel}」且符合原題範圍的題目。`
        : recommendationKind === "confirmed_similar"
            ? "同題型沒有可用題目，因此改用已確認的相似題關聯。"
            : recommendationKind === "topic_similar"
                ? "同題型與已確認相似題已完成，因此依共同人物、作品、篇章或主題安排相近題。"
                : "相同與相近題已全部練習完成。";
}

async function readStoredRecommendationResult(
    client: PoolClient,
    receipt: RecommendationRequestRow,
    actor: LocalPracticeActor,
): Promise<LocalPracticeRecommendationResult> {
    await requireLocalPracticeResultAccess(client, actor);
    const session = await readSession(client, receipt.practice_session_id, actor);
    const storedResult = await client.query<StoredRecommendationQuestionRow>(`
        SELECT
            candidate.id AS question_id,
            candidate_revision.id AS revision_id,
            candidate_revision.revision_number,
            candidate_identifier.value AS question_code,
            candidate_type.id AS question_type_id,
            candidate_type.code AS question_type_code,
            candidate_type.name AS question_type_name,
            candidate_revision.original_question_type_label,
            grade.id AS grade_id,
            grade.code AS grade_code,
            grade.name AS grade_name,
            subject.id AS subject_id,
            subject.code AS subject_code,
            subject.name AS subject_name,
            semester.id AS semester_id,
            semester.code AS semester_code,
            semester.name AS semester_name,
            publisher.id AS publisher_id,
            publisher.code AS publisher_code,
            publisher.name AS publisher_name,
            book_version.id AS book_version_id,
            book_version.name AS book_version_name,
            unit.id AS unit_id,
            unit.code AS unit_code,
            unit.name AS unit_name,
            unit.unit_type,
            COALESCE(volume_unit.name, unit.name) AS volume_name,
            difficulty.id AS difficulty_id,
            difficulty.code AS difficulty_code,
            difficulty.name AS difficulty_name,
            item.selection_reason,
            recommendation_origin.similarity_group_id,
            recommendation_origin.match_basis,
            recommendation_origin.matched_topic_id,
            count(*) OVER () AS total_count
        FROM practice_session_items AS item
        JOIN practice_sessions AS session ON session.id = item.practice_session_id
        JOIN questions AS candidate ON candidate.id = item.question_id
        JOIN question_revisions AS candidate_revision
            ON candidate_revision.id = item.question_revision_id
            AND candidate_revision.question_id = candidate.id
        JOIN question_types AS candidate_type ON candidate_type.id = candidate_revision.question_type_id
        JOIN subjects AS subject ON subject.id = candidate_revision.subject_id
        JOIN grades AS grade ON grade.id = candidate_revision.grade_id
        LEFT JOIN semesters AS semester ON semester.id = candidate_revision.semester_id
        JOIN book_versions AS book_version ON book_version.id = candidate_revision.book_version_id
        LEFT JOIN publishers AS publisher ON publisher.id = book_version.publisher_id
        JOIN question_revision_units AS candidate_revision_unit
            ON candidate_revision_unit.question_revision_id = candidate_revision.id
            AND candidate_revision_unit.is_primary = true
        JOIN curriculum_units AS unit ON unit.id = candidate_revision_unit.curriculum_unit_id
        LEFT JOIN curriculum_units AS volume_unit ON volume_unit.id = unit.parent_unit_id
        LEFT JOIN difficulty_levels AS difficulty ON difficulty.id = candidate_revision.difficulty_level_id
        LEFT JOIN LATERAL (
            SELECT identifier.value
            FROM question_identifiers AS identifier
            WHERE identifier.question_id = candidate.id
            ORDER BY CASE identifier.identifier_type WHEN 'publisher_question' THEN 0 ELSE 1 END,
                identifier.value
            LIMIT 1
        ) AS candidate_identifier ON true
        LEFT JOIN LATERAL (
            SELECT origin.similarity_group_id, origin.match_basis, origin.matched_topic_id
            FROM practice_session_item_origins AS origin
            WHERE origin.practice_session_item_id = item.id
            ORDER BY origin.id
            LIMIT 1
        ) AS recommendation_origin ON true
        WHERE item.practice_session_id = $1
            AND session.learner_id = $2
            AND session.created_by_user_id = $3
        ORDER BY item.position, item.id
    `, [receipt.practice_session_id, actor.learnerId, actor.userId]);
    const selectionReasons = new Set(storedResult.rows.map((row) => row.selection_reason));
    const recommendationKind: LocalPracticeRecommendationKind = selectionReasons.size === 1
        && selectionReasons.has("same_type_review")
        ? "same_type"
        : selectionReasons.size === 1 && selectionReasons.has("similar_review")
            ? storedResult.rows.every((row) => row.match_basis === "same_topic" && row.matched_topic_id)
                ? "topic_similar"
                : "confirmed_similar"
            : "none";
    if (recommendationKind === "none" || storedResult.rows.length === 0) {
        throw new LocalPracticeRequestError(
            "SESSION_IDEMPOTENCY_CONFLICT",
            "這個練習識別碼的推薦內容不完整。",
            409,
        );
    }
    const expectedMode: LocalPracticeSessionSettings["mode"] = recommendationKind === "same_type"
        ? "review"
        : "similar";
    if (session.mode !== expectedMode || session.checkMode !== receipt.check_mode) {
        throw new LocalPracticeRequestError(
            "SESSION_IDEMPOTENCY_CONFLICT",
            "這個練習識別碼的推薦設定不一致。",
            409,
        );
    }
    const sourceResult = await client.query<{
        original_question_type_label: string | null;
        question_type_name: string;
    } & QueryResultRow>(`
        SELECT source_revision.original_question_type_label,
            source_type.name AS question_type_name
        FROM answer_part_results AS source_result
        JOIN answer_attempts AS source_attempt ON source_attempt.id = source_result.answer_attempt_id
        JOIN practice_session_items AS source_item ON source_item.id = source_attempt.practice_session_item_id
        JOIN question_revisions AS source_revision ON source_revision.id = source_item.question_revision_id
        JOIN question_types AS source_type ON source_type.id = source_revision.question_type_id
        WHERE source_result.id = ANY($1::uuid[])
        ORDER BY source_result.id
        LIMIT 1
    `, [receipt.source_answer_part_result_ids]);
    const source = sourceResult.rows[0];
    if (!source) {
        throw new LocalPracticeRequestError(
            "SESSION_IDEMPOTENCY_CONFLICT",
            "這個練習識別碼的錯題來源不存在。",
            409,
        );
    }
    const classificationLabel = recommendationClassificationLabel(
        source.original_question_type_label,
        source.question_type_name,
    );
    const runQuery: LocalPracticeQueryRunner = async <Row extends QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
    ) => (await client.query<Row>(text, [...values])).rows;
    const publicQuestions = await hydrateLocalPracticeQuestions(
        storedResult.rows,
        (candidate) => ({
            grade: candidate.grade_name,
            subject: candidate.subject_name,
            publisher: candidate.publisher_name ?? candidate.book_version_name,
            volume: candidate.volume_name,
            lesson: candidate.unit_name,
        }),
        runQuery,
    );
    const knowledgeRows = (await client.query<PracticeCatalogKnowledgeRow>(
        PRACTICE_CATALOG_KNOWLEDGE_SQL,
        [storedResult.rows.map((candidate) => candidate.revision_id)],
    )).rows;
    return {
        recommendationKind,
        availableCount: storedResult.rows.length,
        classificationLabel,
        explanation: recommendationExplanation(recommendationKind, classificationLabel),
        questions: attachPracticeCatalogKnowledge(publicQuestions, knowledgeRows),
        session,
    };
}

/** Previews one source question's strict same-type-or-confirmed-similar tier. */
export async function previewLocalPracticeRecommendations(
    queueItemIds: readonly string[],
    limit: number,
    actor: LocalPracticeActor,
): Promise<LocalPracticeRecommendationResult> {
    validateRecommendationRequest(queueItemIds, limit);
    return withLocalPostgresTransaction(async (client) => (
        await buildRecommendationResult(client, queueItemIds, limit, actor, false)
    ).result);
}

export interface CreateLocalPracticeRecommendationResult {
    recommendation: LocalPracticeRecommendationResult;
    replayed: boolean;
}

/** Creates or durably replays one fully traced recommendation session. */
export async function createLocalPracticeRecommendationSession(
    queueItemIds: readonly string[],
    limit: number,
    actor: LocalPracticeActor,
    checkMode: LocalPracticeSessionSettings["checkMode"],
    requestedSessionId: string = randomUUID(),
): Promise<CreateLocalPracticeRecommendationResult> {
    validateRecommendationRequest(queueItemIds, limit);
    if (checkMode === "score") {
        throw new LocalPracticeRequestError(
            "INVALID_RECOMMENDATION_REQUEST",
            "只顯示成績不保存逐題來源，不能建立錯題延伸練習。",
            400,
        );
    }
    requestedSessionId = requestedSessionId.toLowerCase();
    return withLocalPostgresSerializableTransaction(async (client) => {
        const receiptResult = await client.query<RecommendationRequestRow>(`
            SELECT practice_session_id, learner_id, created_by_user_id,
                source_queue_item_ids, source_answer_part_result_ids,
                requested_limit, check_mode, request_hash
            FROM practice_recommendation_requests
            WHERE practice_session_id = $1
            FOR UPDATE
        `, [requestedSessionId]);
        const receipt = receiptResult.rows[0];
        if (receipt) {
            if (!recommendationReceiptMatches(receipt, queueItemIds, limit, actor, checkMode)) {
                throw new LocalPracticeRequestError(
                    "SESSION_IDEMPOTENCY_CONFLICT",
                    "這個練習識別碼已用於不同的錯題延伸內容。",
                    409,
                );
            }
            return {
                recommendation: await readStoredRecommendationResult(client, receipt, actor),
                replayed: true,
            };
        }

        const existingSessionResult = await client.query<{ id: string } & QueryResultRow>(`
            SELECT id
            FROM practice_sessions
            WHERE id = $1
            FOR UPDATE
        `, [requestedSessionId]);
        if (existingSessionResult.rows[0]) {
            throw new LocalPracticeRequestError(
                "SESSION_IDEMPOTENCY_CONFLICT",
                "這個練習識別碼已用於沒有相符推薦請求的練習。",
                409,
            );
        }

        const built = await buildRecommendationResult(client, queueItemIds, limit, actor, true);
        if (built.result.recommendationKind === "none") {
            return { recommendation: built.result, replayed: false };
        }
        const mode: LocalPracticeSessionSettings["mode"] = built.result.recommendationKind === "same_type"
            ? "review"
            : "similar";
        const selectionReason = built.result.recommendationKind === "same_type"
            ? "same_type_review"
            : "similar_review";
        const relationKind = "similar_review";

        await client.query(`
            INSERT INTO practice_sessions (
                id, learner_id, created_by_user_id, mode, check_mode, status
            )
            VALUES ($1, $2, $3, $4, $5, 'active')
        `, [requestedSessionId, actor.learnerId, actor.userId, mode, checkMode]);

        const itemIds = built.candidates.map(() => randomUUID());
        await client.query(`
            INSERT INTO practice_session_items (
                id, practice_session_id, question_id, question_revision_id,
                question_part_id, position, selection_reason
            )
            SELECT requested.item_id, $1, requested.question_id,
                requested.revision_id, NULL, requested.position - 1, $5
            FROM unnest($2::uuid[], $3::uuid[], $4::uuid[])
                WITH ORDINALITY AS requested(item_id, question_id, revision_id, position)
        `, [
            requestedSessionId,
            itemIds,
            built.candidates.map((candidate) => candidate.question_id),
            built.candidates.map((candidate) => candidate.revision_id),
            selectionReason,
        ]);

        const originRows = built.candidates.flatMap((candidate, candidateIndex) => (
            built.sources.map((source) => ({ candidate, candidateIndex, source }))
        ));
        await client.query(`
            INSERT INTO practice_session_item_origins (
                id, practice_session_item_id, source_answer_part_result_id,
                queue_item_id, relation_kind, match_basis,
                similarity_group_id, matched_topic_id, matched_knowledge_point_id,
                matched_curriculum_unit_id, matched_subject_id
            )
            SELECT
                origin.id,
                origin.item_id,
                origin.source_result_id,
                NULL,
                $5,
                origin.match_basis,
                origin.similarity_group_id,
                origin.matched_topic_id,
                NULL,
                NULL,
                NULL
            FROM unnest(
                $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $6::uuid[], $7::text[]
            ) AS origin(
                id, item_id, source_result_id, similarity_group_id, matched_topic_id, match_basis
            )
        `, [
            originRows.map(() => randomUUID()),
            originRows.map(({ candidateIndex }) => itemIds[candidateIndex]),
            originRows.map(({ source }) => source.source_answer_part_result_id),
            originRows.map(({ candidate }) => (
                built.result.recommendationKind === "confirmed_similar"
                    ? candidate.similarity_group_id
                    : null
            )),
            relationKind,
            originRows.map(({ candidate }) => (
                built.result.recommendationKind === "topic_similar"
                    ? candidate.matched_topic_id
                    : null
            )),
            originRows.map(() => built.result.recommendationKind === "same_type"
                ? "same_question_type"
                : built.result.recommendationKind === "topic_similar"
                    ? "same_topic"
                    : "confirmed_group"),
        ]);

        const revalidatedSources = await readRecommendationSources(
            client,
            queueItemIds,
            actor,
            true,
        );
        const revalidatedCandidates = await selectRecommendationQuestions(
            client,
            revalidatedSources[0]!,
            actor,
            limit,
        );
        const sourcePairs = canonicalRecommendationSourcePairs(
            built.sources.map((source) => source.queue_item_id),
            built.sources.map((source) => source.source_answer_part_result_id),
        );
        const revalidatedSourcePairs = canonicalRecommendationSourcePairs(
            revalidatedSources.map((source) => source.queue_item_id),
            revalidatedSources.map((source) => source.source_answer_part_result_id),
        );
        const candidateFingerprint = (candidate: RecommendationQuestionRow) => ({
            questionId: candidate.question_id,
            revisionId: candidate.revision_id,
            recommendationKind: candidate.recommendation_kind,
            similarityGroupId: candidate.similarity_group_id,
            matchedTopicId: candidate.matched_topic_id,
        });
        if (
            JSON.stringify(sourcePairs) !== JSON.stringify(revalidatedSourcePairs)
            || JSON.stringify(built.candidates.map(candidateFingerprint))
                !== JSON.stringify(revalidatedCandidates.map(candidateFingerprint))
        ) {
            throw new LocalPracticeRequestError(
                "RECOMMENDATION_CHANGED",
                "錯題或可用推薦題目已更新，請重新預覽後再開始。",
                409,
            );
        }

        await client.query(`
            INSERT INTO practice_recommendation_requests (
                practice_session_id, learner_id, created_by_user_id,
                source_queue_item_ids, source_answer_part_result_ids,
                requested_limit, check_mode, request_hash
            )
            VALUES ($1, $2, $3, $4::uuid[], $5::uuid[], $6, $7, $8)
        `, [
            requestedSessionId,
            actor.learnerId,
            actor.userId,
            sourcePairs.map((pair) => pair.queueItemId),
            sourcePairs.map((pair) => pair.sourceResultId),
            limit,
            checkMode,
            recommendationRequestHash(sourcePairs, limit, checkMode),
        ]);

        return {
            recommendation: {
                ...built.result,
                availableCount: built.candidates.length,
                session: await readSession(client, requestedSessionId, actor),
            },
            replayed: false,
        };
    }, { advisoryLockKey: `practice-session:${requestedSessionId}` });
}

async function readSession(
    client: PoolClient,
    sessionId: string,
    actor: LocalPracticeActor,
): Promise<LocalPracticeSession> {
    const [sessionResult, itemsResult] = await Promise.all([
        client.query<SessionRow>(`
            SELECT id, learner_id, created_by_user_id, mode, check_mode, status,
                started_at, completed_at
            FROM practice_sessions
            WHERE id = $1 AND learner_id = $2 AND created_by_user_id = $3
        `, [sessionId, actor.learnerId, actor.userId]),
        client.query<SessionItemRow>(`
            SELECT item.id, item.question_id, item.question_revision_id, item.question_part_id,
                item.position,
                EXISTS (
                    SELECT 1
                    FROM answer_attempts AS attempt
                    WHERE attempt.practice_session_item_id = item.id
                ) OR EXISTS (
                    SELECT 1
                    FROM practice_score_receipts AS receipt
                    WHERE receipt.practice_session_item_id = item.id
                ) AS answered
            FROM practice_session_items AS item
            JOIN practice_sessions AS session ON session.id = item.practice_session_id
            WHERE item.practice_session_id = $1
                AND session.learner_id = $2
                AND session.created_by_user_id = $3
            ORDER BY item.position, item.id
        `, [sessionId, actor.learnerId, actor.userId]),
    ]);
    const session = sessionResult.rows[0];
    if (!session) {
        throw new LocalPracticeRequestError("SESSION_NOT_FOUND", "找不到這次練習。", 404);
    }
    return {
        id: session.id,
        mode: session.mode,
        checkMode: session.check_mode,
        status: session.status,
        startedAt: asIso(session.started_at),
        completedAt: session.completed_at ? asIso(session.completed_at) : null,
        items: itemsResult.rows.map((item) => ({
            id: item.id,
            questionId: item.question_id,
            revisionId: item.question_revision_id,
            partId: item.question_part_id,
            position: item.position,
            answered: item.answered,
        })),
    };
}

export interface CreateLocalPracticeSessionResult {
    session: LocalPracticeSession;
    replayed: boolean;
}

function sameSessionTargets(
    items: readonly SessionItemRow[],
    targets: readonly LocalPracticeSessionTarget[],
): boolean {
    return items.length === targets.length && items.every((item, index) => {
        const target = targets[index];
        return target !== undefined
            && item.question_id === target.questionId
            && (target.revisionId === undefined || item.question_revision_id === target.revisionId)
            && item.question_part_id === (target.partId ?? null);
    });
}

/** Reads one session only for the account and learner that created it. */
export async function getLocalPracticeSession(
    sessionId: string,
    actor: LocalPracticeActor,
): Promise<LocalPracticeSessionRead> {
    return withLocalPostgresTransaction(async (client) => {
        const session = await readSession(client, sessionId, actor);
        const disclosesResults = session.checkMode === "instant"
            || (session.checkMode === "complete" && session.status === "completed")
            || (session.checkMode === "score" && session.status === "completed");
        if (disclosesResults) await requireLocalPracticeResultAccess(client, actor);
        return readSessionDisclosure(client, session, actor);
    });
}

/** Creates an ad-hoc session owned by the authenticated learner. */
export async function createLocalPracticeSession(
    requestedTargets: readonly (string | LocalPracticeSessionTarget)[],
    actor: LocalPracticeActor,
    settings: LocalPracticeSessionSettings = { mode: "practice", checkMode: "instant" },
    requestedSessionId: string = randomUUID(),
): Promise<CreateLocalPracticeSessionResult> {
    requestedSessionId = requestedSessionId.toLowerCase();
    const targets = requestedTargets.map<LocalPracticeSessionTarget>((target) => {
        const value = typeof target === "string" ? { questionId: target } : target;
        return {
            questionId: value.questionId.toLowerCase(),
            ...(value.revisionId ? { revisionId: value.revisionId.toLowerCase() } : {}),
            ...(value.partId ? { partId: value.partId.toLowerCase() } : {}),
        };
    });
    const questionIds = targets.map((target) => target.questionId);
    const targetIdentities = targets.map((target) => `${target.questionId}:${target.partId ?? "all"}`);
    const targetPartsByQuestion = new Map<string, Array<string | null>>();
    for (const target of targets) {
        const parts = targetPartsByQuestion.get(target.questionId) ?? [];
        parts.push(target.partId ?? null);
        targetPartsByQuestion.set(target.questionId, parts);
    }
    const hasOverlappingWholeQuestionTarget = [...targetPartsByQuestion.values()].some((parts) => (
        parts.length > 1 && parts.includes(null)
    ));
    if (
        new Set(targetIdentities).size !== targetIdentities.length
        || hasOverlappingWholeQuestionTarget
    ) {
        throw new LocalPracticeRequestError(
            "DUPLICATE_SESSION_TARGET",
            "同一道題或同一小題不能重複加入同一輪練習。",
            400,
        );
    }
    return withLocalPostgresTransaction(async (client) => {
        await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
            [`practice-session:${requestedSessionId}`],
        );

        const existingSessionResult = await client.query<SessionRow>(`
            SELECT id, learner_id, created_by_user_id, mode, check_mode, status,
                started_at, completed_at
            FROM practice_sessions
            WHERE id = $1
            FOR UPDATE
        `, [requestedSessionId]);
        const existingSession = existingSessionResult.rows[0];
        if (existingSession) {
            if (
                existingSession.learner_id !== actor.learnerId
                || existingSession.created_by_user_id !== actor.userId
                || existingSession.mode !== settings.mode
                || existingSession.check_mode !== settings.checkMode
            ) {
                throw new LocalPracticeRequestError(
                    "SESSION_IDEMPOTENCY_CONFLICT",
                    "這個練習識別碼已用於不同的練習內容。",
                    409,
                );
            }
            const existingItems = await client.query<SessionItemRow>(`
                SELECT id, question_id, question_revision_id, question_part_id, position
                FROM practice_session_items
                WHERE practice_session_id = $1
                ORDER BY position, id
            `, [requestedSessionId]);
            if (!sameSessionTargets(existingItems.rows, targets)) {
                throw new LocalPracticeRequestError(
                    "SESSION_IDEMPOTENCY_CONFLICT",
                    "這個練習識別碼已用於不同的練習內容。",
                    409,
                );
            }
            return {
                session: await readSession(client, requestedSessionId, actor),
                replayed: true,
            };
        }

        const targetResult = await client.query<{
            question_id: string;
            revision_id: string;
            requested_revision_id: string | null;
            requested_part_id: string | null;
            part_is_valid: boolean;
        }>(`
            WITH requested AS (
                SELECT question_id, requested_revision_id, requested_part_id, position
                FROM unnest($7::uuid[], $8::uuid[], $9::uuid[])
                    WITH ORDINALITY AS input(
                        question_id,
                        requested_revision_id,
                        requested_part_id,
                        position
                    )
            ), target_questions AS (
                SELECT question.id AS question_id, revision.id AS revision_id
                ${TARGET_QUESTION_FROM_SQL}
                    AND question.id = ANY($7::uuid[])
                    AND EXISTS (
                        SELECT 1
                        FROM question_parts AS part
                        WHERE part.question_revision_id = revision.id
                            AND part.is_independently_gradable = true
                    )
                FOR SHARE OF question, revision
            )
            SELECT
                target.question_id,
                target.revision_id,
                requested.requested_revision_id,
                requested.requested_part_id,
                (
                    requested.requested_part_id IS NULL
                    OR selected_part.id IS NOT NULL
                ) AS part_is_valid
            FROM requested
            JOIN target_questions AS target ON target.question_id = requested.question_id
            LEFT JOIN question_parts AS selected_part
                ON selected_part.id = requested.requested_part_id
                AND selected_part.question_revision_id = target.revision_id
                AND selected_part.is_independently_gradable = true
            ORDER BY requested.position
        `, [
            LOCAL_PRACTICE_DEFAULT_FILTERS.grade,
            getSubjectLookupLabels(LOCAL_PRACTICE_DEFAULT_FILTERS.subject),
            LOCAL_PRACTICE_DEFAULT_FILTERS.publisher,
            LOCAL_PRACTICE_DEFAULT_FILTERS.volume,
            LOCAL_PRACTICE_DEFAULT_FILTERS.lesson,
            actor.learnerId,
            questionIds,
            targets.map((target) => target.revisionId ?? null),
            targets.map((target) => target.partId ?? null),
        ]);
        if (targetResult.rows.length !== targets.length) {
            throw new LocalPracticeRequestError(
                "QUESTION_TARGET_INVALID",
                "部分題目或小題不存在、尚未發布，或目前不可作答。請重新整理題庫。",
                409,
            );
        }
        const staleRevision = targetResult.rows.some((row) => (
            row.requested_revision_id !== null && row.requested_revision_id !== row.revision_id
        ));
        if (staleRevision) {
            throw new LocalPracticeRequestError(
                "QUESTION_REVISION_STALE",
                "題目內容已有更新，請重新整理題庫後再開始練習。",
                409,
            );
        }
        if (targetResult.rows.some((row) => !row.part_is_valid)) {
            throw new LocalPracticeRequestError(
                "QUESTION_TARGET_INVALID",
                "部分題目或小題不存在、尚未發布，或目前不可作答。請重新整理題庫。",
                409,
            );
        }

        await client.query(`
            INSERT INTO practice_sessions (
                id, learner_id, created_by_user_id, mode, check_mode, status
            )
            VALUES ($1, $2, $3, $4, $5, 'active')
        `, [requestedSessionId, actor.learnerId, actor.userId, settings.mode, settings.checkMode]);

        const itemIds = targetResult.rows.map(() => randomUUID());
        await client.query(`
            INSERT INTO practice_session_items (
                id,
                practice_session_id,
                question_id,
                question_revision_id,
                question_part_id,
                position,
                selection_reason
            )
            SELECT
                requested.item_id,
                $1::uuid,
                requested.question_id,
                requested.revision_id,
                requested.part_id,
                requested.position - 1,
                CASE WHEN requested.part_id IS NULL THEN 'fixed' ELSE 'wrong_review' END
            FROM unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[])
                WITH ORDINALITY AS requested(
                    item_id,
                    question_id,
                    revision_id,
                    part_id,
                    position
                )
        `, [
            requestedSessionId,
            itemIds,
            targetResult.rows.map((row) => row.question_id),
            targetResult.rows.map((row) => row.revision_id),
            targetResult.rows.map((row) => row.requested_part_id),
        ]);

        if (settings.checkMode === "score") {
            await client.query(`
                UPDATE practice_sessions
                SET score_total_count = $2,
                    score_pending_count = $2
                WHERE id = $1 AND check_mode = 'score'
            `, [requestedSessionId, targetResult.rows.length]);
        }

        return {
            session: await readSession(client, requestedSessionId, actor),
            replayed: false,
        };
    });
}

export type LocalPracticeMutableSessionStatus = "active" | "paused" | "abandoned";

/** Applies an idempotent, owner-scoped lifecycle transition to an unfinished session. */
export async function updateLocalPracticeSessionStatus(
    sessionId: string,
    status: LocalPracticeMutableSessionStatus,
    actor: LocalPracticeActor,
): Promise<LocalPracticeSession> {
    return withLocalPostgresTransaction(async (client) => {
        const sessionResult = await client.query<SessionRow>(`
            SELECT id, learner_id, created_by_user_id, mode, check_mode, status,
                started_at, completed_at
            FROM practice_sessions
            WHERE id = $1 AND learner_id = $2 AND created_by_user_id = $3
            FOR UPDATE
        `, [sessionId, actor.learnerId, actor.userId]);
        const session = sessionResult.rows[0];
        if (!session) {
            throw new LocalPracticeRequestError("SESSION_NOT_FOUND", "找不到這次練習。", 404);
        }
        if (session.status === "completed" || session.status === "abandoned") {
            if (session.status !== status) {
                throw new LocalPracticeRequestError("SESSION_NOT_ACTIVE", "這次練習已結束，不能變更狀態。", 409);
            }
            return readSession(client, sessionId, actor);
        }
        await client.query(`
            UPDATE practice_sessions
            SET status = $4
            WHERE id = $1 AND learner_id = $2 AND created_by_user_id = $3
        `, [sessionId, actor.learnerId, actor.userId, status]);
        return readSession(client, sessionId, actor);
    });
}

function payloadValue(payload: unknown): string | string[] | null {
    let parsed = payload;
    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed) as unknown;
        }
        catch {
            return null;
        }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !("value" in parsed)) return null;
    const value = (parsed as { value?: unknown }).value;
    if (typeof value === "string") return value;
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value;
    return null;
}

/**
 * 只公開已標記為手寫辨識來源的文字，避免把鍵盤答案誤標成辨識結果。
 * @param payload 資料庫保存的作答內容。
 * @returns 可顯示的辨識文字；其他輸入來源不回傳內容。
 */
function payloadRecognizedText(payload: unknown): string | undefined {
    let parsed = payload;
    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed) as unknown;
        }
        catch {
            return undefined;
        }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as { value?: unknown; inputMethod?: unknown };
    return record.inputMethod === "handwriting_recognition" && typeof record.value === "string"
        ? record.value
        : undefined;
}

function feedbackFromStored(
    row: AttemptPartRow,
    hasHandwriting: boolean,
): LocalPracticeAttemptPartResult["feedbackCode"] {
    if (row.current_result === "correct" || row.current_result === "wrong") return row.current_result;
    if (hasHandwriting && row.grading_source === "manual_review") return "manual_review";
    const value = payloadValue(row.answer_payload);
    const isMissing = value === null
        || (typeof value === "string" && normalizeLocalPracticeText(value) === "")
        || (Array.isArray(value) && value.length === 0);
    if (isMissing) return "missing_answer";
    if (row.grading_source === "manual_review" || row.grading_source === "ai_assisted_review") {
        return row.grading_source;
    }
    return "missing_answer_key";
}

function toAttempt(
    row: AttemptRow,
    partRows: readonly AttemptPartRow[],
    referenceAnswers: readonly LocalPracticeReferenceAnswer[],
    assetRows: readonly AttemptAssetRow[] = [],
): LocalPracticeAttempt {
    return {
        id: row.id,
        sessionId: row.practice_session_id,
        ...(row.session_mode ? { sessionMode: row.session_mode } : {}),
        sessionItemId: row.practice_session_item_id,
        questionId: row.question_id,
        revisionId: row.question_revision_id,
        overallResult: row.overall_result,
        gradingSource: row.grading_source,
        durationSeconds: row.duration_seconds,
        submittedAt: asIso(row.submitted_at),
        parts: partRows.map((part) => {
            const handwritingAssets = assetRows
                .filter((asset) => asset.question_part_id === part.question_part_id)
                .map((asset) => ({
                    id: asset.asset_id,
                    mimeType: asset.mime_type,
                    width: asset.width,
                    height: asset.height,
                    url: `/api/v1/local-practice/assets/${asset.asset_id}?kind=answer`,
                }));
            const recognizedText = payloadRecognizedText(part.answer_payload);
            return {
                partId: part.question_part_id,
                result: part.current_result,
                gradingSource: part.grading_source,
                feedbackCode: feedbackFromStored(part, handwritingAssets.length > 0),
                handwritingAssets,
                ...(recognizedText ? { recognizedText } : {}),
            };
        }),
        referenceAnswers: [...referenceAnswers],
    };
}

async function getAttemptParts(client: PoolClient, attemptIds: readonly string[]): Promise<AttemptPartRow[]> {
    if (attemptIds.length === 0) return [];
    const result = await client.query<AttemptPartRow>(`
        SELECT result.id, result.answer_attempt_id, result.question_part_id, result.answer_payload,
            result.current_result, result.grading_source
        FROM answer_part_results AS result
        JOIN question_parts AS part ON part.id = result.question_part_id
        WHERE result.answer_attempt_id = ANY($1::uuid[])
        ORDER BY result.answer_attempt_id, part.position, part.id
    `, [attemptIds]);
    return result.rows;
}

async function getAttemptHandwritingAssets(
    client: PoolClient,
    attemptIds: readonly string[],
): Promise<AttemptAssetRow[]> {
    if (attemptIds.length === 0) return [];
    const result = await client.query<AttemptAssetRow>(`
        SELECT
            part_result.answer_attempt_id,
            part_result.question_part_id,
            asset.id AS asset_id,
            asset.mime_type,
            asset.width,
            asset.height,
            asset.checksum
        FROM answer_part_results AS part_result
        JOIN answer_part_assets AS link
            ON link.answer_part_result_id = part_result.id
            AND link.asset_role = 'handwriting'
        JOIN assets AS asset
            ON asset.id = link.asset_id
            AND asset.purpose = 'handwriting'
            AND asset.sensitivity = 'private'
            AND asset.scan_status = 'clean'
            AND asset.deleted_at IS NULL
            AND asset.mime_type = 'image/png'
            AND asset.width IS NOT NULL
            AND asset.height IS NOT NULL
        WHERE part_result.answer_attempt_id = ANY($1::uuid[])
        ORDER BY part_result.answer_attempt_id, part_result.question_part_id,
            link.position, asset.id
    `, [attemptIds]);
    return result.rows;
}

function groupReferenceAnswerRows(
    rows: readonly ReferenceAnswerRow[],
): Map<string, LocalPracticeReferenceAnswer[]> {
    const grouped = new Map<string, Map<string, LocalPracticeReferenceAnswer>>();
    for (const row of rows) {
        const byPart = grouped.get(row.answer_attempt_id) ?? new Map<string, LocalPracticeReferenceAnswer>();
        const answer = byPart.get(row.part_id) ?? {
            partId: row.part_id,
            answerMode: row.answer_mode,
            answerKeys: [],
            acceptedValues: [],
            options: [],
            explanation: row.explanation,
        };
        if (row.answer_key !== null && !answer.answerKeys.includes(row.answer_key)) {
            answer.answerKeys.push(row.answer_key);
        }
        if (row.accepted_value !== null && !answer.acceptedValues.includes(row.accepted_value)) {
            answer.acceptedValues.push(row.accepted_value);
        }
        if (
            row.option_key !== null
            && !answer.options.some((option) => option.key === row.option_key)
        ) {
            answer.options.push({ key: row.option_key, label: row.option_label ?? row.option_key });
        }
        byPart.set(row.part_id, answer);
        grouped.set(row.answer_attempt_id, byPart);
    }
    return new Map(
        [...grouped].map(([attemptId, byPart]) => [attemptId, [...byPart.values()]]),
    );
}

/** Reads answer material through the submitted item so the pinned revision is authoritative. */
async function getAttemptReferenceAnswers(
    client: PoolClient,
    attemptIds: readonly string[],
): Promise<Map<string, LocalPracticeReferenceAnswer[]>> {
    if (attemptIds.length === 0) return new Map();
    const result = await client.query<ReferenceAnswerRow>(`
        SELECT
            attempt.id AS answer_attempt_id,
            part.id AS part_id,
            part.answer_mode,
            answer.answer_key,
            answer.accepted_value,
            disclosed_option.option_key,
            option_content.label AS option_label,
            explanation.text AS explanation
        FROM answer_attempts AS attempt
        JOIN practice_session_items AS item
            ON item.id = attempt.practice_session_item_id
        JOIN answer_part_results AS part_result
            ON part_result.answer_attempt_id = attempt.id
        JOIN question_parts AS part
            ON part.id = part_result.question_part_id
            AND part.question_revision_id = item.question_revision_id
        LEFT JOIN question_answers AS answer ON answer.question_part_id = part.id
        LEFT JOIN question_options AS disclosed_option ON disclosed_option.question_part_id = part.id
        LEFT JOIN LATERAL (
            SELECT COALESCE(
                NULLIF(
                    string_agg(COALESCE(block.text_content, block.alt_text), E'\n' ORDER BY block.position, block.id),
                    ''
                ),
                disclosed_option.option_key
            ) AS label
            FROM question_content_blocks AS block
            WHERE block.question_option_id = disclosed_option.id
                AND block.placement = 'option'
                AND (block.text_content IS NOT NULL OR block.alt_text IS NOT NULL)
        ) AS option_content ON true
        LEFT JOIN LATERAL (
            SELECT NULLIF(
                string_agg(COALESCE(block.text_content, block.alt_text), E'\n' ORDER BY block.position, block.id),
                ''
            ) AS text
            FROM question_content_blocks AS block
            WHERE block.question_revision_id = item.question_revision_id
                AND block.placement = 'explanation'
                AND (block.text_content IS NOT NULL OR block.alt_text IS NOT NULL)
                AND (block.question_part_id IS NULL OR block.question_part_id = part.id)
        ) AS explanation ON true
        WHERE attempt.id = ANY($1::uuid[])
        ORDER BY attempt.id, part.position, part.id,
            answer.position, answer.id, disclosed_option.position, disclosed_option.id
    `, [attemptIds]);
    return groupReferenceAnswerRows(result.rows);
}

/**
 * Reads an explicitly opened catalog question for result-capable actors only.
 * The requested revision must still be the question's current published revision.
 */
export async function getLocalPracticeQuestionReferenceAnswers(
    questionId: string,
    revisionId: string,
    actor: LocalPracticeActor,
): Promise<LocalPracticeReferenceAnswer[]> {
    return withLocalPostgresTransaction(async (client) => {
        await requireLocalPracticeResultAccess(client, actor);
        const result = await client.query<ReferenceAnswerRow>(`
            SELECT
                question.id AS answer_attempt_id,
                part.id AS part_id,
                part.answer_mode,
                answer.answer_key,
                answer.accepted_value,
                disclosed_option.option_key,
                option_content.label AS option_label,
                explanation.text AS explanation
            FROM questions AS question
            JOIN question_revisions AS revision
                ON revision.id = question.current_revision_id
                AND revision.question_id = question.id
            JOIN question_parts AS part
                ON part.question_revision_id = revision.id
                AND part.is_independently_gradable = true
            LEFT JOIN question_answers AS answer ON answer.question_part_id = part.id
            LEFT JOIN question_options AS disclosed_option
                ON disclosed_option.question_part_id = part.id
            LEFT JOIN LATERAL (
                SELECT COALESCE(
                    NULLIF(
                        string_agg(COALESCE(block.text_content, block.alt_text), E'\n' ORDER BY block.position, block.id),
                        ''
                    ),
                    disclosed_option.option_key
                ) AS label
                FROM question_content_blocks AS block
                WHERE block.question_option_id = disclosed_option.id
                    AND block.placement = 'option'
                    AND (block.text_content IS NOT NULL OR block.alt_text IS NOT NULL)
            ) AS option_content ON true
            LEFT JOIN LATERAL (
                SELECT NULLIF(
                    string_agg(COALESCE(block.text_content, block.alt_text), E'\n' ORDER BY block.position, block.id),
                    ''
                ) AS text
                FROM question_content_blocks AS block
                WHERE block.question_revision_id = revision.id
                    AND block.placement = 'explanation'
                    AND (block.text_content IS NOT NULL OR block.alt_text IS NOT NULL)
                    AND (block.question_part_id IS NULL OR block.question_part_id = part.id)
            ) AS explanation ON true
            WHERE question.id = $1
                AND revision.id = $2
                AND question.status = 'published'
                AND revision.status = 'published'
                AND EXISTS (
                    SELECT 1
                    FROM question_bank_items AS bank_item
                    JOIN question_banks AS bank
                        ON bank.id = bank_item.question_bank_id
                        AND bank.status = 'active'
                    JOIN question_bank_learners AS bank_learner
                        ON bank_learner.question_bank_id = bank.id
                    WHERE bank_item.question_id = question.id
                        AND bank_learner.learner_id = $3
                )
            ORDER BY part.position, part.id,
                answer.position, answer.id, disclosed_option.position, disclosed_option.id
            FOR SHARE OF question, revision, part
        `, [questionId.toLowerCase(), revisionId.toLowerCase(), actor.learnerId]);
        if (result.rows.length === 0) {
            throw new LocalPracticeRequestError(
                "QUESTION_REFERENCE_NOT_FOUND",
                "找不到可查看的題目參考答案，題目內容可能已更新。",
                404,
            );
        }
        return groupReferenceAnswerRows(result.rows).get(questionId.toLowerCase()) ?? [];
    });
}

function toAttemptReceipt(row: AttemptRow): LocalPracticeAttemptReceipt {
    return {
        id: row.id,
        sessionId: row.practice_session_id,
        sessionItemId: row.practice_session_item_id,
        questionId: row.question_id,
        revisionId: row.question_revision_id,
        submittedAt: asIso(row.submitted_at),
    };
}

function toSessionMetadata(session: LocalPracticeSession): LocalPracticeSessionMetadata {
    return {
        id: session.id,
        mode: session.mode,
        checkMode: session.checkMode,
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
    };
}

function scoreSummary(total: number, correct: number, wrong: number, pending: number): LocalPracticeScoreSummary {
    const graded = correct + wrong;
    return {
        total,
        correct,
        wrong,
        pending,
        accuracy: graded === 0 ? 0 : Math.round(correct / graded * 100),
    };
}

async function readSessionScoreSummary(
    client: PoolClient,
    sessionId: string,
    actor: LocalPracticeActor,
): Promise<LocalPracticeScoreSummary> {
    const result = await client.query<{
        total: number;
        correct: number;
        wrong: number;
        pending: number;
    } & QueryResultRow>(`
        SELECT
            session.score_total_count AS total,
            session.score_correct_count AS correct,
            session.score_wrong_count AS wrong,
            session.score_pending_count AS pending
        FROM practice_sessions AS session
        WHERE session.id = $1
            AND session.learner_id = $2
            AND session.created_by_user_id = $3
            AND session.check_mode = 'score'
    `, [sessionId, actor.learnerId, actor.userId]);
    const row = result.rows[0];
    return scoreSummary(
        Number(row?.total ?? 0),
        Number(row?.correct ?? 0),
        Number(row?.wrong ?? 0),
        Number(row?.pending ?? 0),
    );
}

async function readSessionAttempts(
    client: PoolClient,
    sessionId: string,
    actor: LocalPracticeActor,
): Promise<LocalPracticeAttempt[]> {
    const result = await client.query<AttemptRow>(`
        SELECT
            attempt.id,
            attempt.practice_session_item_id,
            item.practice_session_id,
            session.mode AS session_mode,
            session.check_mode AS session_check_mode,
            session.status AS session_status,
            item.question_id,
            item.question_revision_id,
            attempt.overall_result,
            attempt.grading_source,
            attempt.duration_seconds,
            attempt.submitted_at
        FROM answer_attempts AS attempt
        JOIN practice_session_items AS item ON item.id = attempt.practice_session_item_id
        JOIN practice_sessions AS session ON session.id = item.practice_session_id
        WHERE session.id = $1
            AND session.learner_id = $2
            AND session.created_by_user_id = $3
        ORDER BY item.position, attempt.attempt_number, attempt.id
    `, [sessionId, actor.learnerId, actor.userId]);
    const attemptIds = result.rows.map((attempt) => attempt.id);
    const [partRows, referencesByAttempt, assets] = await Promise.all([
        getAttemptParts(client, attemptIds),
        getAttemptReferenceAnswers(client, attemptIds),
        getAttemptHandwritingAssets(client, attemptIds),
    ]);
    const partsByAttempt = new Map<string, AttemptPartRow[]>();
    for (const part of partRows) {
        const current = partsByAttempt.get(part.answer_attempt_id) ?? [];
        current.push(part);
        partsByAttempt.set(part.answer_attempt_id, current);
    }
    return result.rows.map((attempt) => toAttempt(
        attempt,
        partsByAttempt.get(attempt.id) ?? [],
        referencesByAttempt.get(attempt.id) ?? [],
        assets.filter((asset) => asset.answer_attempt_id === attempt.id),
    ));
}

async function readSessionDisclosure(
    client: PoolClient,
    session: LocalPracticeSession,
    actor: LocalPracticeActor,
): Promise<LocalPracticeSessionRead> {
    if (session.checkMode === "score" && session.status === "completed") {
        return {
            disclosure: "score",
            session: toSessionMetadata(session),
            summary: await readSessionScoreSummary(client, session.id, actor),
        };
    }
    if (canDiscloseLocalPracticeReferenceAnswers(session.checkMode, session.status)) {
        return {
            disclosure: "detailed",
            session,
            attempts: await readSessionAttempts(client, session.id, actor),
        };
    }
    return { disclosure: "masked", session };
}

function sameAnswerPayload(
    rows: readonly AttemptPartRow[],
    answers: ReadonlyMap<string, string | string[]>,
): boolean {
    if (rows.length === 0) return false;
    return rows.every((row) => {
        const existing = payloadValue(row.answer_payload);
        const requested = answers.get(row.question_part_id) ?? null;
        return JSON.stringify(existing) === JSON.stringify(requested);
    }) && [...answers.keys()].every((partId) => rows.some((row) => row.question_part_id === partId));
}

function sameHandwritingPayload(
    partRows: readonly AttemptPartRow[],
    assetRows: readonly AttemptAssetRow[],
    handwriting: ValidatedHandwritingPng | undefined,
): boolean {
    if (!handwriting) return assetRows.length === 0;
    // A null pending/manual payload means ink supplied the answer. Otherwise a
    // calculation-only canvas is anchored once to the first ordered part.
    const handwrittenParts = partRows.filter((part) => (
        payloadValue(part.answer_payload) === null
        && part.current_result === "pending"
        && part.grading_source === "manual_review"
    ));
    const linkedParts = handwrittenParts.length > 0 ? handwrittenParts : partRows.slice(0, 1);
    if (linkedParts.length === 0 || assetRows.length !== linkedParts.length) return false;
    return linkedParts.every((part) => {
        const matching = assetRows.filter((asset) => asset.question_part_id === part.question_part_id);
        return matching.length === 1 && matching[0]?.checksum === handwriting.checksum;
    }) && partRows.every((part) => (
        linkedParts.includes(part)
        || !assetRows.some((asset) => asset.question_part_id === part.question_part_id)
    ));
}

function toScoreReceipt(row: ScoreReceiptRow): LocalPracticeAttemptReceipt {
    return {
        id: row.id,
        sessionId: row.practice_session_id,
        sessionItemId: row.practice_session_item_id,
        questionId: row.question_id,
        revisionId: row.question_revision_id,
        submittedAt: asIso(row.submitted_at),
    };
}

async function discloseSubmittedScoreReceipt(
    client: PoolClient,
    receipt: ScoreReceiptRow,
    session: Pick<SessionRow, "id" | "check_mode" | "status" | "completed_at">,
    actor: LocalPracticeActor,
    replayed: boolean,
): Promise<SubmitLocalPracticeAttemptResult> {
    const sessionView = {
        id: session.id,
        status: session.status,
        completedAt: session.completed_at ? asIso(session.completed_at) : null,
    };
    if (session.status === "completed") {
        return {
            disclosure: "score",
            summary: await readSessionScoreSummary(client, session.id, actor),
            session: sessionView,
            replayed,
        };
    }
    return {
        disclosure: "masked",
        receipt: toScoreReceipt(receipt),
        session: sessionView,
        replayed,
    };
}

async function discloseSubmittedAttempt(
    client: PoolClient,
    attemptRow: AttemptRow,
    partRows: readonly AttemptPartRow[],
    session: Pick<SessionRow, "id" | "check_mode" | "status" | "completed_at">,
    actor: LocalPracticeActor,
    replayed: boolean,
): Promise<SubmitLocalPracticeAttemptResult> {
    const sessionView = {
        id: session.id,
        status: session.status,
        completedAt: session.completed_at ? asIso(session.completed_at) : null,
    };
    if (session.check_mode === "instant") {
        const [referencesByAttempt, assets] = await Promise.all([
            getAttemptReferenceAnswers(client, [attemptRow.id]),
            getAttemptHandwritingAssets(client, [attemptRow.id]),
        ]);
        return {
            disclosure: "detailed",
            attempt: toAttempt(
                attemptRow,
                partRows,
                referencesByAttempt.get(attemptRow.id) ?? [],
                assets,
            ),
            session: sessionView,
            replayed,
        };
    }
    if (session.check_mode === "complete" && session.status === "completed") {
        const attempts = await readSessionAttempts(client, session.id, actor);
        const attempt = attempts.find((candidate) => candidate.id === attemptRow.id);
        if (!attempt) throw new Error("completed session did not return its submitted attempt");
        return {
            disclosure: "detailed",
            attempt,
            attempts,
            session: sessionView,
            replayed,
        };
    }
    if (session.check_mode === "score" && session.status === "completed") {
        return {
            disclosure: "score",
            summary: await readSessionScoreSummary(client, session.id, actor),
            session: sessionView,
            replayed,
        };
    }
    return {
        disclosure: "masked",
        receipt: toAttemptReceipt(attemptRow),
        session: sessionView,
        replayed,
    };
}

export interface SubmitLocalPracticeAttemptInput {
    sessionId: string;
    questionId: string;
    /** Preferred identity when a review session contains the same question more than once. */
    sessionItemId?: string;
    /** Compatibility selector for a review item pinned to one part. */
    partId?: string;
    idempotencyKey: string;
    durationSeconds: number | null;
    answers: LocalPracticeAnswerInput[];
    handwriting?: ValidatedHandwritingPng;
    /** Part whose submitted text came from the isolated handwriting transcriber. */
    handwritingTranscriptionPartId?: string;
}

export type SubmitLocalPracticeAttemptResult = LocalPracticeAttemptSubmission & { replayed: boolean };

/** Grades one question atomically; score mode stores only aggregate plus an answer-free receipt. */
export async function submitLocalPracticeAttempt(
    input: SubmitLocalPracticeAttemptInput,
    actor: LocalPracticeActor,
): Promise<SubmitLocalPracticeAttemptResult> {
    input = {
        ...input,
        sessionId: input.sessionId.toLowerCase(),
        questionId: input.questionId.toLowerCase(),
        ...(input.sessionItemId ? { sessionItemId: input.sessionItemId.toLowerCase() } : {}),
        ...(input.partId ? { partId: input.partId.toLowerCase() } : {}),
        ...(input.handwritingTranscriptionPartId
            ? { handwritingTranscriptionPartId: input.handwritingTranscriptionPartId.toLowerCase() }
            : {}),
        answers: input.answers.map((answer) => ({
            ...answer,
            partId: answer.partId.toLowerCase(),
        })),
    };
    let storedHandwritingObject: StoredHandwritingObject | undefined;
    try {
        return await withLocalPostgresTransaction(async (client) => {
        await requireLocalPracticeResultAccess(client, actor);
        await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
            [`${actor.learnerId}:${input.idempotencyKey}`],
        );

        const normalizedInput = new Map<string, string | string[]>();
        for (const answer of input.answers) {
            const normalized = gradeLocalPracticePart({
                answerMode: Array.isArray(answer.value) ? "multiple_choice" : "text",
                gradingPolicy: "manual_review",
                acceptedKeys: [],
                acceptedValues: [],
                validOptionKeys: [],
            }, answer.value).answerPayload.value;
            const hasValue = Array.isArray(normalized)
                ? normalized.length > 0
                : normalized !== null && normalizeLocalPracticeText(normalized) !== "";
            if (normalized !== null && hasValue) normalizedInput.set(answer.partId, normalized);
        }

        if (input.sessionItemId === undefined && input.partId === undefined) {
            const matchingItemCount = await client.query<{ count: number } & QueryResultRow>(`
                SELECT count(*)::integer AS count
                FROM practice_session_items AS item
                JOIN practice_sessions AS session ON session.id = item.practice_session_id
                WHERE item.practice_session_id = $1
                    AND item.question_id = $2
                    AND session.learner_id = $3
                    AND session.created_by_user_id = $4
            `, [input.sessionId, input.questionId, actor.learnerId, actor.userId]);
            if ((matchingItemCount.rows[0]?.count ?? 0) > 1) {
                throw new LocalPracticeRequestError(
                    "SESSION_QUESTION_AMBIGUOUS",
                    "這次練習包含同一道題的多個小題，請指定練習項目。",
                    409,
                );
            }
        }

        const existingScoreReceiptResult = await client.query<ScoreReceiptRow>(`
            SELECT
                receipt.id,
                receipt.practice_session_item_id,
                item.practice_session_id,
                session.check_mode AS session_check_mode,
                session.status AS session_status,
                session.created_by_user_id AS session_created_by_user_id,
                item.question_id,
                item.question_revision_id,
                item.question_part_id AS session_item_part_id,
                receipt.submitted_at
            FROM practice_score_receipts AS receipt
            JOIN practice_session_items AS item
                ON item.id = receipt.practice_session_item_id
            JOIN practice_sessions AS session
                ON session.id = item.practice_session_id
            WHERE receipt.learner_id = $1
                AND receipt.idempotency_key = $2
        `, [actor.learnerId, input.idempotencyKey]);
        const existingScoreReceipt = existingScoreReceiptResult.rows[0];
        if (existingScoreReceipt) {
            if (input.handwriting) {
                throw new LocalPracticeRequestError(
                    "HANDWRITING_SCORE_MODE_UNSUPPORTED",
                    "只顯示成績模式不保存作答內容；請改用逐題或全部作答後檢核。",
                    409,
                );
            }
            if (
                existingScoreReceipt.practice_session_id !== input.sessionId
                || existingScoreReceipt.question_id !== input.questionId
                || (
                    input.sessionItemId !== undefined
                    && existingScoreReceipt.practice_session_item_id !== input.sessionItemId
                )
                || (
                    input.partId !== undefined
                    && existingScoreReceipt.session_item_part_id !== input.partId
                )
                || existingScoreReceipt.session_created_by_user_id !== actor.userId
            ) {
                throw new LocalPracticeRequestError(
                    "IDEMPOTENCY_CONFLICT",
                    "這個重送識別碼已用於不同的作答內容。",
                    409,
                );
            }
            const sessionResult = await client.query<SessionRow>(`
                SELECT id, check_mode, status, completed_at
                FROM practice_sessions
                WHERE id = $1 AND learner_id = $2 AND created_by_user_id = $3
            `, [input.sessionId, actor.learnerId, actor.userId]);
            const session = sessionResult.rows[0];
            if (!session) throw new LocalPracticeRequestError("SESSION_NOT_FOUND", "找不到這次練習。", 404);
            return discloseSubmittedScoreReceipt(
                client,
                existingScoreReceipt,
                session,
                actor,
                true,
            );
        }

        const existingResult = await client.query<AttemptRow>(`
            SELECT
                attempt.id,
                attempt.practice_session_item_id,
                item.practice_session_id,
                session.mode AS session_mode,
                session.check_mode AS session_check_mode,
                session.status AS session_status,
                session.created_by_user_id AS session_created_by_user_id,
                item.question_id,
                item.question_revision_id,
                item.question_part_id AS session_item_part_id,
                attempt.overall_result,
                attempt.grading_source,
                attempt.duration_seconds,
                attempt.submitted_at
            FROM answer_attempts AS attempt
            JOIN practice_session_items AS item ON item.id = attempt.practice_session_item_id
            JOIN practice_sessions AS session ON session.id = item.practice_session_id
            WHERE attempt.learner_id = $1
                AND attempt.idempotency_key = $2
        `, [actor.learnerId, input.idempotencyKey]);
        const existing = existingResult.rows[0];
        if (existing) {
            if (
                existing.practice_session_id !== input.sessionId
                || existing.question_id !== input.questionId
                || (input.sessionItemId !== undefined && existing.practice_session_item_id !== input.sessionItemId)
                || (input.partId !== undefined && existing.session_item_part_id !== input.partId)
                || existing.session_created_by_user_id !== actor.userId
                || existing.duration_seconds !== input.durationSeconds
            ) {
                throw new LocalPracticeRequestError(
                    "IDEMPOTENCY_CONFLICT",
                    "這個重送識別碼已用於不同的作答內容。",
                    409,
                );
            }
            const [partRows, assetRows] = await Promise.all([
                getAttemptParts(client, [existing.id]),
                getAttemptHandwritingAssets(client, [existing.id]),
            ]);
            if (
                !sameAnswerPayload(partRows, normalizedInput)
                || !sameHandwritingPayload(partRows, assetRows, input.handwriting)
            ) {
                throw new LocalPracticeRequestError(
                    "IDEMPOTENCY_CONFLICT",
                    "這個重送識別碼已用於不同的作答內容。",
                    409,
                );
            }
            const sessionResult = await client.query<SessionRow>(`
                SELECT id, check_mode, status, completed_at
                FROM practice_sessions
                WHERE id = $1 AND learner_id = $2 AND created_by_user_id = $3
            `, [input.sessionId, actor.learnerId, actor.userId]);
            const session = sessionResult.rows[0];
            if (!session) throw new LocalPracticeRequestError("SESSION_NOT_FOUND", "找不到這次練習。", 404);
            return discloseSubmittedAttempt(client, existing, partRows, session, actor, true);
        }

        const itemResult = await client.query<SessionItemRow & {
            session_check_mode: LocalPracticeSessionSettings["checkMode"];
            session_status: LocalPracticeSession["status"];
        }>(`
            SELECT
                item.id,
                item.question_id,
                item.question_revision_id,
                item.question_part_id,
                item.position,
                session.check_mode AS session_check_mode,
                session.status AS session_status
            FROM practice_session_items AS item
            JOIN practice_sessions AS session ON session.id = item.practice_session_id
            WHERE item.practice_session_id = $1
                AND item.question_id = $2
                AND ($3::uuid IS NULL OR item.id = $3)
                AND ($4::uuid IS NULL OR item.question_part_id = $4)
                AND session.learner_id = $5
                AND session.created_by_user_id = $6
            FOR UPDATE OF item, session
        `, [
            input.sessionId,
            input.questionId,
            input.sessionItemId ?? null,
            input.partId ?? null,
            actor.learnerId,
            actor.userId,
        ]);
        if (itemResult.rows.length === 0) {
            throw new LocalPracticeRequestError(
                "SESSION_QUESTION_NOT_FOUND",
                "這道題不屬於指定的練習。",
                404,
            );
        }
        if (itemResult.rows.length > 1) {
            throw new LocalPracticeRequestError(
                "SESSION_QUESTION_AMBIGUOUS",
                "這次練習包含重複題目，請重新建立練習。",
                409,
            );
        }
        const item = itemResult.rows[0];
        const answeredResult = await client.query<{ exists: boolean } & QueryResultRow>(`
            SELECT EXISTS (
                SELECT 1
                FROM answer_attempts AS attempt
                WHERE attempt.practice_session_item_id = $1
                UNION ALL
                SELECT 1
                FROM practice_score_receipts AS receipt
                WHERE receipt.practice_session_item_id = $1
            ) AS exists
        `, [item.id]);
        if (answeredResult.rows[0]?.exists) {
            throw new LocalPracticeRequestError(
                "SESSION_ITEM_ALREADY_ANSWERED",
                "這道題已經保存，不能以新的重送識別碼再次作答。",
                409,
            );
        }
        if (!(["active", "paused"] as const).includes(item.session_status as "active" | "paused")) {
            throw new LocalPracticeRequestError("SESSION_NOT_ACTIVE", "這次練習已結束，不能新增作答。", 409);
        }
        if (input.handwriting && item.session_check_mode === "score") {
            throw new LocalPracticeRequestError(
                "HANDWRITING_SCORE_MODE_UNSUPPORTED",
                "只顯示成績模式不保存作答內容；請改用逐題或全部作答後檢核。",
                409,
            );
        }

        const partResult = await client.query<GradePartRow>(`
            SELECT
                part.id,
                part.answer_mode,
                part.grading_policy,
                part.position,
                answer.answer_key,
                answer.accepted_value,
                ARRAY(
                    SELECT option.option_key
                    FROM question_options AS option
                    WHERE option.question_part_id = part.id
                    ORDER BY option.position, option.id
                ) AS valid_option_keys
            FROM question_parts AS part
            LEFT JOIN question_answers AS answer ON answer.question_part_id = part.id
            WHERE part.question_revision_id = $1
                AND part.is_independently_gradable = true
                AND ($2::uuid IS NULL OR part.id = $2)
            ORDER BY part.position, part.id, answer.position, answer.id
            FOR SHARE OF part
        `, [item.question_revision_id, item.question_part_id]);
        if (partResult.rows.length === 0) {
            throw new LocalPracticeRequestError("QUESTION_NOT_GRADABLE", "這道題目前沒有可作答的小題。", 409);
        }

        const groupedParts = new Map<string, {
            row: GradePartRow;
            acceptedKeys: string[];
            acceptedValues: string[];
            validOptionKeys: string[];
        }>();
        for (const row of partResult.rows) {
            const current = groupedParts.get(row.id) ?? {
                row,
                acceptedKeys: [],
                acceptedValues: [],
                validOptionKeys: row.valid_option_keys,
            };
            if (row.answer_key !== null) current.acceptedKeys.push(row.answer_key);
            if (row.accepted_value !== null) current.acceptedValues.push(row.accepted_value);
            groupedParts.set(row.id, current);
        }

        for (const [partId, value] of normalizedInput) {
            const part = groupedParts.get(partId)?.row;
            if (!part) {
                throw new LocalPracticeRequestError("INVALID_ANSWER_PART", "作答包含不屬於這道題的小題。", 400);
            }
            if (part.answer_mode !== "multiple_choice" && Array.isArray(value)) {
                throw new LocalPracticeRequestError("INVALID_ANSWER_VALUE", "這個小題只能提交一個答案。", 400);
            }
        }
        const missingParts = [...groupedParts.values()].filter(({ row }) => !normalizedInput.has(row.id));
        if (
            missingParts.length > 0
            && (!input.handwriting || missingParts.some(({ row }) => row.answer_mode !== "text"))
        ) {
            throw new LocalPracticeRequestError(
                "INCOMPLETE_ANSWER",
                item.question_part_id === null
                    ? "請完成這道題的所有小題後再提交。"
                    : "請完成指定小題後再提交。",
                400,
            );
        }
        const handwrittenPartIds = new Set(missingParts.map(({ row }) => row.id));
        if (
            input.handwritingTranscriptionPartId
            && (
                !input.handwriting
                || !groupedParts.has(input.handwritingTranscriptionPartId)
                || !normalizedInput.has(input.handwritingTranscriptionPartId)
                || groupedParts.get(input.handwritingTranscriptionPartId)?.row.answer_mode !== "text"
            )
        ) {
            throw new LocalPracticeRequestError(
                "INVALID_HANDWRITING_TRANSCRIPTION",
                "手寫辨識結果與這道題的小題不一致。",
                400,
            );
        }
        const calculationAnchorPartId = input.handwriting && handwrittenPartIds.size === 0
            ? input.handwritingTranscriptionPartId ?? groupedParts.keys().next().value as string | undefined
            : undefined;

        const gradedParts = [...groupedParts.values()].map(({
            row,
            acceptedKeys,
            acceptedValues,
            validOptionKeys,
        }) => {
            const submittedValue = normalizedInput.get(row.id);
            const usesHandwriting = Boolean(input.handwriting) && handwrittenPartIds.has(row.id);
            const usesTranscription = Boolean(input.handwriting)
                && input.handwritingTranscriptionPartId === row.id;
            const grade = gradeLocalPracticePart({
                answerMode: row.answer_mode,
                gradingPolicy: usesTranscription ? "automatic" : row.grading_policy,
                acceptedKeys,
                acceptedValues,
                validOptionKeys,
            }, submittedValue);
            return {
                partId: row.id,
                attachesHandwriting: usesHandwriting || usesTranscription || row.id === calculationAnchorPartId,
                usesHandwriting,
                ...(usesHandwriting
                    ? {
                        result: "pending" as const,
                        gradingSource: "manual_review" as const,
                        feedbackCode: "manual_review" as const,
                        answerPayload: { value: null },
                    }
                    : {
                        ...grade,
                        answerPayload: usesTranscription
                            ? { ...grade.answerPayload, inputMethod: "handwriting_recognition" as const }
                            : grade.answerPayload,
                    }),
            };
        });
        const overallResult = deriveLocalPracticeOverallResult(gradedParts.map((part) => part.result));
        const gradingSource = deriveLocalPracticeGradingSource(gradedParts.map((part) => part.gradingSource));

        if (item.session_check_mode === "score") {
            const receiptResult = await client.query<ScoreReceiptRow>(`
                INSERT INTO practice_score_receipts (
                    id,
                    practice_session_item_id,
                    learner_id,
                    idempotency_key
                )
                VALUES ($1, $2, $3, $4)
                RETURNING
                    id,
                    practice_session_item_id,
                    $5::uuid AS practice_session_id,
                    'score'::varchar AS session_check_mode,
                    $6::varchar AS session_status,
                    $7::uuid AS session_created_by_user_id,
                    $8::uuid AS question_id,
                    $9::uuid AS question_revision_id,
                    $10::uuid AS session_item_part_id,
                    submitted_at
            `, [
                randomUUID(),
                item.id,
                actor.learnerId,
                input.idempotencyKey,
                input.sessionId,
                item.session_status,
                actor.userId,
                item.question_id,
                item.question_revision_id,
                item.question_part_id,
            ]);
            const receipt = receiptResult.rows[0];
            if (!receipt) throw new Error("score receipt insert did not return a row");

            const finalSessionResult = await client.query<SessionRow>(`
                UPDATE practice_sessions AS session
                SET score_answered_count = session.score_answered_count + 1,
                    score_correct_count = session.score_correct_count
                        + CASE WHEN $4 = 'correct' THEN 1 ELSE 0 END,
                    score_wrong_count = session.score_wrong_count
                        + CASE WHEN $4 = 'wrong' THEN 1 ELSE 0 END,
                    score_pending_count = session.score_pending_count
                        - CASE WHEN $4 IN ('correct', 'wrong') THEN 1 ELSE 0 END,
                    status = CASE
                        WHEN session.score_answered_count + 1 = session.score_total_count
                            THEN 'completed'
                        ELSE session.status
                    END,
                    completed_at = CASE
                        WHEN session.score_answered_count + 1 = session.score_total_count
                            THEN transaction_timestamp()
                        ELSE session.completed_at
                    END
                WHERE session.id = $1
                    AND session.learner_id = $2
                    AND session.created_by_user_id = $3
                    AND session.check_mode = 'score'
                    AND session.status IN ('active', 'paused')
                RETURNING id, check_mode, status, completed_at
            `, [input.sessionId, actor.learnerId, actor.userId, overallResult]);
            const finalSession = finalSessionResult.rows[0];
            if (!finalSession) throw new Error("score aggregate update did not return its session");
            return discloseSubmittedScoreReceipt(client, receipt, finalSession, actor, false);
        }

        let handwritingAssetId: string | undefined;
        if (input.handwriting) {
            const identity = deriveHandwritingObjectIdentity({
                learnerId: actor.learnerId,
                sessionItemId: item.id,
                idempotencyKey: input.idempotencyKey,
                checksum: input.handwriting.checksum,
            });
            storedHandwritingObject = await storeHandwritingObject(identity, input.handwriting);
            handwritingAssetId = identity.assetId;
            await client.query(`
                INSERT INTO assets (
                    id, storage_key, mime_type, byte_size, width, height,
                    checksum, purpose, sensitivity, scan_status, created_by_user_id
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'handwriting', 'private', 'clean', $8)
            `, [
                identity.assetId,
                identity.storageKey,
                input.handwriting.mimeType,
                input.handwriting.bytes.length,
                input.handwriting.width,
                input.handwriting.height,
                input.handwriting.checksum,
                actor.userId,
            ]);
        }

        const attemptId = randomUUID();
        const attemptNumberResult = await client.query<{ next_attempt_number: number }>(`
            SELECT count(*)::integer + 1 AS next_attempt_number
            FROM answer_attempts
            WHERE practice_session_item_id = $1
        `, [item.id]);
        const attemptNumber = attemptNumberResult.rows[0]?.next_attempt_number ?? 1;

        const insertedAttempt = await client.query<AttemptRow>(`
            INSERT INTO answer_attempts (
                id,
                practice_session_item_id,
                learner_id,
                attempt_number,
                idempotency_key,
                overall_result,
                grading_source,
                duration_seconds
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING
                id,
                practice_session_item_id,
                $9::uuid AS practice_session_id,
                $10::uuid AS question_id,
                $11::uuid AS question_revision_id,
                $12::uuid AS session_item_part_id,
                overall_result,
                grading_source,
                duration_seconds,
                submitted_at
        `, [
            attemptId,
            item.id,
            actor.learnerId,
            attemptNumber,
            input.idempotencyKey,
            overallResult,
            gradingSource,
            input.durationSeconds,
            input.sessionId,
            input.questionId,
            item.question_revision_id,
            item.question_part_id,
        ]);

        const insertedPartRows: AttemptPartRow[] = [];
        for (const graded of gradedParts) {
            const result = await client.query<AttemptPartRow>(`
                INSERT INTO answer_part_results (
                    id,
                    answer_attempt_id,
                    question_part_id,
                    answer_payload,
                    initial_result,
                    current_result,
                    grading_source
                )
                VALUES ($1, $2, $3, $4::jsonb, $5, $5, $6)
                RETURNING id, answer_attempt_id, question_part_id, answer_payload,
                    current_result, grading_source
            `, [
                randomUUID(),
                attemptId,
                graded.partId,
                JSON.stringify(graded.answerPayload),
                graded.result,
                graded.gradingSource,
            ]);
            const inserted = result.rows[0];
            if (!inserted) throw new Error("answer part insert did not return a row");
            insertedPartRows.push(inserted);

            if (handwritingAssetId && graded.attachesHandwriting) {
                await client.query(`
                    INSERT INTO answer_part_assets (
                        answer_part_result_id, asset_id, asset_role, position
                    )
                    VALUES ($1, $2, 'handwriting', 0)
                `, [inserted.id, handwritingAssetId]);

                if (graded.result === "pending" && graded.gradingSource === "manual_review") {
                    await client.query(`
                        INSERT INTO handwriting_analysis_jobs (
                            id,
                            answer_part_result_id,
                            asset_id,
                            question_revision_id,
                            question_part_id,
                            asset_checksum,
                            status
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, 'queued')
                    `, [
                        randomUUID(),
                        inserted.id,
                        handwritingAssetId,
                        item.question_revision_id,
                        graded.partId,
                        input.handwriting!.checksum,
                    ]);
                }
            }

            if (graded.result === "wrong") {
                await client.query(`
                    INSERT INTO learner_practice_queue_items (
                        id,
                        learner_id,
                        question_id,
                        question_revision_id,
                        question_part_id,
                        reason,
                        source_answer_part_result_id,
                        status,
                        added_by_user_id
                    )
                    VALUES ($1, $2, $3, $4, $5, 'wrong_review', $6, 'pending', $7)
                `, [
                    randomUUID(),
                    actor.learnerId,
                    item.question_id,
                    item.question_revision_id,
                    graded.partId,
                    inserted.id,
                    actor.userId,
                ]);
            }
        }

        await client.query(`
            INSERT INTO analytics_outbox (
                id, event_type, source_record_id, aggregate_key, occurred_at
            )
            VALUES ($1, 'attempt_submitted', $2, $3, transaction_timestamp())
        `, [randomUUID(), attemptId, `learner:${actor.learnerId}`]);

        const completedResult = await client.query<SessionRow>(`
            UPDATE practice_sessions AS session
            SET status = 'completed', completed_at = transaction_timestamp()
            WHERE session.id = $1
                AND session.learner_id = $2
                AND session.created_by_user_id = $3
                AND session.status IN ('active', 'paused')
                AND NOT EXISTS (
                    SELECT 1
                    FROM practice_session_items AS pending_item
                    WHERE pending_item.practice_session_id = session.id
                        AND NOT EXISTS (
                            SELECT 1
                            FROM answer_attempts AS submitted
                            WHERE submitted.practice_session_item_id = pending_item.id
                        )
                )
            RETURNING id, check_mode, status, completed_at
        `, [input.sessionId, actor.learnerId, actor.userId]);
        const finalSessionResult = completedResult.rows[0]
            ? completedResult
            : await client.query<SessionRow>(`
                SELECT id, check_mode, status, completed_at
                FROM practice_sessions
                WHERE id = $1 AND learner_id = $2 AND created_by_user_id = $3
            `, [input.sessionId, actor.learnerId, actor.userId]);
        const finalSession = finalSessionResult.rows[0];
        const attempt = insertedAttempt.rows[0];
        if (!finalSession || !attempt) throw new Error("attempt transaction did not return its final rows");

            return discloseSubmittedAttempt(client, attempt, insertedPartRows, finalSession, actor, false);
        });
    }
    catch (error) {
        if (storedHandwritingObject?.created) {
            try {
                const committed = await queryLocalPostgres<{ exists: boolean } & QueryResultRow>(`
                    SELECT EXISTS (SELECT 1 FROM assets WHERE id = $1) AS exists
                `, [storedHandwritingObject.assetId]);
                if (!committed.rows[0]?.exists) await removeHandwritingObject(storedHandwritingObject);
            }
            catch {
                // If commit state cannot be confirmed, retain the deterministic private object.
                // The same idempotency retry reuses it; a controlled orphan cleanup may remove it later.
            }
        }
        throw error;
    }
}

/**
 * 找出一次手寫送出可安全補入的唯一文字小題。
 * @param input 練習與已填答案識別。
 * @param actor 目前登入帳號與學習者。
 * @returns 唯一缺少答案的文字小題；不符合時回傳 null。
 */
export async function findLocalPracticeHandwritingPart(
    input: Pick<SubmitLocalPracticeAttemptInput, "sessionId" | "questionId" | "sessionItemId" | "partId" | "answers">,
    actor: LocalPracticeActor,
): Promise<string | null> {
    const answeredPartIds = input.answers.map((answer) => answer.partId.toLowerCase());
    const result = await queryLocalPostgres<{ id: string } & QueryResultRow>(`
        SELECT part.id
        FROM practice_session_items AS item
        JOIN practice_sessions AS session ON session.id = item.practice_session_id
        JOIN learner_access AS access
          ON access.learner_id = session.learner_id
         AND access.user_id = session.created_by_user_id
         AND access.can_view_results = true
         AND access.accepted_at IS NOT NULL
         AND access.revoked_at IS NULL
        JOIN question_parts AS part
          ON part.question_revision_id = item.question_revision_id
         AND (item.question_part_id IS NULL OR part.id = item.question_part_id)
        WHERE item.practice_session_id = $1
          AND item.question_id = $2
          AND ($3::uuid IS NULL OR item.id = $3)
          AND ($4::uuid IS NULL OR item.question_part_id = $4)
          AND session.learner_id = $5
          AND session.created_by_user_id = $6
          AND session.check_mode IN ('instant', 'complete')
          AND session.status IN ('active', 'paused')
          AND part.answer_mode = 'text'
          AND part.is_independently_gradable = true
          AND NOT (part.id = ANY($7::uuid[]))
        ORDER BY part.position, part.id
        LIMIT 2
    `, [
        input.sessionId.toLowerCase(),
        input.questionId.toLowerCase(),
        input.sessionItemId?.toLowerCase() ?? null,
        input.partId?.toLowerCase() ?? null,
        actor.learnerId,
        actor.userId,
        answeredPartIds,
    ]);
    return result.rows.length === 1 ? result.rows[0]!.id : null;
}

/** Hydrates durable attempts and pending wrong-review work without answer payloads. */
export async function getLocalPracticeHistory(limit: number, actor: LocalPracticeActor, attemptOffset = 0): Promise<{
    attempts: LocalPracticeHistory["attempts"];
    wrongReviewQueue: LocalPracticeHistory["wrongReviewQueue"];
    sessions: LocalPracticeHistory["sessions"];
}> {
    return withLocalPostgresTransaction(async (client) => {
        await requireLocalPracticeResultAccess(client, actor);
        const [attemptResult, sessionResult, queueResult] = await Promise.all([
            client.query<AttemptRow>(`
                SELECT
                    attempt.id,
                    attempt.practice_session_item_id,
                    item.practice_session_id,
                    session.mode AS session_mode,
                    session.check_mode AS session_check_mode,
                    session.status AS session_status,
                    item.question_id,
                    item.question_revision_id,
                    attempt.overall_result,
                    attempt.grading_source,
                    attempt.duration_seconds,
                    attempt.submitted_at
                FROM answer_attempts AS attempt
                JOIN practice_session_items AS item ON item.id = attempt.practice_session_item_id
                JOIN practice_sessions AS session ON session.id = item.practice_session_id
                WHERE attempt.learner_id = $1
                    AND (
                        session.check_mode = 'instant'
                        OR (session.check_mode = 'complete' AND session.status = 'completed')
                    )
                ORDER BY attempt.submitted_at DESC, attempt.id DESC
                LIMIT $2 OFFSET $3
            `, [actor.learnerId, limit, attemptOffset]),
            client.query<SessionHistoryRow>(`
                SELECT
                    session.id,
                    session.mode,
                    session.check_mode,
                    session.status,
                    session.started_at,
                    session.completed_at,
                    CASE WHEN session.check_mode = 'score'
                        THEN session.score_total_count
                        ELSE count(item.id)::integer
                    END AS item_count,
                    CASE WHEN session.check_mode = 'score'
                        THEN session.score_answered_count
                        ELSE count(item.id) FILTER (WHERE latest.id IS NOT NULL)::integer
                    END AS attempted_item_count,
                    CASE WHEN session.check_mode = 'score'
                        THEN session.score_correct_count
                        ELSE count(item.id) FILTER (WHERE latest.overall_result = 'correct')::integer
                    END AS correct_count,
                    CASE WHEN session.check_mode = 'score'
                        THEN session.score_wrong_count
                        ELSE count(item.id) FILTER (WHERE latest.overall_result = 'wrong')::integer
                    END AS wrong_count,
                    CASE WHEN session.check_mode = 'score'
                        THEN session.score_pending_count
                        ELSE count(item.id) FILTER (
                            WHERE latest.id IS NULL OR latest.overall_result = 'pending'
                        )::integer
                    END AS pending_count
                FROM practice_sessions AS session
                LEFT JOIN practice_session_items AS item ON item.practice_session_id = session.id
                LEFT JOIN LATERAL (
                    SELECT attempt.id, attempt.overall_result
                    FROM answer_attempts AS attempt
                    WHERE attempt.practice_session_item_id = item.id
                    ORDER BY attempt.attempt_number DESC, attempt.id DESC
                    LIMIT 1
                ) AS latest ON true
                WHERE session.learner_id = $1
                GROUP BY session.id
                ORDER BY session.started_at DESC, session.id DESC
                LIMIT $2 OFFSET $3
            `, [actor.learnerId, limit, attemptOffset]),
            client.query<WrongQueueRow>(`
                SELECT queue.id, queue.question_id, queue.question_revision_id,
                    queue.question_part_id, queue.created_at,
                    count(*) OVER () AS total_count
                FROM learner_practice_queue_items AS queue
                JOIN answer_part_results AS result
                    ON result.id = queue.source_answer_part_result_id
                    AND result.question_part_id = queue.question_part_id
                    AND result.current_result = 'wrong'
                JOIN answer_attempts AS attempt
                    ON attempt.id = result.answer_attempt_id
                    AND attempt.learner_id = queue.learner_id
                JOIN practice_session_items AS item
                    ON item.id = attempt.practice_session_item_id
                    AND item.question_id = queue.question_id
                    AND item.question_revision_id = queue.question_revision_id
                JOIN practice_sessions AS session
                    ON session.id = item.practice_session_id
                    AND session.learner_id = queue.learner_id
                JOIN questions AS source_question
                    ON source_question.id = queue.question_id
                    AND source_question.current_revision_id = queue.question_revision_id
                    AND source_question.status = 'published'
                WHERE queue.learner_id = $1
                    AND queue.reason = 'wrong_review'
                    AND queue.status = 'pending'
                    AND (
                        session.check_mode = 'instant'
                        OR (session.check_mode = 'complete' AND session.status = 'completed')
                    )
                    AND NOT EXISTS (
                        SELECT 1
                        FROM answer_part_results AS newer_result
                        JOIN answer_attempts AS newer_attempt
                            ON newer_attempt.id = newer_result.answer_attempt_id
                            AND newer_attempt.learner_id = queue.learner_id
                        JOIN practice_session_items AS newer_item
                            ON newer_item.id = newer_attempt.practice_session_item_id
                            AND newer_item.question_id = queue.question_id
                        JOIN practice_sessions AS newer_session
                            ON newer_session.id = newer_item.practice_session_id
                            AND newer_session.learner_id = queue.learner_id
                        WHERE newer_result.question_part_id = result.question_part_id
                            AND (
                                newer_session.check_mode = 'instant'
                                OR (
                                    newer_session.check_mode = 'complete'
                                    AND newer_session.status = 'completed'
                                )
                            )
                            AND (newer_attempt.submitted_at, newer_attempt.id)
                                > (attempt.submitted_at, attempt.id)
                    )
                ORDER BY queue.created_at DESC, queue.id DESC
                LIMIT $2 OFFSET $3
            `, [actor.learnerId, limit, attemptOffset]),
        ]);
        const attemptIds = attemptResult.rows.map((attempt) => attempt.id);
        const [partRows, referencesByAttempt, assets] = await Promise.all([
            getAttemptParts(client, attemptIds),
            getAttemptReferenceAnswers(client, attemptIds),
            getAttemptHandwritingAssets(client, attemptIds),
        ]);
        const partsByAttempt = new Map<string, AttemptPartRow[]>();
        for (const part of partRows) {
            const current = partsByAttempt.get(part.answer_attempt_id) ?? [];
            current.push(part);
            partsByAttempt.set(part.answer_attempt_id, current);
        }

        return {
            attempts: attemptResult.rows.map((attempt) => toAttempt(
                attempt,
                partsByAttempt.get(attempt.id) ?? [],
                referencesByAttempt.get(attempt.id) ?? [],
                assets.filter((asset) => asset.answer_attempt_id === attempt.id),
            )),
            wrongReviewQueue: {
                pendingCount: Number(queueResult.rows[0]?.total_count ?? 0),
                items: queueResult.rows.map((item) => ({
                    id: item.id,
                    questionId: item.question_id,
                    revisionId: item.question_revision_id,
                    partId: item.question_part_id,
                    createdAt: asIso(item.created_at),
                })),
            },
            sessions: sessionResult.rows.map((session): LocalPracticeSessionHistory => {
                const disclosure = session.check_mode === "score"
                    ? session.status === "completed" ? "score" : "masked"
                    : session.check_mode === "complete" && session.status !== "completed"
                        ? "masked"
                        : "detailed";
                return {
                    id: session.id,
                    mode: session.mode,
                    checkMode: session.check_mode,
                    status: session.status,
                    startedAt: asIso(session.started_at),
                    completedAt: session.completed_at ? asIso(session.completed_at) : null,
                    itemCount: session.item_count,
                    attemptedItemCount: session.attempted_item_count,
                    disclosure,
                    ...(disclosure === "score" ? {
                        summary: scoreSummary(
                            session.item_count,
                            session.correct_count,
                            session.wrong_count,
                            session.pending_count,
                        ),
                    } : {}),
                };
            }),
        };
    });
}

/** Resolves a safe question-content asset only when a current published target references it. */
export async function findLocalPracticeAsset(
    assetId: string,
    filters: LocalPracticeFilters,
    actor: LocalPracticeActor,
): Promise<LocalPracticeAssetRecord | null> {
    const result = await queryLocalPostgres<QueryResultRow & {
        id: string;
        storage_key: string;
        mime_type: string;
        byte_size: string | number;
        checksum: string;
    }>(`
        SELECT DISTINCT asset.id, asset.storage_key, asset.mime_type, asset.byte_size, asset.checksum
        FROM assets AS asset
        JOIN question_content_blocks AS block ON block.asset_id = asset.id
        JOIN questions AS question ON question.current_revision_id = block.question_revision_id
        JOIN question_revisions AS revision
            ON revision.id = question.current_revision_id
            AND revision.question_id = question.id
        JOIN grades AS grade ON grade.id = revision.grade_id
        JOIN subjects AS subject ON subject.id = revision.subject_id
        JOIN book_versions AS book_version ON book_version.id = revision.book_version_id
        LEFT JOIN publishers AS publisher ON publisher.id = book_version.publisher_id
        JOIN question_revision_units AS revision_unit
            ON revision_unit.question_revision_id = revision.id
            AND revision_unit.is_primary = true
        JOIN curriculum_units AS unit ON unit.id = revision_unit.curriculum_unit_id
        LEFT JOIN curriculum_units AS volume_unit ON volume_unit.id = unit.parent_unit_id
        WHERE asset.id = $1
            AND asset.deleted_at IS NULL
            AND asset.scan_status = 'clean'
            AND (
                (block.content_type = 'page_crop' AND asset.purpose = 'page_crop')
                OR (
                    block.content_type IN ('image', 'audio')
                    AND asset.purpose = 'question_content'
                )
            )
            AND block.placement IN ('prompt', 'option')
            AND question.status = 'published'
            AND revision.status = 'published'
            AND grade.stage = 'junior_high'
            AND grade.status = 'active'
            AND subject.status = 'active'
            AND book_version.status = 'active'
            AND unit.status = 'active'
            AND (grade.name = $2 OR grade.code = $2)
            AND (
                subject.name = ANY($3::text[])
                OR subject.normalized_name = ANY($3::text[])
                OR subject.code = ANY($3::text[])
                OR EXISTS (
                    SELECT 1
                    FROM subject_aliases AS alias
                    WHERE alias.subject_id = subject.id
                        AND alias.status = 'active'
                        AND (alias.alias = ANY($3::text[]) OR alias.normalized_alias = ANY($3::text[]))
                )
            )
            AND (
                publisher.name = $4
                OR publisher.code = $4
                OR position($4 IN book_version.name) > 0
            )
            AND (
                unit.name = $5
                OR unit.code = $5
                OR volume_unit.name = $5
                OR volume_unit.code = $5
            )
            AND (
                unit.name = $6
                OR (
                    left(unit.name, char_length($6)) = $6
                    AND substring(unit.name FROM char_length($6) + 1 FOR 1) IN (' ', '　', ':', '：')
                )
                OR unit.code = $6
            )
            AND EXISTS (
                SELECT 1
                FROM question_bank_items AS bank_item
                JOIN question_banks AS bank
                    ON bank.id = bank_item.question_bank_id
                    AND bank.status = 'active'
                JOIN question_bank_learners AS bank_learner
                    ON bank_learner.question_bank_id = bank.id
                WHERE bank_item.question_id = question.id
                    AND bank_learner.learner_id = $7
            )
        LIMIT 1
    `, [
        assetId,
        filters.grade,
        getSubjectLookupLabels(filters.subject),
        filters.publisher,
        filters.volume,
        filters.lesson,
        actor.learnerId,
    ]);
    const asset = result.rows[0];
    return asset
        ? {
            id: asset.id,
            storageKey: asset.storage_key,
            mimeType: asset.mime_type,
            byteSize: Number(asset.byte_size),
            checksum: asset.checksum,
        }
        : null;
}

/** Resolves a private handwritten answer through its attempt, learner and disclosure policy. */
export async function findLocalPracticeAnswerAsset(
    assetId: string,
    actor: LocalPracticeActor,
): Promise<LocalPracticeAssetRecord | null> {
    const result = await queryLocalPostgres<QueryResultRow & {
        id: string;
        storage_key: string;
        mime_type: string;
        byte_size: string | number;
        checksum: string;
        width: number;
        height: number;
    }>(`
        SELECT DISTINCT
            asset.id,
            asset.storage_key,
            asset.mime_type,
            asset.byte_size,
            asset.checksum,
            asset.width,
            asset.height
        FROM assets AS asset
        JOIN answer_part_assets AS link
            ON link.asset_id = asset.id
            AND link.asset_role = 'handwriting'
        JOIN answer_part_results AS part_result
            ON part_result.id = link.answer_part_result_id
        JOIN answer_attempts AS attempt
            ON attempt.id = part_result.answer_attempt_id
        JOIN practice_session_items AS item
            ON item.id = attempt.practice_session_item_id
            AND item.question_revision_id = (
                SELECT part.question_revision_id
                FROM question_parts AS part
                WHERE part.id = part_result.question_part_id
            )
        JOIN practice_sessions AS session
            ON session.id = item.practice_session_id
        WHERE asset.id = $1
            AND asset.purpose = 'handwriting'
            AND asset.sensitivity = 'private'
            AND asset.scan_status = 'clean'
            AND asset.deleted_at IS NULL
            AND asset.mime_type = 'image/png'
            AND asset.width IS NOT NULL
            AND asset.height IS NOT NULL
            AND attempt.learner_id = $2
            AND session.learner_id = $2
            AND (
                session.check_mode = 'instant'
                OR (session.check_mode = 'complete' AND session.status = 'completed')
            )
            AND EXISTS (
                SELECT 1
                FROM learner_access AS access
                JOIN users AS app_user
                    ON app_user.id = access.user_id
                    AND app_user.status = 'active'
                JOIN learners AS learner
                    ON learner.id = access.learner_id
                    AND learner.status = 'active'
                WHERE access.user_id = $3
                    AND access.learner_id = session.learner_id
                    AND access.can_view_results = true
                    AND access.accepted_at IS NOT NULL
                    AND access.revoked_at IS NULL
            )
        LIMIT 1
    `, [assetId, actor.learnerId, actor.userId]);
    const asset = result.rows[0];
    return asset
        ? {
            id: asset.id,
            storageKey: asset.storage_key,
            mimeType: asset.mime_type,
            byteSize: Number(asset.byte_size),
            checksum: asset.checksum,
            width: asset.width,
            height: asset.height,
        }
        : null;
}
