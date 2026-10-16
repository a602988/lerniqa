import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
    canDiscloseLocalPracticeReferenceAnswers,
    deriveLocalPracticeGradingSource,
    deriveLocalPracticeOverallResult,
    gradeLocalPracticePart,
    LOCAL_PRACTICE_DEFAULT_FILTERS,
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
    withLocalPostgresTransaction,
} from "@/app/lib/local-postgres";
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

export interface LocalPracticeAssetRecord {
    id: string;
    storageKey: string;
    mimeType: string;
    byteSize: number;
    checksum: string;
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
        .map((block) => block.text ?? block.altText ?? "")
        .filter(Boolean)
        .join("\n")
        .trim();
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

    const revisionIds = base.rows.map((row) => row.revision_id);
    const [partsResult, optionsResult, blocksResult] = await Promise.all([
        queryLocalPostgres<PartRow>(`
            SELECT id, question_revision_id, stable_key, position, answer_mode,
                grading_policy, is_independently_gradable
            FROM question_parts
            WHERE question_revision_id = ANY($1::uuid[])
                AND is_independently_gradable = true
            ORDER BY question_revision_id, position, id
        `, [revisionIds]),
        queryLocalPostgres<OptionRow>(`
            SELECT option.id, option.question_part_id, option.option_key, option.position
            FROM question_options AS option
            JOIN question_parts AS part ON part.id = option.question_part_id
            WHERE part.question_revision_id = ANY($1::uuid[])
                AND part.is_independently_gradable = true
            ORDER BY part.question_revision_id, part.position, option.position, option.id
        `, [revisionIds]),
        queryLocalPostgres<BlockRow>(`
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
    ]);

    const partsByRevision = new Map<string, PartRow[]>();
    for (const part of partsResult.rows) {
        const current = partsByRevision.get(part.question_revision_id) ?? [];
        current.push(part);
        partsByRevision.set(part.question_revision_id, current);
    }
    const optionsByPart = new Map<string, OptionRow[]>();
    for (const option of optionsResult.rows) {
        const current = optionsByPart.get(option.question_part_id) ?? [];
        current.push(option);
        optionsByPart.set(option.question_part_id, current);
    }
    const blocksByRevision = new Map<string, BlockRow[]>();
    for (const block of blocksResult.rows) {
        const current = blocksByRevision.get(block.question_revision_id) ?? [];
        current.push(block);
        blocksByRevision.set(block.question_revision_id, current);
    }

    const questions = base.rows.map<LocalPracticeQuestion>((row) => {
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
            prompt,
            promptBlocks: rootPromptBlocks,
            parts,
        };
    });

    return { questions, total: Number(base.rows[0]?.total_count ?? 0) };
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

function feedbackFromStored(row: AttemptPartRow): LocalPracticeAttemptPartResult["feedbackCode"] {
    if (row.current_result === "correct" || row.current_result === "wrong") return row.current_result;
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
        parts: partRows.map((part) => ({
            partId: part.question_part_id,
            result: part.current_result,
            gradingSource: part.grading_source,
            feedbackCode: feedbackFromStored(part),
        })),
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
    const [partRows, referencesByAttempt] = await Promise.all([
        getAttemptParts(client, attemptIds),
        getAttemptReferenceAnswers(client, attemptIds),
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
        const referencesByAttempt = await getAttemptReferenceAnswers(client, [attemptRow.id]);
        return {
            disclosure: "detailed",
            attempt: toAttempt(attemptRow, partRows, referencesByAttempt.get(attemptRow.id) ?? []),
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
        answers: input.answers.map((answer) => ({
            ...answer,
            partId: answer.partId.toLowerCase(),
        })),
    };
    return withLocalPostgresTransaction(async (client) => {
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
            const partRows = await getAttemptParts(client, [existing.id]);
            if (!sameAnswerPayload(partRows, normalizedInput)) {
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
        if (normalizedInput.size !== groupedParts.size) {
            throw new LocalPracticeRequestError(
                "INCOMPLETE_ANSWER",
                item.question_part_id === null
                    ? "請完成這道題的所有小題後再提交。"
                    : "請完成指定小題後再提交。",
                400,
            );
        }

        const gradedParts = [...groupedParts.values()].map(({
            row,
            acceptedKeys,
            acceptedValues,
            validOptionKeys,
        }) => ({
            partId: row.id,
            ...gradeLocalPracticePart({
                answerMode: row.answer_mode,
                gradingPolicy: row.grading_policy,
                acceptedKeys,
                acceptedValues,
                validOptionKeys,
            }, normalizedInput.get(row.id)),
        }));
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
                JOIN answer_part_results AS result ON result.id = queue.source_answer_part_result_id
                JOIN answer_attempts AS attempt ON attempt.id = result.answer_attempt_id
                JOIN practice_session_items AS item ON item.id = attempt.practice_session_item_id
                JOIN practice_sessions AS session ON session.id = item.practice_session_id
                WHERE queue.learner_id = $1
                    AND queue.reason = 'wrong_review'
                    AND queue.status = 'pending'
                    AND (
                        session.check_mode = 'instant'
                        OR (session.check_mode = 'complete' AND session.status = 'completed')
                    )
                ORDER BY queue.created_at DESC, queue.id DESC
                LIMIT $2
            `, [actor.learnerId, limit]),
        ]);
        const attemptIds = attemptResult.rows.map((attempt) => attempt.id);
        const [partRows, referencesByAttempt] = await Promise.all([
            getAttemptParts(client, attemptIds),
            getAttemptReferenceAnswers(client, attemptIds),
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
