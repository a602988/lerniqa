import type { QueryResultRow } from "pg";

import type { AdminQueryRunner } from "./admin-auth.ts";
import {
    GRANTED_ROLES,
    AdminApiError,
    type AccountListQuery,
    type AccountIdentityRole,
    type AccountSortField,
    type AccountStatus,
    type GrantedRole,
} from "./admin-types.ts";

export interface AdminAccountListItem {
    id: string;
    displayName: string;
    email: string | null;
    emailVerified: boolean;
    status: AccountStatus;
    roles: GrantedRole[];
    activeLearnerCount: number;
    activeSessionCount: number;
    createdAt: string;
    updatedAt: string;
}
export interface AdminAccountIdentity {
    id: string;
    provider: string;
    email: string | null;
    verifiedAt: string | null;
    createdAt: string;
    revokedAt: string | null;
}

export interface AdminAccountRoleGrant {
    id: string;
    role: GrantedRole;
    grantedAt: string;
    revokedAt: string | null;
    active: boolean;
}

export interface AdminAccountLearnerAccess {
    id: string;
    learnerId: string;
    learnerDisplayName: string;
    learnerStatus: string;
    accessRole: AccountIdentityRole;
    gradeCode: string | null;
    gradeName: string | null;
    semesterCode: string | null;
    semesterName: string | null;
    acceptedAt: string | null;
    revokedAt: string | null;
    canViewResults: boolean;
    canCreatePlans: boolean;
    canReviewAnswers: boolean;
    canManageSettings: boolean;
}

export interface AdminAccountDetail extends AdminAccountListItem {
    closedAt: string | null;
    lastSessionSeenAt: string | null;
    identities: AdminAccountIdentity[];
    roleGrants: AdminAccountRoleGrant[];
    learnerAccess: AdminAccountLearnerAccess[];
}

export interface AdminAccountPage {
    items: AdminAccountListItem[];
    page: number;
    pageSize: number;
    total: number;
}

interface AccountListRow extends QueryResultRow {
    id: string | null;
    display_name: string | null;
    status: AccountStatus | null;
    created_at: Date | string | null;
    updated_at: Date | string | null;
    email_normalized: string | null;
    verified_at: Date | string | null;
    role_names: string[] | null;
    active_learner_count: number | string | null;
    active_session_count: number | string | null;
    total_count: number | string;
}

interface AccountCoreRow extends QueryResultRow {
    id: string;
    display_name: string;
    status: AccountStatus;
    created_at: Date | string;
    updated_at: Date | string;
    closed_at: Date | string | null;
    email_normalized: string | null;
    verified_at: Date | string | null;
    role_names: string[] | null;
    active_learner_count: number | string;
    active_session_count: number | string;
    last_session_seen_at: Date | string | null;
}

interface IdentityRow extends QueryResultRow {
    id: string;
    provider: string;
    email_normalized: string | null;
    verified_at: Date | string | null;
    created_at: Date | string;
    revoked_at: Date | string | null;
}

interface RoleGrantRow extends QueryResultRow {
    id: string;
    role: GrantedRole;
    granted_at: Date | string;
    revoked_at: Date | string | null;
}

interface LearnerAccessRow extends QueryResultRow {
    id: string;
    learner_id: string;
    learner_display_name: string;
    learner_status: string;
    access_role: AccountIdentityRole;
    grade_code: string | null;
    grade_name: string | null;
    semester_code: string | null;
    semester_name: string | null;
    accepted_at: Date | string | null;
    revoked_at: Date | string | null;
    can_view_results: boolean;
    can_create_plans: boolean;
    can_review_answers: boolean;
    can_manage_settings: boolean;
}

const ACCOUNT_SORT_SQL: Readonly<Record<AccountSortField, string>> = {
    createdAt: "page_row.created_at",
    displayName: "page_row.sort_display_name",
    email: "page_row.sort_email",
    status: "page_row.status",
    updatedAt: "page_row.updated_at",
    id: "page_row.id",
};

const ACTIVE_ROLE_SET = new Set<string>(GRANTED_ROLES);

function asIso(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new AdminApiError("INTERNAL_ERROR", "帳號日期資料格式不正確。", 500);
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
        throw new AdminApiError("INTERNAL_ERROR", "帳號統計資料格式不正確。", 500);
    }
    return parsed;
}

function normalizeRoles(value: string[] | null): GrantedRole[] {
    if (!value) return [];
    return value.filter((role): role is GrantedRole => ACTIVE_ROLE_SET.has(role));
}

function buildOrderBy(
    orderBy: AccountListQuery["orderBy"],
): string {
    const requested = orderBy.length > 0
        ? [...orderBy]
        : [{ field: "createdAt" as const, direction: "desc" as const }];
    if (!requested.some((sort) => sort.field === "id")) {
        requested.push({
            field: "id",
            direction: requested[0]?.direction ?? "desc",
        });
    }

    return requested.map(({ field, direction }) => {
        const expression = ACCOUNT_SORT_SQL[field];
        if (!expression || (direction !== "asc" && direction !== "desc")) {
            throw new AdminApiError("INVALID_QUERY", "帳號排序條件不正確。", 400);
        }
        return `${expression} ${direction.toUpperCase()}`;
    }).join(", ");
}

function buildAccountFilters(query: AccountListQuery): {
    sql: string;
    values: unknown[];
} {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const bind = (value: unknown): string => {
        values.push(value);
        return `$${values.length}`;
    };

    if (query.search) {
        const parameter = bind(query.search);
        clauses.push(`(
            position(lower(${parameter}) in lower(app_user.display_name)) > 0
            OR position(lower(${parameter}) in lower(coalesce(primary_identity.email_normalized, ''))) > 0
            OR app_user.id::text = lower(${parameter})
        )`);
    }
    if (query.statuses.length > 0) {
        clauses.push(`app_user.status = ANY(${bind(query.statuses)}::varchar[])`);
    }
    if (query.roles.length > 0) {
        clauses.push(`EXISTS (
            SELECT 1
            FROM user_roles AS filtered_role
            WHERE filtered_role.user_id = app_user.id
                AND filtered_role.revoked_at IS NULL
                AND filtered_role.role = ANY(${bind(query.roles)}::varchar[])
        )`);
    }
    if (query.created.from) {
        clauses.push(`app_user.created_at >= (${bind(query.created.from)}::date::timestamp AT TIME ZONE 'Asia/Taipei')`);
    }
    if (query.created.to) {
        clauses.push(`app_user.created_at < (((${bind(query.created.to)}::date + 1)::timestamp) AT TIME ZONE 'Asia/Taipei')`);
    }

    return {
        sql: clauses.length > 0 ? `WHERE ${clauses.join("\n            AND ")}` : "",
        values,
    };
}

function mapAccountListRow(row: AccountListRow | AccountCoreRow): AdminAccountListItem {
    if (!row.id || !row.display_name || !row.status || !row.created_at || !row.updated_at) {
        throw new AdminApiError("INTERNAL_ERROR", "帳號清單資料不完整。", 500);
    }
    return {
        id: row.id,
        displayName: row.display_name,
        email: row.email_normalized,
        emailVerified: row.verified_at !== null,
        status: row.status,
        roles: normalizeRoles(row.role_names),
        activeLearnerCount: asSafeCount(row.active_learner_count),
        activeSessionCount: asSafeCount(row.active_session_count),
        createdAt: asIso(row.created_at),
        updatedAt: asIso(row.updated_at),
    };
}

export async function listAccounts(
    runner: AdminQueryRunner,
    query: AccountListQuery,
): Promise<AdminAccountPage> {
    const filters = buildAccountFilters(query);
    const limitParameter = `$${filters.values.length + 1}`;
    const offsetParameter = `$${filters.values.length + 2}`;
    const orderBy = buildOrderBy(query.orderBy);
    const result = await runner.query<AccountListRow>(`
        WITH account_row AS (
            SELECT
                app_user.id,
                app_user.display_name,
                app_user.status,
                app_user.created_at,
                app_user.updated_at,
                primary_identity.email_normalized,
                primary_identity.verified_at,
                coalesce(active_roles.role_names, ARRAY[]::varchar[]) AS role_names,
                coalesce(learner_summary.active_learner_count, 0) AS active_learner_count,
                coalesce(session_summary.active_session_count, 0) AS active_session_count,
                lower(app_user.display_name) AS sort_display_name,
                lower(coalesce(primary_identity.email_normalized, '')) AS sort_email
            FROM users AS app_user
            LEFT JOIN LATERAL (
                SELECT identity.email_normalized, identity.verified_at
                FROM account_identities AS identity
                WHERE identity.user_id = app_user.id
                    AND identity.provider = 'email'
                    AND identity.revoked_at IS NULL
                ORDER BY identity.created_at, identity.id
                LIMIT 1
            ) AS primary_identity ON true
            LEFT JOIN LATERAL (
                SELECT array_agg(role.role ORDER BY role.role, role.id) AS role_names
                FROM user_roles AS role
                WHERE role.user_id = app_user.id
                    AND role.revoked_at IS NULL
            ) AS active_roles ON true
            LEFT JOIN LATERAL (
                SELECT count(DISTINCT access.learner_id)::integer AS active_learner_count
                FROM learner_access AS access
                JOIN learners AS learner
                    ON learner.id = access.learner_id
                    AND learner.status = 'active'
                WHERE access.user_id = app_user.id
                    AND access.accepted_at IS NOT NULL
                    AND access.revoked_at IS NULL
            ) AS learner_summary ON true
            LEFT JOIN LATERAL (
                SELECT count(*)::integer AS active_session_count
                FROM auth_sessions AS session
                WHERE session.user_id = app_user.id
                    AND session.revoked_at IS NULL
                    AND session.expires_at > transaction_timestamp()
            ) AS session_summary ON true
            ${filters.sql}
        ),
        page AS (
            SELECT *
            FROM account_row AS page_row
            ORDER BY ${orderBy}
            LIMIT ${limitParameter}
            OFFSET ${offsetParameter}
        ),
        account_count AS (
            SELECT count(*) AS total_count FROM account_row
        )
        SELECT page_row.*, account_count.total_count
        FROM account_count
        LEFT JOIN page AS page_row ON true
        ORDER BY ${orderBy}
    `, [...filters.values, query.limit, query.offset]);

    const total = asSafeCount(result.rows[0]?.total_count ?? 0);
    return {
        items: result.rows.filter((row) => row.id !== null).map(mapAccountListRow),
        page: query.page,
        pageSize: query.pageSize,
        total,
    };
}

export async function getAccountDetail(
    runner: AdminQueryRunner,
    userId: string,
): Promise<AdminAccountDetail> {
    const coreResult = await runner.query<AccountCoreRow>(`
        SELECT
            app_user.id,
            app_user.display_name,
            app_user.status,
            app_user.created_at,
            app_user.updated_at,
            app_user.closed_at,
            primary_identity.email_normalized,
            primary_identity.verified_at,
            coalesce(active_roles.role_names, ARRAY[]::varchar[]) AS role_names,
            coalesce(learner_summary.active_learner_count, 0) AS active_learner_count,
            coalesce(session_summary.active_session_count, 0) AS active_session_count,
            session_summary.last_session_seen_at
        FROM users AS app_user
        LEFT JOIN LATERAL (
            SELECT identity.email_normalized, identity.verified_at
            FROM account_identities AS identity
            WHERE identity.user_id = app_user.id
                AND identity.provider = 'email'
                AND identity.revoked_at IS NULL
            ORDER BY identity.created_at, identity.id
            LIMIT 1
        ) AS primary_identity ON true
        LEFT JOIN LATERAL (
            SELECT array_agg(role.role ORDER BY role.role, role.id) AS role_names
            FROM user_roles AS role
            WHERE role.user_id = app_user.id
                AND role.revoked_at IS NULL
        ) AS active_roles ON true
        LEFT JOIN LATERAL (
            SELECT count(DISTINCT access.learner_id)::integer AS active_learner_count
            FROM learner_access AS access
            JOIN learners AS learner
                ON learner.id = access.learner_id
                AND learner.status = 'active'
            WHERE access.user_id = app_user.id
                AND access.accepted_at IS NOT NULL
                AND access.revoked_at IS NULL
        ) AS learner_summary ON true
        LEFT JOIN LATERAL (
            SELECT
                count(*) FILTER (
                    WHERE session.revoked_at IS NULL
                        AND session.expires_at > transaction_timestamp()
                )::integer AS active_session_count,
                max(session.last_seen_at) AS last_session_seen_at
            FROM auth_sessions AS session
            WHERE session.user_id = app_user.id
        ) AS session_summary ON true
        WHERE app_user.id = $1
        LIMIT 1
    `, [userId]);
    const core = coreResult.rows[0];
    if (!core) throw new AdminApiError("NOT_FOUND", "找不到指定帳號。", 404);

    const identityResult = await runner.query<IdentityRow>(`
        SELECT
            identity.id,
            identity.provider,
            identity.email_normalized,
            identity.verified_at,
            identity.created_at,
            identity.revoked_at
        FROM account_identities AS identity
        WHERE identity.user_id = $1
        ORDER BY identity.created_at, identity.id
    `, [userId]);
    const roleResult = await runner.query<RoleGrantRow>(`
        SELECT role.id, role.role, role.granted_at, role.revoked_at
        FROM user_roles AS role
        WHERE role.user_id = $1
        ORDER BY role.granted_at, role.id
    `, [userId]);
    const learnerResult = await runner.query<LearnerAccessRow>(`
        SELECT
            access.id,
            access.learner_id,
            learner.display_name AS learner_display_name,
            learner.status AS learner_status,
            access.access_role,
            grade.code AS grade_code,
            grade.name AS grade_name,
            semester.code AS semester_code,
            semester.name AS semester_name,
            access.accepted_at,
            access.revoked_at,
            access.can_view_results,
            access.can_create_plans,
            access.can_review_answers,
            access.can_manage_settings
        FROM learner_access AS access
        JOIN learners AS learner ON learner.id = access.learner_id
        LEFT JOIN grades AS grade ON grade.id = learner.grade_id
        LEFT JOIN semesters AS semester ON semester.id = learner.semester_id
        WHERE access.user_id = $1
        ORDER BY access.revoked_at NULLS FIRST, learner.created_at, access.id
    `, [userId]);

    return {
        ...mapAccountListRow(core),
        closedAt: asNullableIso(core.closed_at),
        lastSessionSeenAt: asNullableIso(core.last_session_seen_at),
        identities: identityResult.rows.map((identity) => ({
            id: identity.id,
            provider: identity.provider,
            email: identity.email_normalized,
            verifiedAt: asNullableIso(identity.verified_at),
            createdAt: asIso(identity.created_at),
            revokedAt: asNullableIso(identity.revoked_at),
        })),
        roleGrants: roleResult.rows.map((role) => ({
            id: role.id,
            role: role.role,
            grantedAt: asIso(role.granted_at),
            revokedAt: asNullableIso(role.revoked_at),
            active: role.revoked_at === null,
        })),
        learnerAccess: learnerResult.rows.map((access) => ({
            id: access.id,
            learnerId: access.learner_id,
            learnerDisplayName: access.learner_display_name,
            learnerStatus: access.learner_status,
            accessRole: access.access_role,
            gradeCode: access.grade_code,
            gradeName: access.grade_name,
            semesterCode: access.semester_code,
            semesterName: access.semester_name,
            acceptedAt: asNullableIso(access.accepted_at),
            revokedAt: asNullableIso(access.revoked_at),
            canViewResults: access.can_view_results,
            canCreatePlans: access.can_create_plans,
            canReviewAnswers: access.can_review_answers,
            canManageSettings: access.can_manage_settings,
        })),
    };
}
