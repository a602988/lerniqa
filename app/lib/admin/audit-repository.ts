import type { QueryResultRow } from "pg";

import type { AdminQueryRunner } from "./admin-auth.ts";
import {
    AdminApiError,
    type AuditListQuery,
    type AuditSortField,
} from "./admin-types.ts";

type SafeAuditScalar = string | number | boolean | null;
type SafeAuditData = Record<string, SafeAuditScalar>;

export interface AdminAuditListItem {
    id: string;
    actor: {
        type: string;
        userId: string | null;
        displayName: string | null;
    };
    action: string;
    targetType: string;
    targetId: string | null;
    before: SafeAuditData | null;
    after: SafeAuditData | null;
    requestId: string;
    occurredAt: string;
}

export interface AdminAuditPage {
    items: AdminAuditListItem[];
    page: number;
    pageSize: number;
    total: number;
}

interface AuditRow extends QueryResultRow {
    id: string | null;
    actor_type: string | null;
    actor_user_id: string | null;
    actor_display_name: string | null;
    action: string | null;
    target_type: string | null;
    target_id: string | null;
    before_data: unknown;
    after_data: unknown;
    request_id: string | null;
    created_at: Date | string | null;
    total_count: number | string;
}

const AUDIT_SORT_SQL: Readonly<Record<AuditSortField, string>> = {
    occurredAt: "page_row.created_at",
    action: "page_row.action",
    targetType: "page_row.target_type",
    id: "page_row.id",
};

const COMMON_STATUS_FIELDS = [
    "status",
    "fromStatus",
    "toStatus",
    "reason",
] as const;

const SUBSCRIPTION_PLAN_FIELDS = [
    "code",
    "name",
    "description",
    "status",
    "lockVersion",
] as const;

const SUBSCRIPTION_PRICE_FIELDS = [
    "planId",
    "currency",
    "amountMinor",
    "billingInterval",
    "billingIntervalCount",
    "effectiveFrom",
    "effectiveUntil",
    "status",
    "lockVersion",
] as const;

const SUBSCRIPTION_FEATURE_DEFINITION_FIELDS = [
    "featureKey",
    "displayName",
    "description",
    "valueType",
    "unit",
    "status",
    "lockVersion",
] as const;

const SUBSCRIPTION_FEATURE_LIMIT_FIELDS = [
    "planId",
    "featureDefinitionId",
    "included",
    "unlimited",
    "limit",
    "lockVersion",
] as const;

const AUDIT_FIELD_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
    account_status_changed: [
        ...COMMON_STATUS_FIELDS,
        "revokedSessionCount",
    ],
    account_suspended: [...COMMON_STATUS_FIELDS, "revokedSessionCount"],
    account_reactivated: COMMON_STATUS_FIELDS,
    admin_role_granted: ["role", "userId"],
    admin_role_revoked: ["role", "userId"],
    system_question_revision_draft_created: [
        "questionId",
        "revisionNumber",
        "baseRevisionId",
        "changeNote",
        ...COMMON_STATUS_FIELDS,
    ],
    system_question_revision_status_changed: [
        "questionId",
        "revisionNumber",
        "changeNote",
        ...COMMON_STATUS_FIELDS,
    ],
    system_question_revision_reviewed: [
        "questionId",
        "revisionNumber",
        "decision",
        ...COMMON_STATUS_FIELDS,
    ],
    data_erasure_completed: COMMON_STATUS_FIELDS,
    analytics_privacy_policy_changed: [
        "policyKey",
        "aggregationScope",
        "minimumDistinctLearners",
        ...COMMON_STATUS_FIELDS,
    ],
    subscription_plan_created: SUBSCRIPTION_PLAN_FIELDS,
    subscription_plan_updated: SUBSCRIPTION_PLAN_FIELDS,
    subscription_plan_activated: SUBSCRIPTION_PLAN_FIELDS,
    subscription_plan_retired: SUBSCRIPTION_PLAN_FIELDS,
    subscription_price_created: SUBSCRIPTION_PRICE_FIELDS,
    subscription_price_updated: SUBSCRIPTION_PRICE_FIELDS,
    subscription_price_activated: SUBSCRIPTION_PRICE_FIELDS,
    subscription_price_retired: SUBSCRIPTION_PRICE_FIELDS,
    subscription_feature_definition_created: SUBSCRIPTION_FEATURE_DEFINITION_FIELDS,
    subscription_feature_definition_updated: SUBSCRIPTION_FEATURE_DEFINITION_FIELDS,
    subscription_feature_definition_activated: SUBSCRIPTION_FEATURE_DEFINITION_FIELDS,
    subscription_feature_definition_retired: SUBSCRIPTION_FEATURE_DEFINITION_FIELDS,
    subscription_feature_limit_set: SUBSCRIPTION_FEATURE_LIMIT_FIELDS,
    subscription_feature_limit_updated: SUBSCRIPTION_FEATURE_LIMIT_FIELDS,
};

function asIso(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new AdminApiError("INTERNAL_ERROR", "稽核日期資料格式不正確。", 500);
    }
    return date.toISOString();
}

function asSafeCount(value: number | string): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new AdminApiError("INTERNAL_ERROR", "稽核統計資料格式不正確。", 500);
    }
    return parsed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value === "string") {
        try {
            return asRecord(JSON.parse(value));
        } catch {
            return null;
        }
    }
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function isSafeScalar(value: unknown): value is SafeAuditScalar {
    return value === null
        || typeof value === "string"
        || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value));
}

export function sanitizeAuditData(
    action: string,
    value: unknown,
): SafeAuditData | null {
    const source = asRecord(value);
    const allowedFields = AUDIT_FIELD_ALLOWLIST[action];
    if (!source || !allowedFields) return null;

    const safe: SafeAuditData = {};
    for (const field of allowedFields) {
        const candidate = source[field];
        if (isSafeScalar(candidate)) safe[field] = candidate;
    }
    return Object.keys(safe).length > 0 ? safe : null;
}

function buildOrderBy(query: AuditListQuery): string {
    const requested = query.orderBy.length > 0
        ? [...query.orderBy]
        : [{ field: "occurredAt" as const, direction: "desc" as const }];
    if (!requested.some((sort) => sort.field === "id")) {
        requested.push({ field: "id", direction: requested[0]?.direction ?? "desc" });
    }
    return requested.map(({ field, direction }) => {
        const expression = AUDIT_SORT_SQL[field];
        if (!expression || (direction !== "asc" && direction !== "desc")) {
            throw new AdminApiError("INVALID_QUERY", "稽核排序條件不正確。", 400);
        }
        return `${expression} ${direction.toUpperCase()}`;
    }).join(", ");
}

function buildAuditFilters(query: AuditListQuery): { sql: string; values: unknown[] } {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const bind = (value: unknown): string => {
        values.push(value);
        return `$${values.length}`;
    };

    if (query.search) {
        const parameter = bind(query.search);
        clauses.push(`(
            position(lower(${parameter}) in lower(audit.action)) > 0
            OR position(lower(${parameter}) in lower(audit.target_type)) > 0
            OR position(lower(${parameter}) in lower(audit.request_id)) > 0
            OR position(lower(${parameter}) in lower(coalesce(actor.display_name, ''))) > 0
            OR audit.target_id::text = lower(${parameter})
            OR audit.actor_user_id::text = lower(${parameter})
        )`);
    }
    if (query.actions.length > 0) {
        clauses.push(`audit.action = ANY(${bind(query.actions)}::varchar[])`);
    }
    if (query.targetTypes.length > 0) {
        clauses.push(`audit.target_type = ANY(${bind(query.targetTypes)}::varchar[])`);
    }
    if (query.occurred.from) {
        clauses.push(`audit.created_at >= (${bind(query.occurred.from)}::date::timestamp AT TIME ZONE 'Asia/Taipei')`);
    }
    if (query.occurred.to) {
        clauses.push(`audit.created_at < (((${bind(query.occurred.to)}::date + 1)::timestamp) AT TIME ZONE 'Asia/Taipei')`);
    }
    return {
        sql: clauses.length > 0 ? `WHERE ${clauses.join("\n            AND ")}` : "",
        values,
    };
}

export async function listAuditLogs(
    runner: AdminQueryRunner,
    query: AuditListQuery,
): Promise<AdminAuditPage> {
    const filters = buildAuditFilters(query);
    const limitParameter = `$${filters.values.length + 1}`;
    const offsetParameter = `$${filters.values.length + 2}`;
    const orderBy = buildOrderBy(query);
    const result = await runner.query<AuditRow>(`
        WITH audit_row AS (
            SELECT
                audit.id,
                audit.actor_type,
                audit.actor_user_id,
                actor.display_name AS actor_display_name,
                audit.action,
                audit.target_type,
                audit.target_id,
                audit.before_data,
                audit.after_data,
                audit.request_id,
                audit.created_at
            FROM admin_audit_logs AS audit
            LEFT JOIN users AS actor ON actor.id = audit.actor_user_id
            ${filters.sql}
        ),
        page AS (
            SELECT * FROM audit_row AS page_row
            ORDER BY ${orderBy}
            LIMIT ${limitParameter}
            OFFSET ${offsetParameter}
        ),
        audit_count AS (
            SELECT count(*) AS total_count FROM audit_row
        )
        SELECT page_row.*, audit_count.total_count
        FROM audit_count
        LEFT JOIN page AS page_row ON true
        ORDER BY ${orderBy}
    `, [...filters.values, query.limit, query.offset]);

    const items = result.rows
        .filter((row) => row.id !== null)
        .map((row): AdminAuditListItem => {
            if (
                !row.id
                || !row.actor_type
                || !row.action
                || !row.target_type
                || !row.request_id
                || !row.created_at
            ) {
                throw new AdminApiError("INTERNAL_ERROR", "稽核清單資料不完整。", 500);
            }
            return {
                id: row.id,
                actor: {
                    type: row.actor_type,
                    userId: row.actor_user_id,
                    displayName: row.actor_display_name,
                },
                action: row.action,
                targetType: row.target_type,
                targetId: row.target_id,
                before: sanitizeAuditData(row.action, row.before_data),
                after: sanitizeAuditData(row.action, row.after_data),
                requestId: row.request_id,
                occurredAt: asIso(row.created_at),
            };
        });

    return {
        items,
        page: query.page,
        pageSize: query.pageSize,
        total: asSafeCount(result.rows[0]?.total_count ?? 0),
    };
}
