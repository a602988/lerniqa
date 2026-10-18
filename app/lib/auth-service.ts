import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { createSessionToken, hashAccountPassword, hashSessionToken, verifyAccountPassword } from "./auth-crypto";
import type {
    AccountRole,
    CreateAccountLearnerInput,
    EnableLearnerSubjectInput,
    LearnerEducationStatus,
    LoginAccountInput,
    RegisterAccountInput,
    SwitchAccountRoleInput,
    UpdateAccountLearnerInput,
    UpdateLearnerSubjectSettingInput,
} from "./auth-input";
import { queryLocalPostgres, withLocalPostgresTransaction } from "./local-postgres";

export const AUTH_SESSION_COOKIE = "lerniqa_session";
export const AUTH_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const DEFAULT_GRADE_CODE = "junior-high-1";
const DEFAULT_SEMESTER_CODE = "semester-1";
// Matches deterministicUuid("local-practice:question-bank:default") in the Hanlin import pipeline.
const HANLIN_SYSTEM_QUESTION_BANK_ID = "af207056-08e6-554a-a405-ab6f8440d6ce";
const DUMMY_PASSWORD_HASH = [
    "scrypt",
    "v1",
    "32768",
    "8",
    "1",
    Buffer.alloc(16).toString("base64url"),
    Buffer.alloc(64).toString("base64url"),
].join("$");

export type LearnerCheckMode = "complete" | "instant" | "score";

export interface AuthenticatedLearnerPreferences {
    questionLimitOptions: number[];
    defaultQuestionLimit: number;
    defaultCheckMode: LearnerCheckMode;
}

export interface AuthenticatedLearnerSubjectSetting {
    position: number;
    lockVersion: number;
    subject: {
        code: string;
        name: string;
    };
    bookVersion: {
        id: string;
        name: string;
        publisher: {
            code: string;
            name: string;
        } | null;
    } | null;
    availableBookVersions: Array<{
        id: string;
        name: string;
        publisher: {
            code: string;
            name: string;
        } | null;
    }>;
}

export interface AuthenticatedLearnerProfile {
    id: string;
    displayName: string;
    educationStatus: LearnerEducationStatus;
    gradeCode: string | null;
    gradeName: string | null;
    semesterCode: string | null;
    semesterName: string | null;
    accessRole: AccountRole;
    canCreatePlans: boolean;
    canManageSettings: boolean;
    isSelf: boolean;
    preferences: AuthenticatedLearnerPreferences | null;
    subjectSettings: AuthenticatedLearnerSubjectSetting[];
    availableSubjects: Array<{ code: string; name: string }>;
}

export interface AuthenticatedAccount {
    sessionId: string;
    userId: string;
    displayName: string;
    email: string;
    emailVerified: boolean;
    accountRole: AccountRole | null;
    activeRole: AccountRole;
    roles: AccountRole[];
    learner: AuthenticatedLearnerProfile;
    learners: AuthenticatedLearnerProfile[];
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
    account_role: AccountRole | null;
    active_role: AccountRole;
    roles: AccountRole[];
    learner_id: string;
    expires_at: Date | string;
}

interface AccessibleLearnerRow extends QueryResultRow {
    learner_id: string;
    learner_display_name: string;
    education_status: LearnerEducationStatus;
    grade_code: string | null;
    grade_name: string | null;
    semester_code: string | null;
    semester_name: string | null;
    access_role: AccountRole;
    can_create_plans: boolean;
    can_manage_settings: boolean;
    is_self: boolean;
    learner_preferences: AuthenticatedLearnerPreferences | null;
    learner_subject_settings: AuthenticatedLearnerSubjectSetting[];
    available_learner_subjects: Array<{ code: string; name: string }>;
}

interface LoginRow extends QueryResultRow {
    user_id: string;
    password_hash: string;
    role: AccountRole;
    learner_id: string;
}

interface LoginIdentityRow extends QueryResultRow {
    user_id: string;
}

interface LockedAuthSessionRow extends QueryResultRow {
    session_id: string;
    user_id: string;
    display_name: string;
    account_role: AccountRole | null;
    active_role: AccountRole;
    learner_id: string;
}

interface PasswordHashRow extends QueryResultRow {
    password_hash: string;
}

interface RoleGrantRow extends QueryResultRow {
    granted: boolean;
}

interface LearnerAuthorizationRow extends RoleGrantRow {
    is_self: boolean;
}

interface CatalogSubjectRow extends QueryResultRow {
    subject_id: string;
    book_version_id: string | null;
    is_default: boolean;
}

interface LearnerCatalogRow extends QueryResultRow {
    grade_id: string;
    semester_id: string;
}

interface ExistingLearnerRow extends QueryResultRow {
    learner_id: string;
    display_name: string;
    education_status: LearnerEducationStatus;
    grade_id: string | null;
    semester_id: string | null;
    status: string;
    owned: boolean;
}

interface SelfLearnerRow extends QueryResultRow {
    learner_id: string;
    grade_id: string | null;
    semester_id: string | null;
}

interface LearnerSubjectSettingRow extends QueryResultRow {
    setting_id: string;
    subject_id: string;
    grade_id: string | null;
    book_version_id: string | null;
    lock_version: number;
}

type LearnerSettingsMode = "managed" | "self";
type LearnerMutationMode = LearnerSettingsMode | "current";

function asIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toLearnerProfile(row: AccessibleLearnerRow): AuthenticatedLearnerProfile {
    return {
        id: row.learner_id,
        displayName: row.learner_display_name,
        educationStatus: row.education_status,
        gradeCode: row.grade_code,
        gradeName: row.grade_name,
        semesterCode: row.semester_code,
        semesterName: row.semester_name,
        accessRole: row.access_role,
        canCreatePlans: row.can_create_plans,
        canManageSettings: row.can_manage_settings,
        isSelf: row.is_self,
        preferences: row.learner_preferences,
        subjectSettings: row.learner_subject_settings,
        availableSubjects: row.available_learner_subjects,
    };
}

function toAccount(
    row: AuthAccountRow,
    learners: AuthenticatedLearnerProfile[],
): AuthenticatedAccount {
    const learner = learners.find((candidate) => candidate.id === row.learner_id);
    if (!learner) {
        throw new AuthServiceError("AUTH_REQUIRED", "目前學習者的存取權已失效，請重新登入。", 401);
    }
    return {
        sessionId: row.session_id,
        userId: row.user_id,
        displayName: row.display_name,
        email: row.email_normalized,
        emailVerified: row.verified_at !== null,
        accountRole: row.account_role,
        activeRole: row.active_role,
        roles: [...row.roles],
        learner,
        learners,
        expiresAt: asIso(row.expires_at),
    };
}

function databaseCode(error: unknown): string | null {
    return typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : null;
}

function permissionsForRole(role: AccountRole): readonly [boolean, boolean, boolean, boolean] {
    return role === "learner"
        ? [true, false, false, true]
        : [true, true, true, true];
}

async function attachHanlinQuestionBanks(client: PoolClient, learnerId: string): Promise<void> {
    await client.query(`
        INSERT INTO question_bank_learners (question_bank_id, learner_id)
        SELECT bank.id, $1::uuid
        FROM question_banks AS bank
        WHERE bank.id = $2::uuid
            AND bank.origin = 'system'
            AND bank.owner_user_id IS NULL
            AND bank.status = 'active'
        ON CONFLICT (question_bank_id, learner_id) DO NOTHING
    `, [learnerId, HANLIN_SYSTEM_QUESTION_BANK_ID]);
}

async function lockAuthenticatedSession(
    client: PoolClient,
    tokenHash: string,
): Promise<LockedAuthSessionRow> {
    const userResult = await client.query<{ user_id: string }>(`
        SELECT session.user_id
        FROM auth_sessions AS session
        WHERE session.token_hash = $1
        LIMIT 1
    `, [tokenHash]);
    const userId = userResult.rows[0]?.user_id;
    if (!userId) {
        throw new AuthServiceError("AUTH_REQUIRED", "登入狀態已失效，請重新登入。", 401);
    }

    await client.query("SELECT lerniqa_lock_auth_user($1::uuid)", [userId]);
    const sessionResult = await client.query<LockedAuthSessionRow>(`
        SELECT
            session.id AS session_id,
            session.user_id,
            app_user.display_name,
            app_user.account_role,
            session.active_role,
            session.active_learner_id AS learner_id
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
            AND access.accepted_at IS NOT NULL
            AND access.revoked_at IS NULL
        WHERE session.token_hash = $1
            AND session.user_id = $2
            AND session.revoked_at IS NULL
            AND session.expires_at > transaction_timestamp()
        ORDER BY access.accepted_at, access.id
        LIMIT 1
        FOR UPDATE OF session
    `, [tokenHash, userId]);
    const session = sessionResult.rows[0];
    if (!session) {
        throw new AuthServiceError("AUTH_REQUIRED", "登入狀態已失效，請重新登入。", 401);
    }
    return session;
}

async function requireAccountPassword(
    client: PoolClient,
    userId: string,
    password: string | undefined,
): Promise<void> {
    const result = await client.query<PasswordHashRow>(`
        SELECT identity.password_hash
        FROM account_identities AS identity
        WHERE identity.user_id = $1
            AND identity.provider = 'email'
            AND identity.revoked_at IS NULL
        ORDER BY identity.created_at, identity.id
        LIMIT 1
    `, [userId]);
    const passwordMatches = await verifyAccountPassword(
        password ?? "",
        result.rows[0]?.password_hash ?? DUMMY_PASSWORD_HASH,
    );
    if (!passwordMatches) {
        throw new AuthServiceError("INVALID_CREDENTIALS", "密碼不正確。", 401);
    }
}

async function resolveLearnerCatalog(
    client: PoolClient,
    gradeCode: string,
    semesterCode: string,
): Promise<LearnerCatalogRow> {
    const result = await client.query<LearnerCatalogRow>(`
        SELECT grade.id AS grade_id, semester.id AS semester_id
        FROM grades AS grade
        CROSS JOIN semesters AS semester
        WHERE grade.code = $1
            AND grade.status = 'active'
            AND semester.code = $2
            AND semester.status = 'active'
        LIMIT 1
    `, [gradeCode, semesterCode]);
    const catalog = result.rows[0];
    if (!catalog) {
        throw new AuthServiceError(
            "LEARNER_CATALOG_NOT_FOUND",
            "指定的年級或學期目前不可使用。",
            400,
        );
    }
    return catalog;
}

async function readCatalogSubjectsForGrade(
    client: PoolClient,
    userId: string,
    gradeId: string,
): Promise<CatalogSubjectRow[]> {
    const result = await client.query<CatalogSubjectRow>(`
        SELECT
            grade_subject.subject_id,
            grade_subject.is_default,
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
                AND (book.origin = 'system' OR book.owner_user_id = $2)
            ORDER BY
                CASE WHEN publisher.code = 'hanlin' THEN 0 ELSE 1 END,
                CASE WHEN book.origin = 'system' THEN 0 ELSE 1 END,
                book.created_at,
                book.id
            LIMIT 1
        ) AS selected_book ON true
        WHERE grade_subject.grade_id = $1
            AND (grade_subject.active_from IS NULL OR grade_subject.active_from <= CURRENT_DATE)
            AND (grade_subject.active_until IS NULL OR grade_subject.active_until >= CURRENT_DATE)
        ORDER BY grade_subject.is_default DESC, grade_subject.sort_order, subject.id
    `, [gradeId, userId]);
    return result.rows;
}

async function createDefaultSubjectSettings(
    client: PoolClient,
    userId: string,
    learnerId: string,
    gradeId: string,
): Promise<void> {
    const subjects = await readCatalogSubjectsForGrade(client, userId, gradeId);
    for (const [position, subject] of subjects.entries()) {
        await client.query(`
            INSERT INTO learner_subject_settings (
                id, learner_id, subject_id, book_version_id,
                enabled, is_default_subject, position
            )
            VALUES ($1, $2, $3, $4, true, $5, $6)
            ON CONFLICT (learner_id, subject_id) DO NOTHING
        `, [
            randomUUID(),
            learnerId,
            subject.subject_id,
            subject.book_version_id,
            subject.is_default,
            position,
        ]);
    }
}

async function ensureLearnerPreferences(client: PoolClient, learnerId: string): Promise<void> {
    await client.query(`
        INSERT INTO learner_preferences (
            learner_id, question_limit_options, default_question_limit, default_check_mode
        )
        VALUES ($1, ARRAY[5, 10, 20, 50]::smallint[], 10, 'complete')
        ON CONFLICT (learner_id) DO NOTHING
    `, [learnerId]);
}

async function reconcileSubjectSettings(
    client: PoolClient,
    userId: string,
    learnerId: string,
    gradeId: string,
): Promise<void> {
    await client.query(`
        UPDATE learner_subject_settings AS setting
        SET
            enabled = false,
            is_default_subject = false,
            lock_version = setting.lock_version + 1,
            updated_at = transaction_timestamp()
        FROM subjects AS subject
        WHERE setting.learner_id = $1
            AND subject.id = setting.subject_id
            AND subject.origin = 'system'
            AND (
                subject.status <> 'active'
                OR NOT EXISTS (
                    SELECT 1
                    FROM grade_subjects AS grade_subject
                    WHERE grade_subject.grade_id = $2
                        AND grade_subject.subject_id = setting.subject_id
                        AND (grade_subject.active_from IS NULL OR grade_subject.active_from <= CURRENT_DATE)
                        AND (grade_subject.active_until IS NULL OR grade_subject.active_until >= CURRENT_DATE)
                )
            )
            AND (setting.enabled OR setting.is_default_subject)
    `, [learnerId, gradeId]);

    await client.query(`
        UPDATE learner_subject_settings AS setting
        SET
            is_default_subject = false,
            lock_version = setting.lock_version + 1,
            updated_at = transaction_timestamp()
        FROM subjects AS subject
        WHERE setting.learner_id = $1
            AND subject.id = setting.subject_id
            AND subject.origin = 'system'
            AND setting.is_default_subject = true
            AND NOT EXISTS (
                SELECT 1
                FROM grade_subjects AS grade_subject
                WHERE grade_subject.grade_id = $2
                    AND grade_subject.subject_id = setting.subject_id
                    AND grade_subject.is_default = true
                    AND (grade_subject.active_from IS NULL OR grade_subject.active_from <= CURRENT_DATE)
                    AND (grade_subject.active_until IS NULL OR grade_subject.active_until >= CURRENT_DATE)
            )
    `, [learnerId, gradeId]);

    const subjects = await readCatalogSubjectsForGrade(client, userId, gradeId);
    for (const [position, subject] of subjects.entries()) {
        await client.query(`
            INSERT INTO learner_subject_settings (
                id, learner_id, subject_id, book_version_id,
                enabled, is_default_subject, position
            )
            VALUES ($1, $2, $3, $4, true, $5, $6)
            ON CONFLICT (learner_id, subject_id) DO UPDATE
            SET
                enabled = true,
                book_version_id = CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM book_versions AS existing_book
                        WHERE existing_book.id = learner_subject_settings.book_version_id
                            AND existing_book.subject_id = EXCLUDED.subject_id
                            AND existing_book.status = 'active'
                            AND existing_book.grade_id = $7
                            AND (
                                existing_book.origin = 'system'
                                OR existing_book.owner_user_id = $8
                            )
                    ) THEN learner_subject_settings.book_version_id
                    ELSE EXCLUDED.book_version_id
                END,
                is_default_subject = EXCLUDED.is_default_subject,
                position = EXCLUDED.position,
                lock_version = learner_subject_settings.lock_version + 1,
                updated_at = transaction_timestamp()
        `, [
            randomUUID(),
            learnerId,
            subject.subject_id,
            subject.book_version_id,
            subject.is_default,
            position,
            gradeId,
            userId,
        ]);
    }
}

async function createLearnerForAccount(
    client: PoolClient,
    input: Readonly<{
        learnerId: string;
        userId: string;
        displayName: string;
        educationStatus: LearnerEducationStatus;
        gradeId: string | null;
        semesterId: string | null;
        accessRole: AccountRole;
    }>,
): Promise<void> {
    const [canView, canCreate, canReview, canManage] = permissionsForRole(input.accessRole);
    await client.query(`
        INSERT INTO learners (
            id, display_name, education_status, grade_id, semester_id, school_name, status
        )
        VALUES ($1, $2, $3, $4, $5, NULL, 'active')
    `, [
        input.learnerId,
        input.displayName,
        input.educationStatus,
        input.gradeId,
        input.semesterId,
    ]);
    await client.query(`
        INSERT INTO learner_access (
            id, learner_id, user_id, access_role,
            can_view_results, can_create_plans, can_review_answers, can_manage_settings,
            invited_by_user_id, accepted_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, transaction_timestamp())
    `, [
        randomUUID(),
        input.learnerId,
        input.userId,
        input.accessRole,
        canView,
        canCreate,
        canReview,
        canManage,
    ]);
    await ensureLearnerPreferences(client, input.learnerId);
    if (input.gradeId) {
        await createDefaultSubjectSettings(client, input.userId, input.learnerId, input.gradeId);
    }
    await attachHanlinQuestionBanks(client, input.learnerId);
}

function learnerSettingsMode(session: LockedAuthSessionRow): LearnerSettingsMode {
    if (session.active_role === "parent" || session.active_role === "tutor") {
        return "managed";
    }
    if (session.account_role === "learner" && session.active_role === "learner") {
        return "self";
    }
    throw new AuthServiceError(
        "LEARNER_SETTINGS_FORBIDDEN",
        "目前身份模式不可管理系統設定中的學習者。",
        403,
    );
}

async function requireSelfLearnerMode(
    client: PoolClient,
    session: LockedAuthSessionRow,
): Promise<void> {
    const result = await client.query<RoleGrantRow>(`
        SELECT EXISTS (
            SELECT 1
            FROM learner_access AS access
            JOIN learners AS learner
                ON learner.id = access.learner_id
                AND learner.status = 'active'
            WHERE access.user_id = $1
                AND access.learner_id = $2
                AND access.access_role = 'learner'
                AND access.accepted_at IS NOT NULL
                AND access.revoked_at IS NULL
        ) AS granted
    `, [session.user_id, session.learner_id]);
    if (!result.rows[0]?.granted) {
        throw new AuthServiceError(
            "LEARNER_SETTINGS_FORBIDDEN",
            "目前身份模式不可管理系統設定中的學習者。",
            403,
        );
    }
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

const AUTH_ACCOUNT_SELECT = `
    SELECT
        session.id AS session_id,
        app_user.id AS user_id,
        app_user.display_name,
        identity.email_normalized,
        identity.verified_at,
        app_user.account_role,
        session.active_role,
        ARRAY(
            SELECT granted_role.role
            FROM user_roles AS granted_role
            WHERE granted_role.user_id = session.user_id
                AND granted_role.role IN ('parent', 'learner', 'tutor')
                AND granted_role.revoked_at IS NULL
            ORDER BY
                CASE granted_role.role
                    WHEN 'parent' THEN 1
                    WHEN 'learner' THEN 2
                    WHEN 'tutor' THEN 3
                END,
                granted_role.id
        ) AS roles,
        session.active_learner_id AS learner_id,
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
        AND access.accepted_at IS NOT NULL
        AND access.revoked_at IS NULL
    JOIN account_identities AS identity
        ON identity.user_id = session.user_id
        AND identity.provider = 'email'
        AND identity.revoked_at IS NULL
`;

async function readAccessibleLearners(
    client: PoolClient,
    userId: string,
): Promise<AuthenticatedLearnerProfile[]> {
    const result = await client.query<AccessibleLearnerRow>(`
        SELECT
            learner.id AS learner_id,
            learner.display_name AS learner_display_name,
            learner.education_status,
            grade.code AS grade_code,
            grade.name AS grade_name,
            semester.code AS semester_code,
            semester.name AS semester_name,
            effective_access.access_role,
            effective_access.can_create_plans,
            effective_access.can_manage_settings,
            effective_access.is_self,
            CASE
                WHEN preference.learner_id IS NULL THEN NULL
                ELSE jsonb_build_object(
                    'questionLimitOptions', preference.question_limit_options,
                    'defaultQuestionLimit', preference.default_question_limit,
                    'defaultCheckMode', preference.default_check_mode
                )
            END AS learner_preferences,
            subject_profile.settings AS learner_subject_settings,
            subject_profile.available_subjects AS available_learner_subjects
        FROM (
            SELECT
                access.learner_id,
                CASE
                    WHEN bool_or(access.access_role = 'learner') THEN 'learner'
                    WHEN bool_or(access.access_role = 'parent') THEN 'parent'
                    ELSE 'tutor'
                END AS access_role,
                bool_or(access.can_create_plans) AS can_create_plans,
                bool_or(access.can_manage_settings) AS can_manage_settings,
                bool_or(access.access_role = 'learner') AS is_self,
                min(access.accepted_at) AS first_accepted_at
            FROM learner_access AS access
            WHERE access.user_id = $1
                AND access.accepted_at IS NOT NULL
                AND access.revoked_at IS NULL
            GROUP BY access.learner_id
        ) AS effective_access
        JOIN learners AS learner
            ON learner.id = effective_access.learner_id
            AND learner.status = 'active'
        LEFT JOIN grades AS grade ON grade.id = learner.grade_id
        LEFT JOIN semesters AS semester ON semester.id = learner.semester_id
        LEFT JOIN learner_preferences AS preference ON preference.learner_id = learner.id
        CROSS JOIN LATERAL (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'position', setting.position,
                        'lockVersion', setting.lock_version,
                        'subject', jsonb_build_object(
                            'code', subject.code,
                            'name', subject.name
                        ),
                        'bookVersion', CASE
                            WHEN book_version.id IS NULL THEN NULL
                            ELSE jsonb_build_object(
                                'id', book_version.id,
                                'name', book_version.name,
                                'publisher', CASE
                                    WHEN publisher.id IS NULL THEN NULL
                                    ELSE jsonb_build_object(
                                        'code', publisher.code,
                                        'name', publisher.name
                                    )
                                END
                            )
                        END,
                        'availableBookVersions', COALESCE((
                            SELECT jsonb_agg(
                                jsonb_build_object(
                                    'id', available_book.id,
                                    'name', available_book.name,
                                    'publisher', CASE
                                        WHEN available_publisher.id IS NULL THEN NULL
                                        ELSE jsonb_build_object(
                                            'code', available_publisher.code,
                                            'name', available_publisher.name
                                        )
                                    END
                                )
                                ORDER BY available_publisher.name, available_book.name, available_book.id
                            )
                            FROM book_versions AS available_book
                            LEFT JOIN publishers AS available_publisher
                                ON available_publisher.id = available_book.publisher_id
                            WHERE available_book.subject_id = subject.id
                                AND available_book.status = 'active'
                                AND (
                                    available_book.grade_id IS NULL
                                    OR available_book.grade_id = learner.grade_id
                                )
                                AND (
                                    available_book.origin = 'system'
                                    OR available_book.owner_user_id = $1
                                )
                                AND (
                                    available_publisher.id IS NULL
                                    OR available_publisher.status = 'active'
                                )
                        ), '[]'::jsonb)
                    )
                    ORDER BY setting.position, subject.code, setting.id
                ),
                '[]'::jsonb
            ) AS settings,
            COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object('code', candidate.code, 'name', candidate.name)
                    ORDER BY candidate.code
                )
                FROM subjects AS candidate
                WHERE candidate.subject_kind = 'leaf'
                    AND candidate.status = 'active'
                    AND (candidate.origin = 'system' OR candidate.owner_user_id = $1)
                    AND (
                        learner.grade_id IS NULL
                        OR EXISTS (
                            SELECT 1
                            FROM grade_subjects AS grade_subject
                            WHERE grade_subject.grade_id = learner.grade_id
                                AND grade_subject.subject_id = candidate.id
                                AND (grade_subject.active_from IS NULL OR grade_subject.active_from <= CURRENT_DATE)
                                AND (grade_subject.active_until IS NULL OR grade_subject.active_until >= CURRENT_DATE)
                        )
                    )
                    AND NOT EXISTS (
                        SELECT 1
                        FROM learner_subject_settings AS existing
                        WHERE existing.learner_id = learner.id
                            AND existing.subject_id = candidate.id
                            AND existing.enabled = true
                    )
            ), '[]'::jsonb) AS available_subjects
            FROM learner_subject_settings AS setting
            JOIN subjects AS subject ON subject.id = setting.subject_id
            LEFT JOIN book_versions AS book_version ON book_version.id = setting.book_version_id
            LEFT JOIN publishers AS publisher ON publisher.id = book_version.publisher_id
            WHERE setting.learner_id = learner.id
                AND setting.enabled = true
        ) AS subject_profile
        ORDER BY effective_access.first_accepted_at, learner.created_at, learner.id
    `, [userId]);
    return result.rows.map(toLearnerProfile);
}

async function readSessionAccount(
    client: PoolClient,
    lookup: "id" | "token_hash",
    value: string,
): Promise<AuthenticatedAccount> {
    const result = await client.query<AuthAccountRow>(`
        ${AUTH_ACCOUNT_SELECT}
        WHERE session.${lookup} = $1
            AND session.revoked_at IS NULL
            AND session.expires_at > transaction_timestamp()
        ORDER BY identity.created_at, identity.id, access.accepted_at, access.id
        LIMIT 1
    `, [value]);
    const row = result.rows[0];
    if (!row) throw new AuthServiceError("AUTH_REQUIRED", "登入狀態已失效，請重新登入。", 401);
    return toAccount(row, await readAccessibleLearners(client, row.user_id));
}

async function readSessionById(client: PoolClient, sessionId: string): Promise<AuthenticatedAccount> {
    return readSessionAccount(client, "id", sessionId);
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
    return withLocalPostgresTransaction(async (client) => {
        const account = await readSessionAccount(client, "token_hash", tokenHash);
        await client.query(`
            UPDATE auth_sessions
            SET last_seen_at = transaction_timestamp()
            WHERE id = $1
                AND last_seen_at < transaction_timestamp() - interval '5 minutes'
        `, [account.sessionId]);
        return account;
    });
}

export async function registerAccount(input: RegisterAccountInput): Promise<IssuedAuthSession> {
    const passwordHash = await hashAccountPassword(input.password);
    try {
        return await withLocalPostgresTransaction(async (client) => {
            const catalog = input.educationStatus === "enrolled"
                ? await resolveLearnerCatalog(client, input.gradeCode!, input.semesterCode!)
                : null;

            const userId = randomUUID();
            const identityId = randomUUID();
            const learnerId = randomUUID();
            const accessId = randomUUID();
            const grantedRoles: readonly AccountRole[] = input.role === "learner"
                ? ["learner"]
                : ["learner", input.role];
            const [canView, canCreate, canReview, canManage] = permissionsForRole(input.role);
            const learnerDisplayName = input.role === "learner"
                ? input.displayName
                : input.learnerName;

            await client.query(`
                INSERT INTO users (id, display_name, account_role, status)
                VALUES ($1, $2, $3, 'active')
            `, [userId, input.displayName, input.role]);
            await client.query(`
                INSERT INTO account_identities (
                    id, user_id, provider, provider_subject, email_normalized, password_hash, verified_at
                )
                VALUES ($1, $2, 'email', $3, $3, $4, NULL)
            `, [identityId, userId, input.email, passwordHash]);
            await client.query("SELECT lerniqa_lock_auth_user($1::uuid)", [userId]);
            for (const role of grantedRoles) {
                await client.query(`
                    INSERT INTO user_roles (
                        id, user_id, role, granted_by_type, granted_by_user_id
                    )
                    VALUES ($1, $2, $3, 'user', $2)
                `, [randomUUID(), userId, role]);
            }
            await client.query(`
                INSERT INTO learners (
                    id, display_name, education_status, grade_id, semester_id, school_name, status
                )
                VALUES ($1, $2, $3, $4, $5, NULL, 'active')
            `, [
                learnerId,
                learnerDisplayName,
                input.educationStatus,
                catalog?.grade_id ?? null,
                catalog?.semester_id ?? null,
            ]);
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

            if (catalog) {
                await createDefaultSubjectSettings(client, userId, learnerId, catalog.grade_id);
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
    return withLocalPostgresTransaction(async (client) => {
        const identityResult = await client.query<LoginIdentityRow>(`
            SELECT identity.user_id
            FROM account_identities AS identity
            WHERE identity.provider = 'email'
                AND identity.email_normalized = $1
                AND identity.revoked_at IS NULL
            LIMIT 1
        `, [input.email]);
        const userId = identityResult.rows[0]?.user_id;
        if (userId) {
            await client.query("SELECT lerniqa_lock_auth_user($1::uuid)", [userId]);
        }

        const candidateResult = userId
            ? await client.query<LoginRow>(`
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
                    AND access.accepted_at IS NOT NULL
                    AND access.revoked_at IS NULL
                JOIN learners AS learner
                    ON learner.id = access.learner_id
                    AND learner.status = 'active'
                WHERE identity.user_id = $1
                    AND identity.provider = 'email'
                    AND identity.email_normalized = $2
                    AND identity.revoked_at IS NULL
                ORDER BY
                    CASE WHEN role.role = app_user.account_role THEN 0 ELSE 1 END,
                    CASE WHEN access.access_role = app_user.account_role THEN 0 ELSE 1 END,
                    CASE WHEN role.role = access.access_role THEN 0 ELSE 1 END,
                    access.accepted_at,
                    access.learner_id,
                    role.granted_at,
                    role.role,
                    access.id,
                    role.id
                LIMIT 1
            `, [userId, input.email])
            : null;
        const candidate = candidateResult?.rows[0];
        const passwordMatches = await verifyAccountPassword(
            input.password,
            candidate?.password_hash ?? DUMMY_PASSWORD_HASH,
        );
        if (!candidate || !passwordMatches) {
            throw new AuthServiceError("INVALID_CREDENTIALS", "電子郵件或密碼不正確。", 401);
        }

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

export async function switchAccountRole(
    request: Request,
    input: SwitchAccountRoleInput,
): Promise<AuthenticatedAccount> {
    const token = sessionTokenFromRequest(request);
    if (!token) throw new AuthServiceError("AUTH_REQUIRED", "請先登入後再繼續。", 401);
    const tokenHash = hashSessionToken(token);

    return withLocalPostgresTransaction(async (client) => {
        const session = await lockAuthenticatedSession(client, tokenHash);

        const roleResult = await client.query<RoleGrantRow>(`
            SELECT EXISTS (
                SELECT 1
                FROM user_roles AS role
                WHERE role.user_id = $1
                    AND role.role = $2
                    AND role.role IN ('parent', 'learner', 'tutor')
                    AND role.revoked_at IS NULL
            ) AS granted
        `, [session.user_id, input.targetRole]);
        if (!roleResult.rows[0]?.granted) {
            throw new AuthServiceError(
                "ROLE_NOT_GRANTED",
                "這個帳號沒有可切換至該角色的授權。",
                403,
            );
        }

        if (input.targetRole !== "learner") {
            await requireAccountPassword(client, session.user_id, input.password);
        }

        if (session.active_role !== input.targetRole) {
            await client.query(`
                UPDATE auth_sessions
                SET active_role = $1
                WHERE id = $2
            `, [input.targetRole, session.session_id]);
        }

        return readSessionById(client, session.session_id);
    });
}

export async function updateAccountIdentity(
    request: Request,
    input: SwitchAccountRoleInput,
): Promise<AuthenticatedAccount> {
    const token = sessionTokenFromRequest(request);
    if (!token) throw new AuthServiceError("AUTH_REQUIRED", "請先登入後再繼續。", 401);
    const tokenHash = hashSessionToken(token);

    return withLocalPostgresTransaction(async (client) => {
        const session = await lockAuthenticatedSession(client, tokenHash);
        if (
            session.active_role === "learner"
            && (session.account_role === "parent" || session.account_role === "tutor")
        ) {
            throw new AuthServiceError(
                "ACCOUNT_SETTINGS_FORBIDDEN",
                "受管理學習者模式不可變更帳號身份；請先切回家長或家教模式。",
                403,
            );
        }
        if (input.targetRole !== "learner") {
            await requireAccountPassword(client, session.user_id, input.password);
        }

        await client.query(`
            INSERT INTO user_roles (
                id, user_id, role, granted_by_type, granted_by_user_id
            )
            SELECT $1, $2, $3::varchar(30), 'user', $2
            WHERE NOT EXISTS (
                SELECT 1
                FROM user_roles AS role
                WHERE role.user_id = $2
                    AND role.role = $3::varchar(30)
                    AND role.revoked_at IS NULL
            )
        `, [randomUUID(), session.user_id, input.targetRole]);

        let activeLearnerId = session.learner_id;
        if (input.targetRole === "learner") {
            const selfResult = await client.query<SelfLearnerRow>(`
                SELECT
                    access.learner_id,
                    learner.grade_id,
                    learner.semester_id
                FROM learner_access AS access
                JOIN learners AS learner ON learner.id = access.learner_id
                WHERE access.user_id = $1
                    AND access.access_role = 'learner'
                    AND access.revoked_at IS NULL
                ORDER BY access.accepted_at NULLS LAST, access.id
                LIMIT 1
                FOR UPDATE OF access, learner
            `, [session.user_id]);
            const selfLearner = selfResult.rows[0];
            if (selfLearner) {
                const fallbackCatalog = (
                    selfLearner.grade_id === null || selfLearner.semester_id === null
                )
                    ? await resolveLearnerCatalog(
                        client,
                        DEFAULT_GRADE_CODE,
                        DEFAULT_SEMESTER_CODE,
                    )
                    : null;
                const gradeId = selfLearner.grade_id ?? fallbackCatalog?.grade_id;
                const semesterId = selfLearner.semester_id ?? fallbackCatalog?.semester_id;
                if (!gradeId || !semesterId) {
                    throw new AuthServiceError(
                        "AUTH_SETUP_INCOMPLETE",
                        "學習者預設年級與學期尚未準備完成。",
                        503,
                    );
                }
                await client.query(`
                    UPDATE learners
                    SET
                        display_name = $1,
                        education_status = 'enrolled',
                        grade_id = COALESCE(grade_id, $2),
                        semester_id = COALESCE(semester_id, $3),
                        status = 'active',
                        updated_at = transaction_timestamp()
                    WHERE id = $4
                `, [
                    session.display_name,
                    gradeId,
                    semesterId,
                    selfLearner.learner_id,
                ]);
                await client.query(`
                    UPDATE learner_access
                    SET
                        can_view_results = true,
                        can_manage_settings = true,
                        accepted_at = COALESCE(accepted_at, transaction_timestamp())
                    WHERE user_id = $1
                        AND learner_id = $2
                        AND access_role = 'learner'
                        AND revoked_at IS NULL
                `, [session.user_id, selfLearner.learner_id]);
                await ensureLearnerPreferences(client, selfLearner.learner_id);
                await reconcileSubjectSettings(
                    client,
                    session.user_id,
                    selfLearner.learner_id,
                    gradeId,
                );
                await attachHanlinQuestionBanks(client, selfLearner.learner_id);
                activeLearnerId = selfLearner.learner_id;
            }
            else {
                const catalog = await resolveLearnerCatalog(
                    client,
                    DEFAULT_GRADE_CODE,
                    DEFAULT_SEMESTER_CODE,
                );
                activeLearnerId = randomUUID();
                await createLearnerForAccount(client, {
                    learnerId: activeLearnerId,
                    userId: session.user_id,
                    displayName: session.display_name,
                    educationStatus: "enrolled",
                    gradeId: catalog.grade_id,
                    semesterId: catalog.semester_id,
                    accessRole: "learner",
                });
            }
        }

        await client.query(`
            UPDATE users
            SET account_role = $1, updated_at = transaction_timestamp()
            WHERE id = $2
        `, [input.targetRole, session.user_id]);
        await client.query(`
            UPDATE auth_sessions
            SET active_role = $1, active_learner_id = $2
            WHERE id = $3
        `, [input.targetRole, activeLearnerId, session.session_id]);

        return readSessionById(client, session.session_id);
    });
}

export async function createAccountLearner(
    request: Request,
    input: CreateAccountLearnerInput,
): Promise<AuthenticatedAccount> {
    const token = sessionTokenFromRequest(request);
    if (!token) throw new AuthServiceError("AUTH_REQUIRED", "請先登入後再繼續。", 401);
    const tokenHash = hashSessionToken(token);

    try {
        return await withLocalPostgresTransaction(async (client) => {
            const session = await lockAuthenticatedSession(client, tokenHash);
            const mode = learnerSettingsMode(session);
            const accessRole = session.active_role;
            if (
                mode !== "managed"
                || (accessRole !== "parent" && accessRole !== "tutor")
            ) {
                throw new AuthServiceError(
                    "LEARNER_SETTINGS_FORBIDDEN",
                    "目前身份模式不可新增受管理的學習者。",
                    403,
                );
            }
            const catalog = input.educationStatus === "enrolled"
                ? await resolveLearnerCatalog(client, input.gradeCode!, input.semesterCode!)
                : null;
            const existingResult = await client.query<ExistingLearnerRow>(`
                SELECT
                    learner.id AS learner_id,
                    learner.display_name,
                    learner.education_status,
                    learner.grade_id,
                    learner.semester_id,
                    learner.status,
                    EXISTS (
                        SELECT 1
                        FROM learner_access AS access
                        WHERE access.learner_id = learner.id
                            AND access.user_id = $2
                            AND access.accepted_at IS NOT NULL
                            AND access.revoked_at IS NULL
                    ) AS owned
                FROM learners AS learner
                WHERE learner.id = $1
                FOR UPDATE OF learner
            `, [input.clientRequestId, session.user_id]);
            const existing = existingResult.rows[0];
            if (existing) {
                const isReplay = existing.owned
                    && existing.status === "active"
                    && existing.display_name === input.displayName
                    && existing.education_status === input.educationStatus
                    && existing.grade_id === (catalog?.grade_id ?? null)
                    && existing.semester_id === (catalog?.semester_id ?? null);
                if (!isReplay) {
                    throw new AuthServiceError(
                        "LEARNER_REQUEST_CONFLICT",
                        "這個請求識別碼已用於不同的學習者資料。",
                        409,
                    );
                }
            }
            else {
                await createLearnerForAccount(client, {
                    learnerId: input.clientRequestId,
                    userId: session.user_id,
                    displayName: input.displayName,
                    educationStatus: input.educationStatus,
                    gradeId: catalog?.grade_id ?? null,
                    semesterId: catalog?.semester_id ?? null,
                    accessRole,
                });
            }

            await client.query(`
                UPDATE auth_sessions
                SET active_learner_id = $1
                WHERE id = $2
            `, [input.clientRequestId, session.session_id]);
            return readSessionById(client, session.session_id);
        });
    }
    catch (error) {
        if (error instanceof AuthServiceError) throw error;
        if (databaseCode(error) === "23505") {
            throw new AuthServiceError(
                "LEARNER_REQUEST_CONFLICT",
                "這個請求識別碼已用於不同的學習者資料。",
                409,
            );
        }
        throw error;
    }
}

export async function updateAccountLearner(
    request: Request,
    input: UpdateAccountLearnerInput,
): Promise<AuthenticatedAccount> {
    const token = sessionTokenFromRequest(request);
    if (!token) throw new AuthServiceError("AUTH_REQUIRED", "請先登入後再繼續。", 401);
    const tokenHash = hashSessionToken(token);

    return withLocalPostgresTransaction(async (client) => {
        const session = await lockAuthenticatedSession(client, tokenHash);
        let mode: LearnerMutationMode;
        if (input.action === "update-current") {
            if (
                session.active_role !== "learner"
                || input.learnerId !== session.learner_id
            ) {
                throw new AuthServiceError(
                    "LEARNER_SETTINGS_FORBIDDEN",
                    "學習者模式只能修改目前選取的學習者設定。",
                    403,
                );
            }
            mode = "current";
        }
        else {
            mode = learnerSettingsMode(session);
        }
        if (input.action === "update" && mode !== "managed") {
            throw new AuthServiceError(
                "LEARNER_SETTINGS_FORBIDDEN",
                "目前身份模式不可從帳號設定修改學習者。",
                403,
            );
        }
        if (mode === "self") {
            await requireSelfLearnerMode(client, session);
            if (input.learnerId !== session.learner_id) {
                throw new AuthServiceError(
                    "LEARNER_SETTINGS_FORBIDDEN",
                    "本人身份只能管理自己的學習者設定。",
                    403,
                );
            }
        }

        const authorizedResult = await client.query<LearnerAuthorizationRow>(`
            SELECT
                EXISTS (
                    SELECT 1
                    FROM learner_access AS access
                    WHERE access.user_id = $1
                        AND access.learner_id = learner.id
                        AND access.accepted_at IS NOT NULL
                        AND access.revoked_at IS NULL
                        AND (
                            $3::text = 'select'
                            OR access.can_manage_settings = true
                        )
                        AND (
                            $4::text <> 'self'
                            OR access.access_role = 'learner'
                        )
                ) AS granted,
                EXISTS (
                    SELECT 1
                    FROM learner_access AS self_access
                    WHERE self_access.user_id = $1
                        AND self_access.learner_id = learner.id
                        AND self_access.access_role = 'learner'
                        AND self_access.accepted_at IS NOT NULL
                        AND self_access.revoked_at IS NULL
                ) AS is_self
            FROM learners AS learner
            WHERE learner.id = $2
                AND learner.status = 'active'
            FOR UPDATE OF learner
        `, [session.user_id, input.learnerId, input.action, mode]);
        const authorization = authorizedResult.rows[0];
        if (!authorization?.granted) {
            throw new AuthServiceError(
                "LEARNER_SETTINGS_FORBIDDEN",
                input.action === "select"
                    ? "無法切換至這位學習者。"
                    : "沒有權限修改這位學習者的設定。",
                403,
            );
        }

        if (input.action === "select") {
            await client.query(`
                UPDATE auth_sessions
                SET active_learner_id = $1
                WHERE id = $2
            `, [input.learnerId, session.session_id]);
            return readSessionById(client, session.session_id);
        }

        const catalog = input.educationStatus === "enrolled"
            ? await resolveLearnerCatalog(client, input.gradeCode!, input.semesterCode!)
            : null;
        if (authorization.is_self) {
            await client.query(`
                UPDATE users
                SET display_name = $1, updated_at = transaction_timestamp()
                WHERE id = $2
            `, [input.displayName, session.user_id]);
        }
        await client.query(`
            UPDATE learners
            SET
                display_name = $1,
                education_status = $2::varchar(20),
                grade_id = $3,
                semester_id = $4,
                school_name = CASE WHEN $2::varchar(20) = 'not_enrolled' THEN NULL ELSE school_name END,
                updated_at = transaction_timestamp()
            WHERE id = $5
        `, [
            input.displayName,
            input.educationStatus,
            catalog?.grade_id ?? null,
            catalog?.semester_id ?? null,
            input.learnerId,
        ]);
        if (catalog) {
            await reconcileSubjectSettings(
                client,
                session.user_id,
                input.learnerId,
                catalog.grade_id,
            );
        }
        else {
            await client.query(`
                UPDATE learner_subject_settings AS setting
                SET
                    book_version_id = NULL,
                    lock_version = setting.lock_version + 1,
                    updated_at = transaction_timestamp()
                FROM book_versions AS book
                WHERE setting.learner_id = $1
                    AND book.id = setting.book_version_id
                    AND book.grade_id IS NOT NULL
            `, [input.learnerId]);
        }
        await ensureLearnerPreferences(client, input.learnerId);
        await attachHanlinQuestionBanks(client, input.learnerId);
        return readSessionById(client, session.session_id);
    });
}

export async function updateLearnerSubjectSetting(
    request: Request,
    input: UpdateLearnerSubjectSettingInput,
): Promise<AuthenticatedAccount> {
    const token = sessionTokenFromRequest(request);
    if (!token) throw new AuthServiceError("AUTH_REQUIRED", "請先登入後再繼續。", 401);
    const tokenHash = hashSessionToken(token);

    return withLocalPostgresTransaction(async (client) => {
        const session = await lockAuthenticatedSession(client, tokenHash);
        if (input.learnerId !== session.learner_id) {
            throw new AuthServiceError(
                "LEARNER_SETTINGS_FORBIDDEN",
                "只能修改目前使用中學習者的科目版本。",
                403,
            );
        }

        const authorization = await client.query<RoleGrantRow>(`
            SELECT EXISTS (
                SELECT 1
                FROM learner_access AS access
                JOIN learners AS learner
                    ON learner.id = access.learner_id
                    AND learner.status = 'active'
                WHERE access.user_id = $1
                    AND access.learner_id = $2
                    AND access.can_manage_settings = true
                    AND access.accepted_at IS NOT NULL
                    AND access.revoked_at IS NULL
            ) AS granted
        `, [session.user_id, input.learnerId]);
        if (!authorization.rows[0]?.granted) {
            throw new AuthServiceError(
                "LEARNER_SETTINGS_FORBIDDEN",
                "沒有權限修改這位學習者的科目版本。",
                403,
            );
        }

        const settingResult = await client.query<LearnerSubjectSettingRow>(`
            SELECT
                setting.id AS setting_id,
                setting.subject_id,
                learner.grade_id,
                setting.book_version_id,
                setting.lock_version
            FROM learner_subject_settings AS setting
            JOIN learners AS learner
                ON learner.id = setting.learner_id
                AND learner.status = 'active'
            JOIN subjects AS subject
                ON subject.id = setting.subject_id
                AND subject.subject_kind = 'leaf'
                AND subject.status = 'active'
                AND (
                    subject.origin = 'system'
                    OR subject.owner_user_id = $1
                )
            WHERE setting.learner_id = $2
                AND subject.code = $3
                AND setting.enabled = true
            LIMIT 1
            FOR UPDATE OF setting
        `, [session.user_id, input.learnerId, input.subjectCode]);
        const setting = settingResult.rows[0];
        if (!setting) {
            throw new AuthServiceError(
                "LEARNER_SUBJECT_SETTING_NOT_FOUND",
                "這個科目未在目前學習者的設定中啟用。",
                404,
            );
        }

        if (setting.lock_version !== input.lockVersion) {
            if (setting.book_version_id === input.bookVersionId) {
                return readSessionById(client, session.session_id);
            }
            throw new AuthServiceError(
                "LEARNER_SUBJECT_SETTING_CONFLICT",
                "科目版本已在其他頁面更新，請重新載入後再試。",
                409,
            );
        }

        if (input.bookVersionId !== null) {
            const versionResult = await client.query<RoleGrantRow>(`
                SELECT EXISTS (
                    SELECT 1
                    FROM book_versions AS book
                    LEFT JOIN publishers AS publisher ON publisher.id = book.publisher_id
                    WHERE book.id = $1
                        AND book.subject_id = $2
                        AND book.status = 'active'
                        AND (book.grade_id IS NULL OR book.grade_id = $3)
                        AND (book.origin = 'system' OR book.owner_user_id = $4)
                        AND (publisher.id IS NULL OR publisher.status = 'active')
                ) AS granted
            `, [
                input.bookVersionId,
                setting.subject_id,
                setting.grade_id,
                session.user_id,
            ]);
            if (!versionResult.rows[0]?.granted) {
                throw new AuthServiceError(
                    "LEARNER_BOOK_VERSION_NOT_AVAILABLE",
                    "指定的教材版本不適用於目前學習者與科目。",
                    400,
                );
            }
        }

        if (setting.book_version_id !== input.bookVersionId) {
            await client.query(`
                UPDATE learner_subject_settings
                SET
                    book_version_id = $1,
                    lock_version = lock_version + 1,
                    updated_at = transaction_timestamp()
                WHERE id = $2
                    AND lock_version = $3
            `, [input.bookVersionId, setting.setting_id, input.lockVersion]);
        }

        return readSessionById(client, session.session_id);
    });
}

export async function enableLearnerSubject(
    request: Request,
    input: EnableLearnerSubjectInput,
): Promise<AuthenticatedAccount> {
    const token = sessionTokenFromRequest(request);
    if (!token) throw new AuthServiceError("AUTH_REQUIRED", "請先登入後再繼續。", 401);
    const tokenHash = hashSessionToken(token);

    return withLocalPostgresTransaction(async (client) => {
        const session = await lockAuthenticatedSession(client, tokenHash);
        if (input.learnerId !== session.learner_id) {
            throw new AuthServiceError("LEARNER_SETTINGS_FORBIDDEN", "只能修改目前使用中學習者的科目設定。", 403);
        }

        const learnerResult = await client.query<{ grade_id: string | null } & QueryResultRow>(`
            SELECT learner.grade_id
            FROM learners AS learner
            JOIN learner_access AS access
                ON access.learner_id = learner.id
                AND access.user_id = $1
                AND access.can_manage_settings = true
                AND access.accepted_at IS NOT NULL
                AND access.revoked_at IS NULL
            WHERE learner.id = $2
                AND learner.status = 'active'
            FOR UPDATE OF learner
        `, [session.user_id, input.learnerId]);
        const learner = learnerResult.rows[0];
        if (!learner) {
            throw new AuthServiceError("LEARNER_SETTINGS_FORBIDDEN", "沒有權限修改這位學習者的科目設定。", 403);
        }

        const subjectResult = await client.query<{ subject_id: string } & QueryResultRow>(`
            SELECT subject.id AS subject_id
            FROM subjects AS subject
            WHERE subject.code = $1
                AND subject.subject_kind = 'leaf'
                AND subject.status = 'active'
                AND (subject.origin = 'system' OR subject.owner_user_id = $2)
                AND (
                    $3::uuid IS NULL
                    OR EXISTS (
                        SELECT 1
                        FROM grade_subjects AS grade_subject
                        WHERE grade_subject.grade_id = $3
                            AND grade_subject.subject_id = subject.id
                            AND (grade_subject.active_from IS NULL OR grade_subject.active_from <= CURRENT_DATE)
                            AND (grade_subject.active_until IS NULL OR grade_subject.active_until >= CURRENT_DATE)
                    )
                )
            LIMIT 1
        `, [input.subjectCode, session.user_id, learner.grade_id]);
        const subject = subjectResult.rows[0];
        if (!subject) {
            throw new AuthServiceError("LEARNER_SUBJECT_NOT_AVAILABLE", "這個科目不適用於目前學習者。", 400);
        }

        await client.query(`
            INSERT INTO learner_subject_settings (
                id, learner_id, subject_id, book_version_id,
                enabled, is_default_subject, position
            )
            VALUES (
                $1, $2, $3, NULL, true, false,
                COALESCE((SELECT max(position) + 1 FROM learner_subject_settings WHERE learner_id = $2), 0)
            )
            ON CONFLICT (learner_id, subject_id) DO UPDATE
            SET
                enabled = true,
                position = CASE
                    WHEN learner_subject_settings.enabled THEN learner_subject_settings.position
                    ELSE EXCLUDED.position
                END,
                lock_version = learner_subject_settings.lock_version + 1,
                updated_at = transaction_timestamp()
        `, [randomUUID(), input.learnerId, subject.subject_id]);

        return readSessionById(client, session.session_id);
    });
}
