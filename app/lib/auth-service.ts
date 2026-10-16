import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { createSessionToken, hashAccountPassword, hashSessionToken, verifyAccountPassword } from "./auth-crypto";
import type { AccountRole, LoginAccountInput, RegisterAccountInput } from "./auth-input";
import { queryLocalPostgres, withLocalPostgresTransaction } from "./local-postgres";

export const AUTH_SESSION_COOKIE = "lerniqa_session";
export const AUTH_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const DEFAULT_GRADE_CODE = "junior-high-1";
const DEFAULT_SEMESTER_CODE = "semester-1";
const HANLIN_BANK_NAME = "翰林國文題庫";
const DUMMY_PASSWORD_HASH = [
    "scrypt",
    "v1",
    "32768",
    "8",
    "1",
    Buffer.alloc(16).toString("base64url"),
    Buffer.alloc(64).toString("base64url"),
].join("$");

export interface AuthenticatedAccount {
    sessionId: string;
    userId: string;
    displayName: string;
    email: string;
    emailVerified: boolean;
    activeRole: AccountRole;
    learner: {
        id: string;
        displayName: string;
        gradeCode: string | null;
        gradeName: string | null;
    };
    expiresAt: string;
}

export interface IssuedAuthSession {
    account: AuthenticatedAccount;
    token: string;
}

export class AuthServiceError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status: number) {
        super(message);
        this.name = "AuthServiceError";
        this.code = code;
        this.status = status;
    }
}

interface AuthAccountRow extends QueryResultRow {
    session_id: string;
    user_id: string;
    display_name: string;
    email_normalized: string;
    verified_at: Date | string | null;
    active_role: AccountRole;
    learner_id: string;
    learner_display_name: string;
    grade_code: string | null;
    grade_name: string | null;
    expires_at: Date | string;
}

interface LoginRow extends QueryResultRow {
    user_id: string;
    password_hash: string;
    role: AccountRole;
    learner_id: string;
}

interface CatalogSubjectRow extends QueryResultRow {
    subject_id: string;
    book_version_id: string | null;
}

function asIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toAccount(row: AuthAccountRow): AuthenticatedAccount {
    return {
        sessionId: row.session_id,
        userId: row.user_id,
        displayName: row.display_name,
        email: row.email_normalized,
        emailVerified: row.verified_at !== null,
        activeRole: row.active_role,
        learner: {
            id: row.learner_id,
            displayName: row.learner_display_name,
            gradeCode: row.grade_code,
            gradeName: row.grade_name,
        },
        expiresAt: asIso(row.expires_at),
    };
}

function databaseCode(error: unknown): string | null {
    return typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : null;
}

function permissionsForRole(role: AccountRole): readonly [boolean, boolean, boolean, boolean] {
    if (role === "learner") return [true, false, false, false];
    if (role === "tutor") return [true, true, true, false];
    return [true, true, true, true];
}

async function attachHanlinQuestionBanks(client: PoolClient, learnerId: string): Promise<void> {
    await client.query(`
        INSERT INTO question_bank_learners (question_bank_id, learner_id)
        SELECT DISTINCT bank.id, $1::uuid
        FROM question_banks AS bank
        WHERE bank.status = 'active'
            AND (
                bank.name = $2
                OR EXISTS (
                    SELECT 1
                    FROM question_bank_items AS bank_item
                    JOIN questions AS question ON question.id = bank_item.question_id
                    JOIN question_revisions AS revision ON revision.id = question.current_revision_id
                    JOIN book_versions AS book_version ON book_version.id = revision.book_version_id
                    JOIN publishers AS publisher ON publisher.id = book_version.publisher_id
                    WHERE bank_item.question_bank_id = bank.id
                        AND publisher.code = 'hanlin'
                )
            )
        ON CONFLICT (question_bank_id, learner_id) DO NOTHING
    `, [learnerId, HANLIN_BANK_NAME]);
}

async function issueSession(
    client: PoolClient,
    identity: Readonly<{ userId: string; role: AccountRole; learnerId: string }>,
): Promise<{ sessionId: string; token: string }> {
    const sessionId = randomUUID();
    const token = createSessionToken();
    await client.query(`
        INSERT INTO auth_sessions (
            id, user_id, token_hash, active_role, active_learner_id, expires_at
        )
        VALUES (
            $1, $2, $3, $4, $5,
            transaction_timestamp() + ($6::integer * interval '1 second')
        )
    `, [
        sessionId,
        identity.userId,
        hashSessionToken(token),
        identity.role,
        identity.learnerId,
        AUTH_SESSION_MAX_AGE_SECONDS,
    ]);
    return { sessionId, token };
}

async function readSessionById(client: PoolClient, sessionId: string): Promise<AuthenticatedAccount> {
    const result = await client.query<AuthAccountRow>(`
        SELECT
            session.id AS session_id,
            app_user.id AS user_id,
            app_user.display_name,
            identity.email_normalized,
            identity.verified_at,
            session.active_role,
            learner.id AS learner_id,
            learner.display_name AS learner_display_name,
            grade.code AS grade_code,
            grade.name AS grade_name,
            session.expires_at
        FROM auth_sessions AS session
        JOIN users AS app_user
            ON app_user.id = session.user_id
            AND app_user.status = 'active'
        JOIN user_roles AS role
            ON role.user_id = session.user_id
            AND role.role = session.active_role
            AND role.revoked_at IS NULL
        JOIN learners AS learner
            ON learner.id = session.active_learner_id
            AND learner.status = 'active'
        JOIN learner_access AS access
            ON access.user_id = session.user_id
            AND access.learner_id = session.active_learner_id
            AND access.access_role = session.active_role
            AND access.accepted_at IS NOT NULL
            AND access.revoked_at IS NULL
        JOIN account_identities AS identity
            ON identity.user_id = session.user_id
            AND identity.provider = 'email'
            AND identity.revoked_at IS NULL
        LEFT JOIN grades AS grade ON grade.id = learner.grade_id
        WHERE session.id = $1
            AND session.revoked_at IS NULL
            AND session.expires_at > transaction_timestamp()
        LIMIT 1
    `, [sessionId]);
    const row = result.rows[0];
    if (!row) throw new AuthServiceError("AUTH_REQUIRED", "請先登入後再繼續。", 401);
    return toAccount(row);
}

export function sessionTokenFromRequest(request: Request): string | null {
    const cookieHeader = request.headers.get("cookie");
    if (!cookieHeader) return null;
    for (const item of cookieHeader.split(";")) {
        const separator = item.indexOf("=");
        if (separator < 0) continue;
        const name = item.slice(0, separator).trim();
        if (name !== AUTH_SESSION_COOKIE) continue;
        const token = item.slice(separator + 1).trim();
        return /^[A-Za-z0-9_-]{43}$/u.test(token) ? token : null;
    }
    return null;
}

export function secureCookieForRequest(request: Request): boolean {
    return new URL(request.url).protocol === "https:";
}

export async function getAuthenticatedAccount(request: Request): Promise<AuthenticatedAccount> {
    const token = sessionTokenFromRequest(request);
    if (!token) throw new AuthServiceError("AUTH_REQUIRED", "請先登入後再繼續。", 401);
    const tokenHash = hashSessionToken(token);
    const result = await queryLocalPostgres<AuthAccountRow>(`
        SELECT
            session.id AS session_id,
            app_user.id AS user_id,
            app_user.display_name,
            identity.email_normalized,
            identity.verified_at,
            session.active_role,
            learner.id AS learner_id,
            learner.display_name AS learner_display_name,
            grade.code AS grade_code,
            grade.name AS grade_name,
            session.expires_at
        FROM auth_sessions AS session
        JOIN users AS app_user
            ON app_user.id = session.user_id
            AND app_user.status = 'active'
        JOIN user_roles AS role
            ON role.user_id = session.user_id
            AND role.role = session.active_role
            AND role.revoked_at IS NULL
        JOIN learners AS learner
            ON learner.id = session.active_learner_id
            AND learner.status = 'active'
        JOIN learner_access AS access
            ON access.user_id = session.user_id
            AND access.learner_id = session.active_learner_id
            AND access.access_role = session.active_role
            AND access.accepted_at IS NOT NULL
            AND access.revoked_at IS NULL
        JOIN account_identities AS identity
            ON identity.user_id = session.user_id
            AND identity.provider = 'email'
            AND identity.revoked_at IS NULL
        LEFT JOIN grades AS grade ON grade.id = learner.grade_id
        WHERE session.token_hash = $1
            AND session.revoked_at IS NULL
            AND session.expires_at > transaction_timestamp()
        LIMIT 1
    `, [tokenHash]);
    const row = result.rows[0];
    if (!row) throw new AuthServiceError("AUTH_REQUIRED", "登入狀態已失效，請重新登入。", 401);

    void queryLocalPostgres(`
        UPDATE auth_sessions
        SET last_seen_at = transaction_timestamp()
        WHERE id = $1
            AND last_seen_at < transaction_timestamp() - interval '5 minutes'
    `, [row.session_id]).catch(() => undefined);
    return toAccount(row);
}

export async function registerAccount(input: RegisterAccountInput): Promise<IssuedAuthSession> {
    const passwordHash = await hashAccountPassword(input.password);
    try {
        return await withLocalPostgresTransaction(async (client) => {
            const gradeResult = await client.query<{ id: string }>(`
                SELECT id FROM grades WHERE code = $1 AND status = 'active' LIMIT 1
            `, [DEFAULT_GRADE_CODE]);
            const gradeId = gradeResult.rows[0]?.id;
            if (!gradeId) {
                throw new AuthServiceError(
                    "AUTH_SETUP_INCOMPLETE",
                    "國一題庫目錄尚未準備完成，請先完成題庫匯入。",
                    503,
                );
            }
            const semesterResult = await client.query<{ id: string }>(`
                SELECT id FROM semesters WHERE code = $1 AND status = 'active' LIMIT 1
            `, [DEFAULT_SEMESTER_CODE]);
            const semesterId = semesterResult.rows[0]?.id ?? null;

            const userId = randomUUID();
            const identityId = randomUUID();
            const roleId = randomUUID();
            const learnerId = randomUUID();
            const accessId = randomUUID();
            const [canView, canCreate, canReview, canManage] = permissionsForRole(input.role);

            await client.query(`
                INSERT INTO users (id, display_name, status)
                VALUES ($1, $2, 'active')
            `, [userId, input.displayName]);
            await client.query(`
                INSERT INTO account_identities (
                    id, user_id, provider, provider_subject, email_normalized, password_hash, verified_at
                )
                VALUES ($1, $2, 'email', $3, $3, $4, NULL)
            `, [identityId, userId, input.email, passwordHash]);
            await client.query(`
                INSERT INTO user_roles (
                    id, user_id, role, granted_by_type, granted_by_user_id
                )
                VALUES ($1, $2, $3, 'user', $2)
            `, [roleId, userId, input.role]);
            await client.query(`
                INSERT INTO learners (
                    id, display_name, education_status, grade_id, semester_id, school_name, status
                )
                VALUES ($1, $2, 'enrolled', $3, $4, NULL, 'active')
            `, [learnerId, input.learnerName, gradeId, semesterId]);
            await client.query(`
                INSERT INTO learner_access (
                    id, learner_id, user_id, access_role,
                    can_view_results, can_create_plans, can_review_answers, can_manage_settings,
                    invited_by_user_id, accepted_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, transaction_timestamp())
            `, [
                accessId,
                learnerId,
                userId,
                input.role,
                canView,
                canCreate,
                canReview,
                canManage,
            ]);
            await client.query(`
                INSERT INTO learner_preferences (
                    learner_id, question_limit_options, default_question_limit, default_check_mode
                )
                VALUES ($1, ARRAY[5, 10, 20, 50]::smallint[], 10, 'complete')
            `, [learnerId]);

            const subjectResult = await client.query<CatalogSubjectRow>(`
                SELECT
                    grade_subject.subject_id,
                    selected_book.id AS book_version_id
                FROM grade_subjects AS grade_subject
                JOIN subjects AS subject
                    ON subject.id = grade_subject.subject_id
                    AND subject.status = 'active'
                LEFT JOIN LATERAL (
                    SELECT book.id
                    FROM book_versions AS book
                    LEFT JOIN publishers AS publisher ON publisher.id = book.publisher_id
                    WHERE book.subject_id = subject.id
                        AND book.grade_id = grade_subject.grade_id
                        AND book.status = 'active'
                    ORDER BY
                        CASE WHEN publisher.code = 'hanlin' THEN 0 ELSE 1 END,
                        book.created_at,
                        book.id
                    LIMIT 1
                ) AS selected_book ON true
                WHERE grade_subject.grade_id = $1
                    AND (grade_subject.active_from IS NULL OR grade_subject.active_from <= CURRENT_DATE)
                    AND (grade_subject.active_until IS NULL OR grade_subject.active_until >= CURRENT_DATE)
                ORDER BY grade_subject.is_default DESC, grade_subject.sort_order, subject.id
            `, [gradeId]);
            for (const [position, subject] of subjectResult.rows.entries()) {
                await client.query(`
                    INSERT INTO learner_subject_settings (
                        id, learner_id, subject_id, book_version_id,
                        enabled, is_default_subject, position
                    )
                    VALUES ($1, $2, $3, $4, true, $5, $6)
                `, [
                    randomUUID(),
                    learnerId,
                    subject.subject_id,
                    subject.book_version_id,
                    position === 0,
                    position,
                ]);
            }

            await attachHanlinQuestionBanks(client, learnerId);
            const issued = await issueSession(client, { userId, role: input.role, learnerId });
            const account = await readSessionById(client, issued.sessionId);
            return { account, token: issued.token };
        });
    }
    catch (error) {
        if (error instanceof AuthServiceError) throw error;
        if (databaseCode(error) === "23505") {
            throw new AuthServiceError(
                "EMAIL_ALREADY_REGISTERED",
                "這個電子郵件已註冊，請改用登入。",
                409,
            );
        }
        throw error;
    }
}

export async function loginAccount(input: LoginAccountInput): Promise<IssuedAuthSession> {
    const candidateResult = await queryLocalPostgres<LoginRow>(`
        SELECT
            identity.user_id,
            identity.password_hash,
            role.role,
            access.learner_id
        FROM account_identities AS identity
        JOIN users AS app_user
            ON app_user.id = identity.user_id
            AND app_user.status = 'active'
        JOIN user_roles AS role
            ON role.user_id = identity.user_id
            AND role.role IN ('parent', 'learner', 'tutor')
            AND role.revoked_at IS NULL
        JOIN learner_access AS access
            ON access.user_id = identity.user_id
            AND access.access_role = role.role
            AND access.accepted_at IS NOT NULL
            AND access.revoked_at IS NULL
        JOIN learners AS learner
            ON learner.id = access.learner_id
            AND learner.status = 'active'
        WHERE identity.provider = 'email'
            AND identity.email_normalized = $1
            AND identity.revoked_at IS NULL
        ORDER BY role.granted_at, access.accepted_at, access.learner_id
        LIMIT 1
    `, [input.email]);
    const candidate = candidateResult.rows[0];
    const passwordMatches = await verifyAccountPassword(
        input.password,
        candidate?.password_hash ?? DUMMY_PASSWORD_HASH,
    );
    if (!candidate || !passwordMatches) {
        throw new AuthServiceError("INVALID_CREDENTIALS", "電子郵件或密碼不正確。", 401);
    }

    return withLocalPostgresTransaction(async (client) => {
        await attachHanlinQuestionBanks(client, candidate.learner_id);
        const issued = await issueSession(client, {
            userId: candidate.user_id,
            role: candidate.role,
            learnerId: candidate.learner_id,
        });
        const account = await readSessionById(client, issued.sessionId);
        return { account, token: issued.token };
    });
}

export async function logoutAccount(request: Request): Promise<void> {
    const token = sessionTokenFromRequest(request);
    if (!token) return;
    await queryLocalPostgres(`
        UPDATE auth_sessions
        SET revoked_at = COALESCE(revoked_at, transaction_timestamp())
        WHERE token_hash = $1
    `, [hashSessionToken(token)]);
}
