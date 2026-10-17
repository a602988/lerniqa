import type { QueryResultRow } from "pg";

import type { AdminQueryRunner } from "./admin-auth.ts";
import {
    AdminApiError,
    type QuestionDetailQuery,
    type QuestionListQuery,
    type QuestionOrigin,
    type QuestionReviewQueueQuery,
    type QuestionReviewQueueState,
    type QuestionRevisionStatus,
    type QuestionSortField,
    type QuestionStatus,
} from "./admin-types.ts";

export interface AdminQuestionBankMembership {
    id: string;
    name: string;
    origin: QuestionOrigin;
    status: "active" | "archived";
}

export interface AdminQuestionListItem {
    id: string;
    origin: QuestionOrigin;
    status: QuestionStatus;
    createdMethod: string;
    owner: { id: string; displayName: string } | null;
    currentRevision: {
        id: string;
        number: number;
        status: QuestionRevisionStatus;
        promptPreview: string | null;
        questionType: { code: string; name: string };
        subject: { code: string; name: string } | null;
        grade: { code: string; name: string } | null;
        difficulty: { code: string; name: string } | null;
        publishedAt: string | null;
    } | null;
    revisionCount: number;
    sourceCount: number;
    banks: AdminQuestionBankMembership[];
    createdAt: string;
    readOnly: boolean;
    readOnlyReason: string | null;
}

export interface AdminQuestionPart {
    id: string;
    parentPartId: string | null;
    stableKey: string;
    position: number;
    answerMode: string;
    gradingPolicy: string;
    independentlyGradable: boolean;
    options: Array<{ id: string; key: string; position: number }>;
    answers: Array<{
        id: string;
        answerKey: string | null;
        acceptedValue: string | null;
        position: number;
    }>;
}

export interface AdminQuestionRevisionSummary {
    id: string;
    number: number;
    status: QuestionRevisionStatus;
    originalQuestionTypeLabel: string | null;
    searchText: string;
    changeNote: string | null;
    questionType: { id: string; code: string; name: string };
    subject: { id: string; code: string; name: string } | null;
    grade: { id: string; code: string; name: string } | null;
    semester: { id: string; code: string; name: string } | null;
    bookVersion: { id: string; name: string } | null;
    examLevel: { id: string; code: string; name: string } | null;
    difficulty: { id: string; code: string; name: string } | null;
    sourceCategory: { id: string; code: string; name: string } | null;
    createdBy: { type: string; userId: string | null; displayName: string | null };
    createdAt: string;
    publishedAt: string | null;
}

export interface AdminQuestionRevision extends AdminQuestionRevisionSummary {
    parts: AdminQuestionPart[];
    contentBlocks: Array<{
        id: string;
        questionPartId: string | null;
        questionOptionId: string | null;
        parentBlockId: string | null;
        placement: string;
        contentType: string;
        position: number;
        textContent: string | null;
        assetId: string | null;
        altText: string | null;
    }>;
    sources: Array<{
        id: string;
        documentId: string;
        inputType: string;
        originalFileName: string | null;
        documentTitle: string | null;
        documentStatus: string;
        sourcePage: number | null;
        sourceQuestionNumber: string | null;
        cropAssetId: string | null;
        primary: boolean;
    }>;
    reviews: Array<{
        id: string;
        reviewerType: string;
        reviewerUserId: string | null;
        reviewerDisplayName: string | null;
        decision: string;
        reason: string | null;
        fromStatus: string;
        toStatus: string;
        createdAt: string;
    }>;
    classifications: {
        units: Array<Record<string, unknown>>;
        topics: Array<Record<string, unknown>>;
        knowledgePoints: Array<Record<string, unknown>>;
        curriculumCodes: Array<Record<string, unknown>>;
        filterValues: Array<Record<string, unknown>>;
    };
}

export interface AdminQuestionDetail {
    id: string;
    origin: QuestionOrigin;
    status: QuestionStatus;
    createdMethod: string;
    currentRevisionId: string | null;
    currentRevisionNumber: number | null;
    currentRevisionCreatedByUserId: string | null;
    owner: { id: string; displayName: string } | null;
    createdBy: { id: string; displayName: string } | null;
    createdAt: string;
    archivedAt: string | null;
    readOnly: boolean;
    readOnlyReason: string | null;
    identifiers: Array<{
        id: string;
        type: string;
        value: string;
        publisherName: string | null;
        bookVersionName: string | null;
        sourceDocumentId: string | null;
    }>;
    selectedRevisionId: string | null;
    displayRevision: AdminQuestionRevision | null;
    revisionHistory: {
        items: AdminQuestionRevisionSummary[];
        total: number;
        page: number;
        pageSize: number;
    };
}

export interface AdminQuestionFilterOption {
    id: string;
    label: string;
}

export interface AdminQuestionFilterOptions {
    banks: AdminQuestionFilterOption[];
    subjects: AdminQuestionFilterOption[];
    grades: AdminQuestionFilterOption[];
    semesters: AdminQuestionFilterOption[];
    bookVersions: AdminQuestionFilterOption[];
    publishers: AdminQuestionFilterOption[];
    sourceCategories: AdminQuestionFilterOption[];
    difficulties: AdminQuestionFilterOption[];
}

export interface AdminQuestionPage {
    items: AdminQuestionListItem[];
    page: number;
    pageSize: number;
    total: number;
}

export interface AdminQuestionReviewQueueItem {
    questionId: string;
    questionStatus: QuestionStatus;
    currentRevisionId: string;
    currentRevisionNumber: number;
    draftRevisionId: string;
    draftRevisionNumber: number;
    promptPreview: string | null;
    changeNote: string | null;
    state: QuestionReviewQueueState;
    latestReviewReason: string | null;
    latestReviewAt: string | null;
    createdBy: {
        type: string;
        userId: string | null;
        displayName: string | null;
    };
    createdAt: string;
}

export interface AdminQuestionReviewQueuePage {
    items: AdminQuestionReviewQueueItem[];
    page: number;
    pageSize: number;
    total: number;
}

interface QuestionListRow extends QueryResultRow {
    id: string | null;
    origin: QuestionOrigin | null;
    status: QuestionStatus | null;
    created_method: string | null;
    owner_user_id: string | null;
    owner_display_name: string | null;
    created_at: Date | string | null;
    current_revision_id: string | null;
    current_revision_number: number | null;
    current_revision_status: QuestionRevisionStatus | null;
    prompt_preview: string | null;
    published_at: Date | string | null;
    question_type_code: string | null;
    question_type_name: string | null;
    subject_code: string | null;
    subject_name: string | null;
    grade_code: string | null;
    grade_name: string | null;
    difficulty_code: string | null;
    difficulty_name: string | null;
    revision_count: number | string | null;
    source_count: number | string | null;
    bank_memberships: unknown;
    total_count: number | string;
}

interface QuestionReviewQueueRow extends QueryResultRow {
    question_id: string | null;
    question_status: QuestionStatus | null;
    current_revision_id: string | null;
    current_revision_number: number | string | null;
    draft_revision_id: string | null;
    draft_revision_number: number | string | null;
    prompt_preview: string | null;
    change_note: string | null;
    latest_review_decision: string | null;
    latest_review_reason: string | null;
    latest_review_at: Date | string | null;
    created_by_type: string | null;
    created_by_user_id: string | null;
    creator_display_name: string | null;
    created_at: Date | string | null;
    total_count: number | string;
}

interface QuestionCoreRow extends QueryResultRow {
    id: string;
    origin: QuestionOrigin;
    status: QuestionStatus;
    created_method: string;
    current_revision_id: string | null;
    current_revision_number: number | null;
    current_revision_created_by_user_id: string | null;
    owner_user_id: string | null;
    owner_display_name: string | null;
    created_by_user_id: string | null;
    creator_display_name: string | null;
    created_at: Date | string;
    archived_at: Date | string | null;
}

interface IdentifierRow extends QueryResultRow {
    id: string;
    identifier_type: string;
    value: string;
    publisher_name: string | null;
    book_version_name: string | null;
    source_document_id: string | null;
}

interface RevisionRow extends QueryResultRow {
    id: string;
    revision_number: number;
    status: QuestionRevisionStatus;
    original_question_type_label: string | null;
    search_text: string;
    change_note: string | null;
    question_type_id: string;
    question_type_code: string;
    question_type_name: string;
    subject_id: string | null;
    subject_code: string | null;
    subject_name: string | null;
    grade_id: string | null;
    grade_code: string | null;
    grade_name: string | null;
    semester_id: string | null;
    semester_code: string | null;
    semester_name: string | null;
    book_version_id: string | null;
    book_version_name: string | null;
    exam_program_level_id: string | null;
    exam_level_code: string | null;
    exam_level_name: string | null;
    difficulty_level_id: string | null;
    difficulty_code: string | null;
    difficulty_name: string | null;
    source_category_id: string | null;
    source_category_code: string | null;
    source_category_name: string | null;
    created_by_type: string;
    created_by_user_id: string | null;
    creator_display_name: string | null;
    created_at: Date | string;
    published_at: Date | string | null;
}

interface RevisionCountRow extends QueryResultRow {
    total_count: number | string;
}

interface FilterOptionRow extends QueryResultRow {
    kind: keyof AdminQuestionFilterOptions;
    id: string;
    label: string;
}

interface PartRow extends QueryResultRow {
    id: string;
    question_revision_id: string;
    parent_part_id: string | null;
    stable_key: string;
    position: number;
    answer_mode: string;
    grading_policy: string;
    is_independently_gradable: boolean;
}

interface OptionRow extends QueryResultRow {
    id: string;
    question_revision_id: string;
    question_part_id: string;
    option_key: string;
    position: number;
}

interface AnswerRow extends QueryResultRow {
    id: string;
    question_revision_id: string;
    question_part_id: string;
    answer_key: string | null;
    accepted_value: string | null;
    position: number;
}

interface BlockRow extends QueryResultRow {
    id: string;
    question_revision_id: string;
    question_part_id: string | null;
    question_option_id: string | null;
    parent_block_id: string | null;
    placement: string;
    content_type: string;
    position: number;
    text_content: string | null;
    asset_id: string | null;
    alt_text: string | null;
}

interface SourceRow extends QueryResultRow {
    id: string;
    question_revision_id: string;
    source_document_id: string;
    input_type: string;
    original_file_name: string | null;
    document_title: string | null;
    document_status: string;
    source_page: number | null;
    source_question_number: string | null;
    crop_asset_id: string | null;
    is_primary: boolean;
}

interface ReviewRow extends QueryResultRow {
    id: string;
    question_revision_id: string;
    reviewer_type: string;
    reviewer_user_id: string | null;
    reviewer_display_name: string | null;
    decision: string;
    reason: string | null;
    from_status: string;
    to_status: string;
    created_at: Date | string;
}

interface ClassificationRow extends QueryResultRow {
    question_revision_id: string;
    [key: string]: unknown;
}

const QUESTION_SORT_SQL: Readonly<Record<QuestionSortField, string>> = {
    createdAt: "page_row.created_at",
    origin: "page_row.origin",
    revisionNumber: "page_row.sort_revision_number",
    status: "page_row.status",
    id: "page_row.id",
};

function asIso(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new AdminApiError("INTERNAL_ERROR", "題庫日期資料格式不正確。", 500);
    }
    return date.toISOString();
}

function asNullableIso(value: Date | string | null): string | null {
    return value === null ? null : asIso(value);
}

function asSafeCount(value: number | string | null): number {
    if (value === null) return 0;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new AdminApiError("INTERNAL_ERROR", "題庫統計資料格式不正確。", 500);
    }
    return parsed;
}

function readOnlyState(origin: QuestionOrigin): {
    readOnly: boolean;
    readOnlyReason: string | null;
} {
    return origin === "account"
        ? {
            readOnly: true,
            readOnlyReason: "帳號自有題目目前僅供系統管理員檢視，不跨帳號改寫。",
        }
        : { readOnly: false, readOnlyReason: null };
}

function buildOrderBy(query: QuestionListQuery): string {
    const requested = query.orderBy.length > 0
        ? [...query.orderBy]
        : [{ field: "createdAt" as const, direction: "desc" as const }];
    if (!requested.some((sort) => sort.field === "id")) {
        requested.push({ field: "id", direction: requested[0]?.direction ?? "desc" });
    }
    return requested.map(({ field, direction }) => {
        const expression = QUESTION_SORT_SQL[field];
        if (!expression || (direction !== "asc" && direction !== "desc")) {
            throw new AdminApiError("INVALID_QUERY", "題庫排序條件不正確。", 400);
        }
        return `${expression} ${direction.toUpperCase()}`;
    }).join(", ");
}

function buildQuestionFilters(query: QuestionListQuery): { sql: string; values: unknown[] } {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const bind = (value: unknown): string => {
        values.push(value);
        return `$${values.length}`;
    };
    if (query.search) {
        const parameter = bind(query.search);
        clauses.push(`(
            question.id::text = lower(${parameter})
            OR position(lower(${parameter}) in lower(coalesce(revision.search_text, ''))) > 0
            OR EXISTS (
                SELECT 1 FROM question_identifiers AS identifier
                WHERE identifier.question_id = question.id
                    AND position(lower(${parameter}) in lower(identifier.value)) > 0
            )
            OR EXISTS (
                SELECT 1 FROM question_content_blocks AS block
                WHERE block.question_revision_id = revision.id
                    AND block.text_content IS NOT NULL
                    AND position(lower(${parameter}) in lower(block.text_content)) > 0
            )
        )`);
    }
    if (query.statuses.length > 0) {
        clauses.push(`question.status = ANY(${bind(query.statuses)}::varchar[])`);
    }
    if (query.origins.length > 0) {
        clauses.push(`question.origin = ANY(${bind(query.origins)}::varchar[])`);
    }
    if (query.revisionStatuses.length > 0) {
        clauses.push(`revision.status = ANY(${bind(query.revisionStatuses)}::varchar[])`);
    }
    if (query.reviewStatuses.length > 0) {
        clauses.push(`(
            SELECT filtered_review.decision
            FROM question_revision_reviews AS filtered_review
            WHERE filtered_review.question_revision_id = revision.id
            ORDER BY filtered_review.created_at DESC, filtered_review.id DESC
            LIMIT 1
        ) = ANY(${bind(query.reviewStatuses)}::varchar[])`);
    }
    if (query.bankId) {
        clauses.push(`EXISTS (
            SELECT 1
            FROM question_bank_items AS filtered_bank_item
            WHERE filtered_bank_item.question_id = question.id
                AND filtered_bank_item.question_bank_id = ${bind(query.bankId)}::uuid
        )`);
    }
    const directRevisionFilters = [
        ["subject_id", query.subjectId],
        ["grade_id", query.gradeId],
        ["semester_id", query.semesterId],
        ["book_version_id", query.bookVersionId],
        ["source_category_id", query.sourceCategoryId],
        ["difficulty_level_id", query.difficultyId],
    ] as const;
    for (const [column, value] of directRevisionFilters) {
        if (value) clauses.push(`revision.${column} = ${bind(value)}::uuid`);
    }
    if (query.publisherId) {
        const parameter = bind(query.publisherId);
        clauses.push(`(
            EXISTS (
                SELECT 1
                FROM book_versions AS filtered_book
                WHERE filtered_book.id = revision.book_version_id
                    AND filtered_book.publisher_id = ${parameter}::uuid
            )
            OR EXISTS (
                SELECT 1
                FROM question_identifiers AS filtered_identifier
                WHERE filtered_identifier.question_id = question.id
                    AND filtered_identifier.publisher_id = ${parameter}::uuid
            )
        )`);
    }
    if (query.created.from) {
        clauses.push(`question.created_at >= (${bind(query.created.from)}::date::timestamp AT TIME ZONE 'Asia/Taipei')`);
    }
    if (query.created.to) {
        clauses.push(`question.created_at < (((${bind(query.created.to)}::date + 1)::timestamp) AT TIME ZONE 'Asia/Taipei')`);
    }
    return {
        sql: clauses.length > 0 ? `WHERE ${clauses.join("\n            AND ")}` : "",
        values,
    };
}

function mapBankMemberships(value: unknown): AdminQuestionBankMembership[] {
    if (!Array.isArray(value)) return [];
    const memberships: AdminQuestionBankMembership[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object") continue;
        const candidate = entry as Record<string, unknown>;
        if (
            typeof candidate.id !== "string"
            || typeof candidate.name !== "string"
            || (candidate.origin !== "system" && candidate.origin !== "account")
            || (candidate.status !== "active" && candidate.status !== "archived")
        ) {
            throw new AdminApiError("INTERNAL_ERROR", "題庫歸屬資料格式不正確。", 500);
        }
        memberships.push({
            id: candidate.id,
            name: candidate.name,
            origin: candidate.origin,
            status: candidate.status,
        });
    }
    return memberships;
}

function mapQuestionListRow(row: QuestionListRow): AdminQuestionListItem {
    if (!row.id || !row.origin || !row.status || !row.created_method || !row.created_at) {
        throw new AdminApiError("INTERNAL_ERROR", "題庫清單資料不完整。", 500);
    }
    const currentRevision = row.current_revision_id === null
        ? null
        : (() => {
            if (
                row.current_revision_number === null
                || row.current_revision_status === null
                || row.question_type_code === null
                || row.question_type_name === null
            ) {
                throw new AdminApiError("INTERNAL_ERROR", "題目目前版本資料不完整。", 500);
            }
            return {
                id: row.current_revision_id,
                number: row.current_revision_number,
                status: row.current_revision_status,
                promptPreview: row.prompt_preview?.slice(0, 160) ?? null,
                questionType: {
                    code: row.question_type_code,
                    name: row.question_type_name,
                },
                subject: row.subject_code === null
                    ? null
                    : { code: row.subject_code, name: row.subject_name ?? "未填" },
                grade: row.grade_code === null
                    ? null
                    : { code: row.grade_code, name: row.grade_name ?? "未填" },
                difficulty: row.difficulty_code === null
                    ? null
                    : { code: row.difficulty_code, name: row.difficulty_name ?? "未填" },
                publishedAt: asNullableIso(row.published_at),
            };
        })();
    return {
        id: row.id,
        origin: row.origin,
        status: row.status,
        createdMethod: row.created_method,
        owner: row.owner_user_id === null
            ? null
            : { id: row.owner_user_id, displayName: row.owner_display_name ?? "未填" },
        currentRevision,
        revisionCount: asSafeCount(row.revision_count),
        sourceCount: asSafeCount(row.source_count),
        banks: mapBankMemberships(row.bank_memberships),
        createdAt: asIso(row.created_at),
        ...readOnlyState(row.origin),
    };
}

export async function listQuestions(
    runner: AdminQueryRunner,
    query: QuestionListQuery,
): Promise<AdminQuestionPage> {
    const filters = buildQuestionFilters(query);
    const limitParameter = `$${filters.values.length + 1}`;
    const offsetParameter = `$${filters.values.length + 2}`;
    const orderBy = buildOrderBy(query);
    const result = await runner.query<QuestionListRow>(`
        WITH question_row AS (
            SELECT
                question.id,
                question.origin,
                question.status,
                question.created_method,
                question.owner_user_id,
                owner.display_name AS owner_display_name,
                question.created_at,
                revision.id AS current_revision_id,
                revision.revision_number AS current_revision_number,
                revision.status AS current_revision_status,
                prompt_preview.prompt_preview,
                revision.published_at,
                question_type.code AS question_type_code,
                question_type.name AS question_type_name,
                subject.code AS subject_code,
                subject.name AS subject_name,
                grade.code AS grade_code,
                grade.name AS grade_name,
                difficulty.code AS difficulty_code,
                difficulty.name AS difficulty_name,
                coalesce(revision_summary.revision_count, 0) AS revision_count,
                coalesce(source_summary.source_count, 0) AS source_count,
                coalesce(bank_summary.bank_memberships, '[]'::jsonb) AS bank_memberships,
                coalesce(revision.revision_number, 0) AS sort_revision_number
            FROM questions AS question
            LEFT JOIN users AS owner ON owner.id = question.owner_user_id
            LEFT JOIN question_revisions AS revision ON revision.id = question.current_revision_id
            LEFT JOIN question_types AS question_type ON question_type.id = revision.question_type_id
            LEFT JOIN subjects AS subject ON subject.id = revision.subject_id
            LEFT JOIN grades AS grade ON grade.id = revision.grade_id
            LEFT JOIN difficulty_levels AS difficulty ON difficulty.id = revision.difficulty_level_id
            LEFT JOIN LATERAL (
                SELECT block.text_content AS prompt_preview
                FROM question_content_blocks AS block
                WHERE block.question_revision_id = revision.id
                    AND block.placement = 'prompt'
                    AND block.text_content IS NOT NULL
                ORDER BY block.position, block.id
                LIMIT 1
            ) AS prompt_preview ON true
            LEFT JOIN LATERAL (
                SELECT count(*)::integer AS revision_count
                FROM question_revisions AS counted_revision
                WHERE counted_revision.question_id = question.id
            ) AS revision_summary ON true
            LEFT JOIN LATERAL (
                SELECT count(*)::integer AS source_count
                FROM question_revision_sources AS source
                WHERE source.question_revision_id = revision.id
            ) AS source_summary ON true
            LEFT JOIN LATERAL (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', bank.id,
                        'name', bank.name,
                        'origin', bank.origin,
                        'status', bank.status
                    )
                    ORDER BY bank.name, bank.id
                ) AS bank_memberships
                FROM question_bank_items AS bank_item
                JOIN question_banks AS bank ON bank.id = bank_item.question_bank_id
                WHERE bank_item.question_id = question.id
            ) AS bank_summary ON true
            ${filters.sql}
        ),
        page AS (
            SELECT * FROM question_row AS page_row
            ORDER BY ${orderBy}
            LIMIT ${limitParameter}
            OFFSET ${offsetParameter}
        ),
        question_count AS (
            SELECT count(*) AS total_count FROM question_row
        )
        SELECT page_row.*, question_count.total_count
        FROM question_count
        LEFT JOIN page AS page_row ON true
        ORDER BY ${orderBy}
    `, [...filters.values, query.limit, query.offset]);

    return {
        items: result.rows.filter((row) => row.id !== null).map(mapQuestionListRow),
        page: query.page,
        pageSize: query.pageSize,
        total: asSafeCount(result.rows[0]?.total_count ?? 0),
    };
}

/**
 * Returns only actionable system-owned drafts. The latest review is resolved
 * before filtering so a previously returned draft cannot remain in the queue
 * merely because it has an older `changes_requested` record.
 */
export async function listQuestionReviewQueue(
    runner: AdminQueryRunner,
    query: QuestionReviewQueueQuery,
): Promise<AdminQuestionReviewQueuePage> {
    const clauses = [
        "question.origin = 'system'",
        "question.status <> 'archived'",
        "draft.status = 'draft'",
        "(latest_review.decision IS NULL OR latest_review.decision = 'changes_requested')",
    ];
    const values: unknown[] = [];
    const bind = (value: unknown): string => {
        values.push(value);
        return `$${values.length}`;
    };
    if (query.search) {
        const parameter = bind(query.search);
        clauses.push(`(
            question.id::text = lower(${parameter})
            OR draft.id::text = lower(${parameter})
            OR position(lower(${parameter}) in lower(coalesce(draft.search_text, ''))) > 0
            OR position(lower(${parameter}) in lower(coalesce(draft.change_note, ''))) > 0
            OR EXISTS (
                SELECT 1
                FROM question_content_blocks AS searched_block
                WHERE searched_block.question_revision_id = draft.id
                    AND searched_block.text_content IS NOT NULL
                    AND position(lower(${parameter}) in lower(searched_block.text_content)) > 0
            )
        )`);
    }
    if (query.states.length > 0) {
        const parameter = bind(query.states);
        clauses.push(`(
            ('unreviewed' = ANY(${parameter}::varchar[]) AND latest_review.decision IS NULL)
            OR (
                'changes_requested' = ANY(${parameter}::varchar[])
                AND latest_review.decision = 'changes_requested'
            )
        )`);
    }
    const limitParameter = bind(query.limit);
    const offsetParameter = bind(query.offset);
    const result = await runner.query<QuestionReviewQueueRow>(`
        WITH pending_review AS (
            SELECT
                question.id AS question_id,
                question.status AS question_status,
                current_revision.id AS current_revision_id,
                current_revision.revision_number AS current_revision_number,
                draft.id AS draft_revision_id,
                draft.revision_number AS draft_revision_number,
                prompt_preview.prompt_preview,
                draft.change_note,
                latest_review.decision AS latest_review_decision,
                latest_review.reason AS latest_review_reason,
                latest_review.created_at AS latest_review_at,
                draft.created_by_type,
                draft.created_by_user_id,
                creator.display_name AS creator_display_name,
                draft.created_at
            FROM questions AS question
            JOIN question_revisions AS current_revision
                ON current_revision.id = question.current_revision_id
            JOIN question_revisions AS draft
                ON draft.question_id = question.id
            LEFT JOIN users AS creator ON creator.id = draft.created_by_user_id
            LEFT JOIN LATERAL (
                SELECT
                    review.decision,
                    review.reason,
                    review.created_at
                FROM question_revision_reviews AS review
                WHERE review.question_revision_id = draft.id
                ORDER BY review.created_at DESC, review.id DESC
                LIMIT 1
            ) AS latest_review ON true
            LEFT JOIN LATERAL (
                SELECT block.text_content AS prompt_preview
                FROM question_content_blocks AS block
                WHERE block.question_revision_id = draft.id
                    AND block.placement = 'prompt'
                    AND block.text_content IS NOT NULL
                ORDER BY block.position, block.id
                LIMIT 1
            ) AS prompt_preview ON true
            WHERE ${clauses.join("\n                AND ")}
        ),
        page AS (
            SELECT *
            FROM pending_review
            ORDER BY created_at ASC, draft_revision_id ASC
            LIMIT ${limitParameter}
            OFFSET ${offsetParameter}
        ),
        pending_count AS (
            SELECT count(*) AS total_count FROM pending_review
        )
        SELECT page.*, pending_count.total_count
        FROM pending_count
        LEFT JOIN page ON true
        ORDER BY page.created_at ASC NULLS LAST, page.draft_revision_id ASC NULLS LAST
    `, values);

    return {
        items: result.rows
            .filter((row) => row.question_id !== null)
            .map((row) => {
                if (
                    row.question_id === null
                    || row.question_status === null
                    || row.current_revision_id === null
                    || row.current_revision_number === null
                    || row.draft_revision_id === null
                    || row.draft_revision_number === null
                    || row.created_by_type === null
                    || row.created_at === null
                ) {
                    throw new AdminApiError(
                        "INTERNAL_ERROR",
                        "待審題目資料不完整。",
                        500,
                    );
                }
                const state: QuestionReviewQueueState = row.latest_review_decision === null
                    ? "unreviewed"
                    : row.latest_review_decision === "changes_requested"
                        ? "changes_requested"
                        : (() => {
                            throw new AdminApiError(
                                "INTERNAL_ERROR",
                                "待審題目狀態不正確。",
                                500,
                            );
                        })();
                return {
                    questionId: row.question_id,
                    questionStatus: row.question_status,
                    currentRevisionId: row.current_revision_id,
                    currentRevisionNumber: asSafeCount(row.current_revision_number),
                    draftRevisionId: row.draft_revision_id,
                    draftRevisionNumber: asSafeCount(row.draft_revision_number),
                    promptPreview: row.prompt_preview?.slice(0, 160) ?? null,
                    changeNote: row.change_note,
                    state,
                    latestReviewReason: row.latest_review_reason,
                    latestReviewAt: asNullableIso(row.latest_review_at),
                    createdBy: {
                        type: row.created_by_type,
                        userId: row.created_by_user_id,
                        displayName: row.creator_display_name,
                    },
                    createdAt: asIso(row.created_at),
                };
            }),
        page: query.page,
        pageSize: query.pageSize,
        total: asSafeCount(result.rows[0]?.total_count ?? 0),
    };
}

export async function listQuestionFilterOptions(
    runner: AdminQueryRunner,
): Promise<AdminQuestionFilterOptions> {
    const result = await runner.query<FilterOptionRow>(`
        SELECT 'banks'::text AS kind, bank.id, bank.name::text AS label
        FROM question_banks AS bank
        UNION ALL
        SELECT 'subjects', subject.id, (subject.name || ' (' || subject.code || ')')::text
        FROM subjects AS subject
        UNION ALL
        SELECT 'grades', grade.id, (grade.name || ' (' || grade.code || ')')::text
        FROM grades AS grade
        UNION ALL
        SELECT 'semesters', semester.id, (semester.name || ' (' || semester.code || ')')::text
        FROM semesters AS semester
        UNION ALL
        SELECT
            'bookVersions',
            book.id,
            concat_ws(' · ', publisher.name, book.name)::text
        FROM book_versions AS book
        LEFT JOIN publishers AS publisher ON publisher.id = book.publisher_id
        UNION ALL
        SELECT 'publishers', publisher.id, publisher.name::text
        FROM publishers AS publisher
        UNION ALL
        SELECT
            'sourceCategories',
            source_category.id,
            (source_category.name || ' (' || source_category.code || ')')::text
        FROM source_categories AS source_category
        UNION ALL
        SELECT
            'difficulties',
            difficulty.id,
            (difficulty.name || ' (' || difficulty.code || ')')::text
        FROM difficulty_levels AS difficulty
        ORDER BY kind, label, id
    `);
    const options: AdminQuestionFilterOptions = {
        banks: [],
        subjects: [],
        grades: [],
        semesters: [],
        bookVersions: [],
        publishers: [],
        sourceCategories: [],
        difficulties: [],
    };
    for (const row of result.rows) {
        const bucket = options[row.kind];
        if (!Array.isArray(bucket) || !row.id || !row.label) {
            throw new AdminApiError("INTERNAL_ERROR", "題庫篩選選項格式不正確。", 500);
        }
        bucket.push({ id: row.id, label: row.label });
    }
    return options;
}

function groupByRevision<Row extends { question_revision_id: string }>(
    rows: Row[],
): Map<string, Row[]> {
    const grouped = new Map<string, Row[]>();
    for (const row of rows) {
        const values = grouped.get(row.question_revision_id) ?? [];
        values.push(row);
        grouped.set(row.question_revision_id, values);
    }
    return grouped;
}

function nullableCatalog(
    id: string | null,
    code: string | null,
    name: string | null,
): { id: string; code: string; name: string } | null {
    return id === null ? null : { id, code: code ?? "unknown", name: name ?? "未填" };
}

function mapRevisionSummary(revision: RevisionRow): AdminQuestionRevisionSummary {
    return {
        id: revision.id,
        number: revision.revision_number,
        status: revision.status,
        originalQuestionTypeLabel: revision.original_question_type_label,
        searchText: revision.search_text,
        changeNote: revision.change_note,
        questionType: {
            id: revision.question_type_id,
            code: revision.question_type_code,
            name: revision.question_type_name,
        },
        subject: nullableCatalog(
            revision.subject_id,
            revision.subject_code,
            revision.subject_name,
        ),
        grade: nullableCatalog(revision.grade_id, revision.grade_code, revision.grade_name),
        semester: nullableCatalog(
            revision.semester_id,
            revision.semester_code,
            revision.semester_name,
        ),
        bookVersion: revision.book_version_id === null ? null : {
            id: revision.book_version_id,
            name: revision.book_version_name ?? "未填",
        },
        examLevel: nullableCatalog(
            revision.exam_program_level_id,
            revision.exam_level_code,
            revision.exam_level_name,
        ),
        difficulty: nullableCatalog(
            revision.difficulty_level_id,
            revision.difficulty_code,
            revision.difficulty_name,
        ),
        sourceCategory: nullableCatalog(
            revision.source_category_id,
            revision.source_category_code,
            revision.source_category_name,
        ),
        createdBy: {
            type: revision.created_by_type,
            userId: revision.created_by_user_id,
            displayName: revision.creator_display_name,
        },
        createdAt: asIso(revision.created_at),
        publishedAt: asNullableIso(revision.published_at),
    };
}

const QUESTION_REVISION_SELECT = `
    SELECT
        revision.id,
        revision.revision_number,
        revision.status,
        revision.original_question_type_label,
        revision.search_text,
        revision.change_note,
        revision.question_type_id,
        question_type.code AS question_type_code,
        question_type.name AS question_type_name,
        revision.subject_id,
        subject.code AS subject_code,
        subject.name AS subject_name,
        revision.grade_id,
        grade.code AS grade_code,
        grade.name AS grade_name,
        revision.semester_id,
        semester.code AS semester_code,
        semester.name AS semester_name,
        revision.book_version_id,
        book.name AS book_version_name,
        revision.exam_program_level_id,
        exam_level.code AS exam_level_code,
        exam_level.name AS exam_level_name,
        revision.difficulty_level_id,
        difficulty.code AS difficulty_code,
        difficulty.name AS difficulty_name,
        revision.source_category_id,
        source_category.code AS source_category_code,
        source_category.name AS source_category_name,
        revision.created_by_type,
        revision.created_by_user_id,
        creator.display_name AS creator_display_name,
        revision.created_at,
        revision.published_at
    FROM question_revisions AS revision
    JOIN question_types AS question_type ON question_type.id = revision.question_type_id
    LEFT JOIN subjects AS subject ON subject.id = revision.subject_id
    LEFT JOIN grades AS grade ON grade.id = revision.grade_id
    LEFT JOIN semesters AS semester ON semester.id = revision.semester_id
    LEFT JOIN book_versions AS book ON book.id = revision.book_version_id
    LEFT JOIN exam_program_levels AS exam_level ON exam_level.id = revision.exam_program_level_id
    LEFT JOIN difficulty_levels AS difficulty ON difficulty.id = revision.difficulty_level_id
    LEFT JOIN source_categories AS source_category ON source_category.id = revision.source_category_id
    LEFT JOIN users AS creator ON creator.id = revision.created_by_user_id
`;

export async function getQuestionDetail(
    runner: AdminQueryRunner,
    questionId: string,
    query: QuestionDetailQuery = {
        revisionPage: 1,
        revisionPageSize: 10,
        revisionOffset: 0,
        revisionLimit: 10,
    },
): Promise<AdminQuestionDetail> {
    const coreResult = await runner.query<QuestionCoreRow>(`
        SELECT
            question.id,
            question.origin,
            question.status,
            question.created_method,
            question.current_revision_id,
            current_revision.revision_number AS current_revision_number,
            current_revision.created_by_user_id AS current_revision_created_by_user_id,
            question.owner_user_id,
            owner.display_name AS owner_display_name,
            question.created_by_user_id,
            creator.display_name AS creator_display_name,
            question.created_at,
            question.archived_at
        FROM questions AS question
        LEFT JOIN question_revisions AS current_revision
            ON current_revision.id = question.current_revision_id
            AND current_revision.question_id = question.id
        LEFT JOIN users AS owner ON owner.id = question.owner_user_id
        LEFT JOIN users AS creator ON creator.id = question.created_by_user_id
        WHERE question.id = $1
        LIMIT 1
    `, [questionId]);
    const question = coreResult.rows[0];
    if (!question) throw new AdminApiError("NOT_FOUND", "找不到指定題目。", 404);

    const identifiers = await runner.query<IdentifierRow>(`
        SELECT
            identifier.id,
            identifier.identifier_type,
            identifier.value,
            publisher.name AS publisher_name,
            book.name AS book_version_name,
            identifier.source_document_id
        FROM question_identifiers AS identifier
        LEFT JOIN publishers AS publisher ON publisher.id = identifier.publisher_id
        LEFT JOIN book_versions AS book ON book.id = identifier.book_version_id
        WHERE identifier.question_id = $1
        ORDER BY identifier.identifier_type, identifier.normalized_value, identifier.id
    `, [questionId]);
    const revisionCountResult = await runner.query<RevisionCountRow>(`
        SELECT count(*) AS total_count
        FROM question_revisions
        WHERE question_id = $1
    `, [questionId]);
    const revisionTotal = asSafeCount(revisionCountResult.rows[0]?.total_count ?? 0);
    const historyResult = await runner.query<RevisionRow>(`
        /* admin_question_revision_history */
        ${QUESTION_REVISION_SELECT}
        WHERE revision.question_id = $1
        ORDER BY revision.revision_number DESC, revision.id
        LIMIT $2
        OFFSET $3
    `, [questionId, query.revisionLimit, query.revisionOffset]);
    const displayRevisionId = query.selectedRevisionId ?? question.current_revision_id;
    const displayRevisionResult = displayRevisionId === null
        ? { rows: [] as RevisionRow[] }
        : await runner.query<RevisionRow>(`
            /* admin_question_display_revision */
            ${QUESTION_REVISION_SELECT}
            WHERE revision.question_id = $1
                AND revision.id = $2
            LIMIT 1
        `, [questionId, displayRevisionId]);
    if (displayRevisionId !== null && displayRevisionResult.rows.length === 0) {
        if (query.selectedRevisionId) {
            throw new AdminApiError("NOT_FOUND", "找不到這個題目的指定版本。", 404);
        }
        throw new AdminApiError("INTERNAL_ERROR", "題目目前版本資料不完整。", 500);
    }

    const revisionIds = displayRevisionResult.rows.map((revision) => revision.id);
    if (revisionIds.length === 0) {
        return {
            id: question.id,
            origin: question.origin,
            status: question.status,
            createdMethod: question.created_method,
            currentRevisionId: question.current_revision_id,
            currentRevisionNumber: question.current_revision_number ?? null,
            currentRevisionCreatedByUserId:
                question.current_revision_created_by_user_id ?? null,
            owner: question.owner_user_id === null ? null : {
                id: question.owner_user_id,
                displayName: question.owner_display_name ?? "未填",
            },
            createdBy: question.created_by_user_id === null ? null : {
                id: question.created_by_user_id,
                displayName: question.creator_display_name ?? "未填",
            },
            createdAt: asIso(question.created_at),
            archivedAt: asNullableIso(question.archived_at),
            ...readOnlyState(question.origin),
            identifiers: identifiers.rows.map((identifier) => ({
                id: identifier.id,
                type: identifier.identifier_type,
                value: identifier.value,
                publisherName: identifier.publisher_name,
                bookVersionName: identifier.book_version_name,
                sourceDocumentId: identifier.source_document_id,
            })),
            selectedRevisionId: query.selectedRevisionId ?? null,
            displayRevision: null,
            revisionHistory: {
                items: historyResult.rows.map(mapRevisionSummary),
                total: revisionTotal,
                page: query.revisionPage,
                pageSize: query.revisionPageSize,
            },
        };
    }

    const revisionParameter = [revisionIds];
    const partResult = await runner.query<PartRow>(`
        SELECT * FROM question_parts
        WHERE question_revision_id = ANY($1::uuid[])
        ORDER BY question_revision_id, position, id
    `, revisionParameter);
    const optionResult = await runner.query<OptionRow>(`
        SELECT part.question_revision_id, option.*
        FROM question_options AS option
        JOIN question_parts AS part ON part.id = option.question_part_id
        WHERE part.question_revision_id = ANY($1::uuid[])
        ORDER BY part.question_revision_id, option.question_part_id, option.position, option.id
    `, revisionParameter);
    const answerResult = await runner.query<AnswerRow>(`
        SELECT part.question_revision_id, answer.*
        FROM question_answers AS answer
        JOIN question_parts AS part ON part.id = answer.question_part_id
        WHERE part.question_revision_id = ANY($1::uuid[])
        ORDER BY part.question_revision_id, answer.question_part_id, answer.position, answer.id
    `, revisionParameter);
    const blockResult = await runner.query<BlockRow>(`
        SELECT * FROM question_content_blocks
        WHERE question_revision_id = ANY($1::uuid[])
        ORDER BY question_revision_id, placement, position, id
    `, revisionParameter);
    const sourceResult = await runner.query<SourceRow>(`
        SELECT
            source.id,
            source.question_revision_id,
            source.source_document_id,
            document.input_type,
            document.original_file_name,
            document.document_title,
            document.status AS document_status,
            source.source_page,
            source.source_question_number,
            source.crop_asset_id,
            source.is_primary
        FROM question_revision_sources AS source
        JOIN source_documents AS document ON document.id = source.source_document_id
        WHERE source.question_revision_id = ANY($1::uuid[])
        ORDER BY source.question_revision_id, source.is_primary DESC, source.id
    `, revisionParameter);
    const reviewResult = await runner.query<ReviewRow>(`
        SELECT
            review.id,
            review.question_revision_id,
            review.reviewer_type,
            review.reviewer_user_id,
            reviewer.display_name AS reviewer_display_name,
            review.decision,
            review.reason,
            review.from_status,
            review.to_status,
            review.created_at
        FROM question_revision_reviews AS review
        LEFT JOIN users AS reviewer ON reviewer.id = review.reviewer_user_id
        WHERE review.question_revision_id = ANY($1::uuid[])
        ORDER BY review.question_revision_id, review.created_at, review.id
    `, revisionParameter);
    const unitResult = await runner.query<ClassificationRow>(`
        SELECT
            relation.question_revision_id,
            unit.id, unit.code, unit.name,
            relation.assignment_type AS "assignmentType",
            relation.is_primary AS "primary",
            relation.value_source AS "valueSource",
            relation.confidence
        FROM question_revision_units AS relation
        JOIN curriculum_units AS unit ON unit.id = relation.curriculum_unit_id
        WHERE relation.question_revision_id = ANY($1::uuid[])
        ORDER BY relation.question_revision_id, relation.is_primary DESC, unit.position, unit.id
    `, revisionParameter);
    const topicResult = await runner.query<ClassificationRow>(`
        SELECT
            relation.question_revision_id,
            topic.id, topic.code, topic.name,
            relation.is_primary AS "primary",
            relation.value_source AS "valueSource"
        FROM question_revision_topics AS relation
        JOIN topics AS topic ON topic.id = relation.topic_id
        WHERE relation.question_revision_id = ANY($1::uuid[])
        ORDER BY relation.question_revision_id, relation.is_primary DESC, topic.name, topic.id
    `, revisionParameter);
    const knowledgeResult = await runner.query<ClassificationRow>(`
        SELECT
            relation.question_revision_id,
            knowledge.id, knowledge.code, knowledge.name,
            relation.is_primary AS "primary",
            relation.value_source AS "valueSource"
        FROM question_revision_knowledge_points AS relation
        JOIN knowledge_points AS knowledge ON knowledge.id = relation.knowledge_point_id
        WHERE relation.question_revision_id = ANY($1::uuid[])
        ORDER BY relation.question_revision_id, relation.is_primary DESC, knowledge.name, knowledge.id
    `, revisionParameter);
    const curriculumResult = await runner.query<ClassificationRow>(`
        SELECT
            relation.question_revision_id,
            code.id, code.code, code.name,
            relation.is_primary AS "primary",
            relation.value_source AS "valueSource",
            relation.confidence
        FROM question_revision_curriculum_codes AS relation
        JOIN curriculum_codes AS code ON code.id = relation.curriculum_code_id
        WHERE relation.question_revision_id = ANY($1::uuid[])
        ORDER BY relation.question_revision_id, relation.is_primary DESC, code.code, code.id
    `, revisionParameter);
    const filterResult = await runner.query<ClassificationRow>(`
        SELECT
            value.question_revision_id,
            value.id,
            field.id AS "fieldId",
            field.key AS "fieldKey",
            field.name AS "fieldName",
            option.id AS "optionId",
            option.value AS "optionValue",
            option.label AS "optionLabel",
            value.raw_label AS "rawLabel",
            value.raw_value AS "rawValue",
            value.normalized_value AS "normalizedValue",
            value.value_source AS "valueSource",
            value.confidence
        FROM question_revision_filter_values AS value
        JOIN filter_fields AS field ON field.id = value.filter_field_id
        LEFT JOIN filter_field_options AS option ON option.id = value.filter_option_id
        WHERE value.question_revision_id = ANY($1::uuid[])
        ORDER BY value.question_revision_id, field.sort_order, value.id
    `, revisionParameter);

    const optionsByPart = new Map<string, OptionRow[]>();
    for (const option of optionResult.rows) {
        const rows = optionsByPart.get(option.question_part_id) ?? [];
        rows.push(option);
        optionsByPart.set(option.question_part_id, rows);
    }
    const answersByPart = new Map<string, AnswerRow[]>();
    for (const answer of answerResult.rows) {
        const rows = answersByPart.get(answer.question_part_id) ?? [];
        rows.push(answer);
        answersByPart.set(answer.question_part_id, rows);
    }
    const partsByRevision = groupByRevision(partResult.rows);
    const blocksByRevision = groupByRevision(blockResult.rows);
    const sourcesByRevision = groupByRevision(sourceResult.rows);
    const reviewsByRevision = groupByRevision(reviewResult.rows);
    const unitsByRevision = groupByRevision(unitResult.rows);
    const topicsByRevision = groupByRevision(topicResult.rows);
    const knowledgeByRevision = groupByRevision(knowledgeResult.rows);
    const curriculumByRevision = groupByRevision(curriculumResult.rows);
    const filtersByRevision = groupByRevision(filterResult.rows);

    const stripRevisionId = (row: ClassificationRow): Record<string, unknown> => {
        const { question_revision_id: _questionRevisionId, ...safe } = row;
        return safe;
    };

    return {
        id: question.id,
        origin: question.origin,
        status: question.status,
        createdMethod: question.created_method,
        currentRevisionId: question.current_revision_id,
        currentRevisionNumber: question.current_revision_number ?? null,
        currentRevisionCreatedByUserId:
            question.current_revision_created_by_user_id ?? null,
        owner: question.owner_user_id === null ? null : {
            id: question.owner_user_id,
            displayName: question.owner_display_name ?? "未填",
        },
        createdBy: question.created_by_user_id === null ? null : {
            id: question.created_by_user_id,
            displayName: question.creator_display_name ?? "未填",
        },
        createdAt: asIso(question.created_at),
        archivedAt: asNullableIso(question.archived_at),
        ...readOnlyState(question.origin),
        identifiers: identifiers.rows.map((identifier) => ({
            id: identifier.id,
            type: identifier.identifier_type,
            value: identifier.value,
            publisherName: identifier.publisher_name,
            bookVersionName: identifier.book_version_name,
            sourceDocumentId: identifier.source_document_id,
        })),
        selectedRevisionId: query.selectedRevisionId ?? null,
        displayRevision: displayRevisionResult.rows.map((revision) => ({
            ...mapRevisionSummary(revision),
            parts: (partsByRevision.get(revision.id) ?? []).map((part) => ({
                id: part.id,
                parentPartId: part.parent_part_id,
                stableKey: part.stable_key,
                position: part.position,
                answerMode: part.answer_mode,
                gradingPolicy: part.grading_policy,
                independentlyGradable: part.is_independently_gradable,
                options: (optionsByPart.get(part.id) ?? []).map((option) => ({
                    id: option.id,
                    key: option.option_key,
                    position: option.position,
                })),
                answers: (answersByPart.get(part.id) ?? []).map((answer) => ({
                    id: answer.id,
                    answerKey: answer.answer_key,
                    acceptedValue: answer.accepted_value,
                    position: answer.position,
                })),
            })),
            contentBlocks: (blocksByRevision.get(revision.id) ?? []).map((block) => ({
                id: block.id,
                questionPartId: block.question_part_id,
                questionOptionId: block.question_option_id,
                parentBlockId: block.parent_block_id,
                placement: block.placement,
                contentType: block.content_type,
                position: block.position,
                textContent: block.text_content,
                assetId: block.asset_id,
                altText: block.alt_text,
            })),
            sources: (sourcesByRevision.get(revision.id) ?? []).map((source) => ({
                id: source.id,
                documentId: source.source_document_id,
                inputType: source.input_type,
                originalFileName: source.original_file_name,
                documentTitle: source.document_title,
                documentStatus: source.document_status,
                sourcePage: source.source_page,
                sourceQuestionNumber: source.source_question_number,
                cropAssetId: source.crop_asset_id,
                primary: source.is_primary,
            })),
            reviews: (reviewsByRevision.get(revision.id) ?? []).map((review) => ({
                id: review.id,
                reviewerType: review.reviewer_type,
                reviewerUserId: review.reviewer_user_id,
                reviewerDisplayName: review.reviewer_display_name,
                decision: review.decision,
                reason: review.reason,
                fromStatus: review.from_status,
                toStatus: review.to_status,
                createdAt: asIso(review.created_at),
            })),
            classifications: {
                units: (unitsByRevision.get(revision.id) ?? []).map(stripRevisionId),
                topics: (topicsByRevision.get(revision.id) ?? []).map(stripRevisionId),
                knowledgePoints: (knowledgeByRevision.get(revision.id) ?? []).map(stripRevisionId),
                curriculumCodes: (curriculumByRevision.get(revision.id) ?? []).map(stripRevisionId),
                filterValues: (filtersByRevision.get(revision.id) ?? []).map(stripRevisionId),
            },
        }))[0] ?? null,
        revisionHistory: {
            items: historyResult.rows.map(mapRevisionSummary),
            total: revisionTotal,
            page: query.revisionPage,
            pageSize: query.revisionPageSize,
        },
    };
}
