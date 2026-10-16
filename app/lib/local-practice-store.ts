import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
    deriveLocalPracticeGradingSource,
    deriveLocalPracticeOverallResult,
    gradeLocalPracticePart,
    LOCAL_PRACTICE_DEFAULT_FILTERS,
    normalizeLocalPracticeText,
    type LocalPracticeAnswerInput,
    type LocalPracticeAttempt,
    type LocalPracticeAttemptPartResult,
    type LocalPracticeContentBlock,
    type LocalPracticeFilters,
    type LocalPracticeGradingSource,
    type LocalPracticeQuestion,
    type LocalPracticeQuestionPart,
    type LocalPracticeResult,
    type LocalPracticeSession,
    type LocalPracticeSessionHistory,
    type LocalPracticeWrongQueueItem,
} from "@/app/lib/local-practice-types";
import {
    queryLocalPostgres,
    withLocalPostgresTransaction,
} from "@/app/lib/local-postgres";

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
    position: number;
}

interface SessionRow extends QueryResultRow {
    id: string;
    status: LocalPracticeSession["status"];
    started_at: Date | string;
    completed_at: Date | string | null;
}

interface AttemptRow extends QueryResultRow {
    id: string;
    practice_session_item_id: string;
    practice_session_id: string;
    question_id: string;
    question_revision_id: string;
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

interface GradePartRow extends QueryResultRow {
    id: string;
    answer_mode: LocalPracticeQuestionPart["answerMode"];
    grading_policy: LocalPracticeGradingSource;
    position: number;
    answer_key: string | null;
    accepted_value: string | null;
    valid_option_keys: string[];
}

interface SessionHistoryRow extends QueryResultRow {
    id: string;
    status: LocalPracticeSession["status"];
    started_at: Date | string;
    completed_at: Date | string | null;
    item_count: number;
    attempted_item_count: number;
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

function subjectAliases(subject: string): string[] {
    const normalized = subject.normalize("NFKC").trim();
    return normalized === "國文" || normalized === "國語" ? ["國文", "國語"] : [normalized];
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
        subjectAliases(filters.subject),
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
        ORDER BY question_identifier.value NULLS LAST, question.created_at, question.id
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
            SELECT id, status, started_at, completed_at
            FROM practice_sessions
            WHERE id = $1 AND learner_id = $2
        `, [sessionId, actor.learnerId]),
        client.query<SessionItemRow>(`
            SELECT id, question_id, question_revision_id, position
            FROM practice_session_items
            WHERE practice_session_id = $1
            ORDER BY position, id
        `, [sessionId]),
    ]);
    const session = sessionResult.rows[0];
    if (!session) {
        throw new LocalPracticeRequestError("SESSION_NOT_FOUND", "找不到這次練習。", 404);
    }
    return {
        id: session.id,
        status: session.status,
        startedAt: asIso(session.started_at),
        completedAt: session.completed_at ? asIso(session.completed_at) : null,
        items: itemsResult.rows.map((item) => ({
            id: item.id,
            questionId: item.question_id,
            revisionId: item.question_revision_id,
            position: item.position,
        })),
    };
}

/** Creates an ad-hoc session owned by the authenticated learner. */
export async function createLocalPracticeSession(
    questionIds: readonly string[],
    actor: LocalPracticeActor,
): Promise<LocalPracticeSession> {
    return withLocalPostgresTransaction(async (client) => {
        const targetResult = await client.query<{ question_id: string; revision_id: string }>(`
            SELECT question.id AS question_id, revision.id AS revision_id
            ${TARGET_QUESTION_FROM_SQL}
                AND question.id = ANY($7::uuid[])
                AND EXISTS (
                    SELECT 1
                    FROM question_parts AS part
                    WHERE part.question_revision_id = revision.id
                        AND part.is_independently_gradable = true
                )
            ORDER BY array_position($7::uuid[], question.id)
            FOR SHARE OF question, revision
        `, [
            LOCAL_PRACTICE_DEFAULT_FILTERS.grade,
            subjectAliases(LOCAL_PRACTICE_DEFAULT_FILTERS.subject),
            LOCAL_PRACTICE_DEFAULT_FILTERS.publisher,
            LOCAL_PRACTICE_DEFAULT_FILTERS.volume,
            LOCAL_PRACTICE_DEFAULT_FILTERS.lesson,
            actor.learnerId,
            questionIds,
        ]);
        if (targetResult.rows.length !== questionIds.length) {
            throw new LocalPracticeRequestError(
                "QUESTION_TARGET_INVALID",
                "部分題目不存在、尚未發布，或沒有可作答的小題。請重新整理題庫。",
                409,
            );
        }

        const sessionId = randomUUID();
        await client.query(`
            INSERT INTO practice_sessions (
                id, learner_id, created_by_user_id, mode, check_mode, status
            )
            VALUES ($1, $2, $3, 'practice', 'instant', 'active')
        `, [sessionId, actor.learnerId, actor.userId]);

        const itemIds = targetResult.rows.map(() => randomUUID());
        await client.query(`
            INSERT INTO practice_session_items (
                id,
                practice_session_id,
                question_id,
                question_revision_id,
                position,
                selection_reason
            )
            SELECT
                requested.item_id,
                $1::uuid,
                requested.question_id,
                requested.revision_id,
                requested.position - 1,
                'fixed'
            FROM unnest($2::uuid[], $3::uuid[], $4::uuid[])
                WITH ORDINALITY AS requested(item_id, question_id, revision_id, position)
        `, [
            sessionId,
            itemIds,
            targetResult.rows.map((row) => row.question_id),
            targetResult.rows.map((row) => row.revision_id),
        ]);

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

function toAttempt(row: AttemptRow, partRows: readonly AttemptPartRow[]): LocalPracticeAttempt {
    return {
        id: row.id,
        sessionId: row.practice_session_id,
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

export interface SubmitLocalPracticeAttemptInput {
    sessionId: string;
    questionId: string;
    idempotencyKey: string;
    durationSeconds: number | null;
    answers: LocalPracticeAnswerInput[];
}

export interface SubmitLocalPracticeAttemptResult {
    attempt: LocalPracticeAttempt;
    session: Pick<LocalPracticeSession, "id" | "status" | "completedAt">;
    replayed: boolean;
}

/** Grades and stores one question atomically, including review queue and outbox rows. */
export async function submitLocalPracticeAttempt(
    input: SubmitLocalPracticeAttemptInput,
    actor: LocalPracticeActor,
): Promise<SubmitLocalPracticeAttemptResult> {
    return withLocalPostgresTransaction(async (client) => {
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
            if (normalized !== null) normalizedInput.set(answer.partId, normalized);
        }

        const existingResult = await client.query<AttemptRow>(`
            SELECT
                attempt.id,
                attempt.practice_session_item_id,
                item.practice_session_id,
                item.question_id,
                item.question_revision_id,
                attempt.overall_result,
                attempt.grading_source,
                attempt.duration_seconds,
                attempt.submitted_at
            FROM answer_attempts AS attempt
            JOIN practice_session_items AS item ON item.id = attempt.practice_session_item_id
            WHERE attempt.learner_id = $1 AND attempt.idempotency_key = $2
        `, [actor.learnerId, input.idempotencyKey]);
        const existing = existingResult.rows[0];
        if (existing) {
            const partRows = await getAttemptParts(client, [existing.id]);
            if (
                existing.practice_session_id !== input.sessionId
                || existing.question_id !== input.questionId
                || existing.duration_seconds !== input.durationSeconds
                || !sameAnswerPayload(partRows, normalizedInput)
            ) {
                throw new LocalPracticeRequestError(
                    "IDEMPOTENCY_CONFLICT",
                    "這個重送識別碼已用於不同的作答內容。",
                    409,
                );
            }
            const sessionResult = await client.query<SessionRow>(`
                SELECT id, status, started_at, completed_at
                FROM practice_sessions
                WHERE id = $1 AND learner_id = $2
            `, [input.sessionId, actor.learnerId]);
            const session = sessionResult.rows[0];
            if (!session) throw new LocalPracticeRequestError("SESSION_NOT_FOUND", "找不到這次練習。", 404);
            return {
                attempt: toAttempt(existing, partRows),
                session: {
                    id: session.id,
                    status: session.status,
                    completedAt: session.completed_at ? asIso(session.completed_at) : null,
                },
                replayed: true,
            };
        }

        const itemResult = await client.query<SessionItemRow & { session_status: LocalPracticeSession["status"] }>(`
            SELECT
                item.id,
                item.question_id,
                item.question_revision_id,
                item.position,
                session.status AS session_status
            FROM practice_session_items AS item
            JOIN practice_sessions AS session ON session.id = item.practice_session_id
            WHERE item.practice_session_id = $1
                AND item.question_id = $2
                AND session.learner_id = $3
            FOR UPDATE OF item, session
        `, [input.sessionId, input.questionId, actor.learnerId]);
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
            ORDER BY part.position, part.id, answer.position, answer.id
            FOR SHARE OF part
        `, [item.question_revision_id]);
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
            RETURNING id, status, started_at, completed_at
        `, [input.sessionId, actor.learnerId]);
        const finalSessionResult = completedResult.rows[0]
            ? completedResult
            : await client.query<SessionRow>(`
                SELECT id, status, started_at, completed_at
                FROM practice_sessions
                WHERE id = $1 AND learner_id = $2
            `, [input.sessionId, actor.learnerId]);
        const finalSession = finalSessionResult.rows[0];
        const attempt = insertedAttempt.rows[0];
        if (!finalSession || !attempt) throw new Error("attempt transaction did not return its final rows");

        return {
            attempt: toAttempt(attempt, insertedPartRows),
            session: {
                id: finalSession.id,
                status: finalSession.status,
                completedAt: finalSession.completed_at ? asIso(finalSession.completed_at) : null,
            },
            replayed: false,
        };
    });
}

/** Hydrates durable attempts and pending wrong-review work without answer payloads. */
export async function getLocalPracticeHistory(limit: number, actor: LocalPracticeActor): Promise<{
    attempts: LocalPracticeAttempt[];
    wrongReviewQueue: { pendingCount: number; items: LocalPracticeWrongQueueItem[] };
    sessions: LocalPracticeSessionHistory[];
}> {
    return withLocalPostgresTransaction(async (client) => {
        const [attemptResult, sessionResult, queueResult] = await Promise.all([
            client.query<AttemptRow>(`
                SELECT
                    attempt.id,
                    attempt.practice_session_item_id,
                    item.practice_session_id,
                    item.question_id,
                    item.question_revision_id,
                    attempt.overall_result,
                    attempt.grading_source,
                    attempt.duration_seconds,
                    attempt.submitted_at
                FROM answer_attempts AS attempt
                JOIN practice_session_items AS item ON item.id = attempt.practice_session_item_id
                WHERE attempt.learner_id = $1
                ORDER BY attempt.submitted_at DESC, attempt.id DESC
                LIMIT $2
            `, [actor.learnerId, limit]),
            client.query<SessionHistoryRow>(`
                SELECT
                    session.id,
                    session.status,
                    session.started_at,
                    session.completed_at,
                    count(DISTINCT item.id)::integer AS item_count,
                    count(DISTINCT item.id) FILTER (WHERE attempt.id IS NOT NULL)::integer AS attempted_item_count
                FROM practice_sessions AS session
                LEFT JOIN practice_session_items AS item ON item.practice_session_id = session.id
                LEFT JOIN answer_attempts AS attempt ON attempt.practice_session_item_id = item.id
                WHERE session.learner_id = $1
                GROUP BY session.id
                ORDER BY session.started_at DESC, session.id DESC
                LIMIT $2
            `, [actor.learnerId, limit]),
            client.query<WrongQueueRow>(`
                SELECT id, question_id, question_revision_id, question_part_id, created_at,
                    count(*) OVER () AS total_count
                FROM learner_practice_queue_items
                WHERE learner_id = $1 AND reason = 'wrong_review' AND status = 'pending'
                ORDER BY created_at DESC, id DESC
                LIMIT $2
            `, [actor.learnerId, limit]),
        ]);
        const partRows = await getAttemptParts(client, attemptResult.rows.map((attempt) => attempt.id));
        const partsByAttempt = new Map<string, AttemptPartRow[]>();
        for (const part of partRows) {
            const current = partsByAttempt.get(part.answer_attempt_id) ?? [];
            current.push(part);
            partsByAttempt.set(part.answer_attempt_id, current);
        }

        return {
            attempts: attemptResult.rows.map((attempt) => toAttempt(attempt, partsByAttempt.get(attempt.id) ?? [])),
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
            sessions: sessionResult.rows.map((session) => ({
                id: session.id,
                status: session.status,
                startedAt: asIso(session.started_at),
                completedAt: session.completed_at ? asIso(session.completed_at) : null,
                itemCount: session.item_count,
                attemptedItemCount: session.attempted_item_count,
            })),
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
        subjectAliases(filters.subject),
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
