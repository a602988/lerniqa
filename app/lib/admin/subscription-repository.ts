import type { QueryResultRow } from "pg";

import type { AdminQueryRunner } from "./admin-auth.ts";
import {
    AdminApiError,
    type SubscriptionBillingInterval,
    type SubscriptionFeatureStatus,
    type SubscriptionFeatureValueType,
    type SubscriptionPlanListQuery,
    type SubscriptionPlanStatus,
    type SubscriptionPriceStatus,
} from "./admin-types.ts";

export interface AdminSubscriptionPrice {
    id: string;
    planId: string;
    currency: string;
    amountMinor: number;
    billingInterval: SubscriptionBillingInterval;
    billingIntervalCount: number;
    status: SubscriptionPriceStatus;
    effectiveFrom: string | null;
    effectiveUntil: string | null;
    lockVersion: number;
    createdAt: string;
    updatedAt: string;
}

export interface AdminSubscriptionFeatureDefinition {
    id: string;
    featureKey: string;
    displayName: string;
    description: string | null;
    valueType: SubscriptionFeatureValueType;
    unit: string | null;
    status: SubscriptionFeatureStatus;
    lockVersion: number;
    createdAt: string;
    updatedAt: string;
}

export interface AdminSubscriptionFeatureLimit {
    id: string;
    planId: string;
    featureDefinitionId: string;
    featureKey: string;
    displayName: string;
    valueType: SubscriptionFeatureValueType;
    unit: string | null;
    featureStatus: SubscriptionFeatureStatus;
    included: boolean;
    unlimited: boolean;
    limit: number | null;
    lockVersion: number;
    updatedAt: string;
}

export interface AdminSubscriptionPlan {
    id: string;
    code: string;
    name: string;
    description: string | null;
    status: SubscriptionPlanStatus;
    lockVersion: number;
    createdAt: string;
    updatedAt: string;
    prices: AdminSubscriptionPrice[];
    featureLimits: AdminSubscriptionFeatureLimit[];
}

export interface AdminSubscriptionPlanPage {
    items: AdminSubscriptionPlan[];
    page: number;
    pageSize: number;
    total: number;
}

interface PlanListRow extends QueryResultRow {
    id: string | null;
    code: string | null;
    name: string | null;
    description: string | null;
    status: string | null;
    lock_version: number | string | null;
    created_at: string | Date | null;
    updated_at: string | Date | null;
    prices: unknown;
    feature_limits: unknown;
    total_count: number | string;
}

interface PlanRow extends QueryResultRow {
    id: string;
    code: string;
    name: string;
    description: string | null;
    status: string;
    lock_version: number | string;
    created_at: string | Date;
    updated_at: string | Date;
}

interface PriceRow extends QueryResultRow {
    id: string;
    plan_id: string;
    currency: string;
    amount_minor: number | string;
    billing_interval: string;
    billing_interval_count: number | string;
    status: string;
    effective_from: string | Date | null;
    effective_until: string | Date | null;
    lock_version: number | string;
    created_at: string | Date;
    updated_at: string | Date;
}

interface FeatureDefinitionRow extends QueryResultRow {
    id: string;
    feature_key: string;
    display_name: string;
    description: string | null;
    value_type: string;
    unit: string | null;
    status: string;
    lock_version: number | string;
    created_at: string | Date;
    updated_at: string | Date;
}

interface FeatureLimitRow extends QueryResultRow {
    id: string;
    plan_id: string;
    feature_definition_id: string;
    feature_key: string;
    display_name: string;
    value_type: string;
    unit: string | null;
    feature_status: string;
    included: boolean;
    unlimited: boolean;
    limit_value: number | string | null;
    lock_version: number | string;
    updated_at: string | Date;
}

const PLAN_ORDER_SQL = {
    code: "page_row.code",
    name: "page_row.name",
    status: "page_row.status",
    updatedAt: "page_row.updated_at",
    id: "page_row.id",
} as const;

function positiveInteger(value: number | string, label: string): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new AdminApiError("INTERNAL_ERROR", `${label}資料格式不正確。`, 500);
    }
    return parsed;
}

function nonNegativeInteger(value: number | string, label: string): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new AdminApiError("INTERNAL_ERROR", `${label}資料格式不正確。`, 500);
    }
    return parsed;
}

function isoDateTime(value: string | Date, label: string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new AdminApiError("INTERNAL_ERROR", `${label}資料格式不正確。`, 500);
    }
    return date.toISOString();
}

function dateOnly(value: string | Date | null): string | null {
    if (value === null) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const match = /^\d{4}-\d{2}-\d{2}/u.exec(value);
    if (!match) throw new AdminApiError("INTERNAL_ERROR", "價格日期資料格式不正確。", 500);
    return match[0];
}

function planStatus(value: string): SubscriptionPlanStatus {
    if (value !== "draft" && value !== "active" && value !== "retired") {
        throw new AdminApiError("INTERNAL_ERROR", "方案狀態資料格式不正確。", 500);
    }
    return value;
}

function priceStatus(value: string): SubscriptionPriceStatus {
    if (value !== "draft" && value !== "active" && value !== "retired") {
        throw new AdminApiError("INTERNAL_ERROR", "價格狀態資料格式不正確。", 500);
    }
    return value;
}

function featureStatus(value: string): SubscriptionFeatureStatus {
    if (value !== "draft" && value !== "active" && value !== "retired") {
        throw new AdminApiError("INTERNAL_ERROR", "功能狀態資料格式不正確。", 500);
    }
    return value;
}

function billingInterval(value: string): SubscriptionBillingInterval {
    if (value !== "day" && value !== "week" && value !== "month" && value !== "year") {
        throw new AdminApiError("INTERNAL_ERROR", "價格週期資料格式不正確。", 500);
    }
    return value;
}

function featureValueType(value: string): SubscriptionFeatureValueType {
    if (value !== "boolean" && value !== "integer") {
        throw new AdminApiError("INTERNAL_ERROR", "功能值類型資料格式不正確。", 500);
    }
    return value;
}

function parsePrice(value: unknown): AdminSubscriptionPrice {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new AdminApiError("INTERNAL_ERROR", "價格資料格式不正確。", 500);
    }
    const row = value as Record<string, unknown>;
    if (
        typeof row.id !== "string"
        || typeof row.planId !== "string"
        || typeof row.currency !== "string"
        || typeof row.billingInterval !== "string"
        || typeof row.status !== "string"
        || typeof row.createdAt !== "string"
        || typeof row.updatedAt !== "string"
    ) {
        throw new AdminApiError("INTERNAL_ERROR", "價格資料格式不正確。", 500);
    }
    return {
        id: row.id,
        planId: row.planId,
        currency: row.currency,
        amountMinor: nonNegativeInteger(row.amountMinor as number | string, "價格金額"),
        billingInterval: billingInterval(row.billingInterval),
        billingIntervalCount: positiveInteger(
            row.billingIntervalCount as number | string,
            "價格週期數",
        ),
        status: priceStatus(row.status),
        effectiveFrom: dateOnly((row.effectiveFrom ?? null) as string | Date | null),
        effectiveUntil: dateOnly((row.effectiveUntil ?? null) as string | Date | null),
        lockVersion: positiveInteger(row.lockVersion as number | string, "價格版本"),
        createdAt: isoDateTime(row.createdAt, "價格建立時間"),
        updatedAt: isoDateTime(row.updatedAt, "價格更新時間"),
    };
}

function parseFeatureLimit(value: unknown): AdminSubscriptionFeatureLimit {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new AdminApiError("INTERNAL_ERROR", "功能限制資料格式不正確。", 500);
    }
    const row = value as Record<string, unknown>;
    if (
        typeof row.id !== "string"
        || typeof row.planId !== "string"
        || typeof row.featureDefinitionId !== "string"
        || typeof row.featureKey !== "string"
        || typeof row.displayName !== "string"
        || typeof row.valueType !== "string"
        || typeof row.featureStatus !== "string"
        || typeof row.included !== "boolean"
        || typeof row.unlimited !== "boolean"
        || typeof row.updatedAt !== "string"
    ) {
        throw new AdminApiError("INTERNAL_ERROR", "功能限制資料格式不正確。", 500);
    }
    return {
        id: row.id,
        planId: row.planId,
        featureDefinitionId: row.featureDefinitionId,
        featureKey: row.featureKey,
        displayName: row.displayName,
        valueType: featureValueType(row.valueType),
        unit: typeof row.unit === "string" ? row.unit : null,
        featureStatus: featureStatus(row.featureStatus),
        included: row.included,
        unlimited: row.unlimited,
        limit: row.limit === null || row.limit === undefined
            ? null
            : nonNegativeInteger(row.limit as number | string, "功能上限"),
        lockVersion: positiveInteger(row.lockVersion as number | string, "功能限制版本"),
        updatedAt: isoDateTime(row.updatedAt, "功能限制更新時間"),
    };
}

function parseJsonArray<T>(
    value: unknown,
    parser: (entry: unknown) => T,
    label: string,
): T[] {
    if (!Array.isArray(value)) {
        throw new AdminApiError("INTERNAL_ERROR", `${label}資料格式不正確。`, 500);
    }
    return value.map(parser);
}

function planFromListRow(row: PlanListRow): AdminSubscriptionPlan | null {
    if (row.id === null) return null;
    if (
        row.code === null
        || row.name === null
        || row.status === null
        || row.lock_version === null
        || row.created_at === null
        || row.updated_at === null
    ) {
        throw new AdminApiError("INTERNAL_ERROR", "方案資料格式不正確。", 500);
    }
    return {
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        status: planStatus(row.status),
        lockVersion: positiveInteger(row.lock_version, "方案版本"),
        createdAt: isoDateTime(row.created_at, "方案建立時間"),
        updatedAt: isoDateTime(row.updated_at, "方案更新時間"),
        prices: parseJsonArray(row.prices, parsePrice, "價格"),
        featureLimits: parseJsonArray(row.feature_limits, parseFeatureLimit, "功能限制"),
    };
}

function planFromRow(
    row: PlanRow,
    prices: AdminSubscriptionPrice[],
    featureLimits: AdminSubscriptionFeatureLimit[],
): AdminSubscriptionPlan {
    return {
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        status: planStatus(row.status),
        lockVersion: positiveInteger(row.lock_version, "方案版本"),
        createdAt: isoDateTime(row.created_at, "方案建立時間"),
        updatedAt: isoDateTime(row.updated_at, "方案更新時間"),
        prices,
        featureLimits,
    };
}

function orderSql(query: SubscriptionPlanListQuery): string {
    return query.orderBy.map((sort) => {
        const field = PLAN_ORDER_SQL[sort.field];
        const direction = sort.direction === "asc" ? "ASC" : "DESC";
        return `${field} ${direction}`;
    }).join(", ");
}

export async function listSubscriptionPlans(
    runner: AdminQueryRunner,
    query: SubscriptionPlanListQuery,
): Promise<AdminSubscriptionPlanPage> {
    const result = await runner.query<PlanListRow>(`
        WITH filtered AS (
            SELECT
                plan.id,
                plan.code,
                plan.name,
                plan.description,
                plan.status,
                plan.lock_version,
                plan.created_at,
                plan.updated_at
            FROM subscription_plans AS plan
            WHERE (
                $1::text IS NULL
                OR plan.code ILIKE '%' || $1::text || '%'
                OR plan.name ILIKE '%' || $1::text || '%'
            )
                AND (
                    cardinality($2::text[]) = 0
                    OR plan.status = ANY($2::text[])
                )
        ),
        total AS (
            SELECT count(*)::bigint AS total_count
            FROM filtered
        ),
        page AS (
            SELECT page_row.*
            FROM filtered AS page_row
            ORDER BY ${orderSql(query)}
            LIMIT $3::integer OFFSET $4::integer
        )
        SELECT
            page_row.id,
            page_row.code,
            page_row.name,
            page_row.description,
            page_row.status,
            page_row.lock_version,
            page_row.created_at,
            page_row.updated_at,
            coalesce(price_rows.items, '[]'::jsonb) AS prices,
            coalesce(limit_rows.items, '[]'::jsonb) AS feature_limits,
            total.total_count
        FROM total
        LEFT JOIN page AS page_row ON true
        LEFT JOIN LATERAL (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', price.id,
                    'planId', price.plan_id,
                    'currency', price.currency,
                    'amountMinor', price.amount_minor,
                    'billingInterval', price.billing_interval,
                    'billingIntervalCount', price.billing_interval_count,
                    'status', price.status,
                    'effectiveFrom', price.effective_from,
                    'effectiveUntil', price.effective_until,
                    'lockVersion', price.lock_version,
                    'createdAt', price.created_at,
                    'updatedAt', price.updated_at
                )
                ORDER BY price.created_at DESC, price.id DESC
            ) AS items
            FROM subscription_plan_prices AS price
            WHERE price.plan_id = page_row.id
        ) AS price_rows ON page_row.id IS NOT NULL
        LEFT JOIN LATERAL (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', feature_limit.id,
                    'planId', feature_limit.plan_id,
                    'featureDefinitionId', definition.id,
                    'featureKey', definition.feature_key,
                    'displayName', definition.display_name,
                    'valueType', definition.value_type,
                    'unit', definition.unit,
                    'featureStatus', definition.status,
                    'included', feature_limit.included,
                    'unlimited', feature_limit.unlimited,
                    'limit', feature_limit.limit_value,
                    'lockVersion', feature_limit.lock_version,
                    'updatedAt', feature_limit.updated_at
                )
                ORDER BY definition.feature_key, definition.id
            ) AS items
            FROM subscription_plan_feature_limits AS feature_limit
            JOIN subscription_feature_definitions AS definition
                ON definition.id = feature_limit.feature_definition_id
            WHERE feature_limit.plan_id = page_row.id
        ) AS limit_rows ON page_row.id IS NOT NULL
        ORDER BY ${orderSql(query)}
    `, [
        query.search ?? null,
        query.statuses,
        query.limit,
        query.offset,
    ]);

    const total = nonNegativeInteger(result.rows[0]?.total_count ?? 0, "方案總數");
    return {
        items: result.rows.map(planFromListRow).filter((plan): plan is AdminSubscriptionPlan => plan !== null),
        page: query.page,
        pageSize: query.pageSize,
        total,
    };
}

function priceFromRow(row: PriceRow): AdminSubscriptionPrice {
    return {
        id: row.id,
        planId: row.plan_id,
        currency: row.currency,
        amountMinor: nonNegativeInteger(row.amount_minor, "價格金額"),
        billingInterval: billingInterval(row.billing_interval),
        billingIntervalCount: positiveInteger(row.billing_interval_count, "價格週期數"),
        status: priceStatus(row.status),
        effectiveFrom: dateOnly(row.effective_from),
        effectiveUntil: dateOnly(row.effective_until),
        lockVersion: positiveInteger(row.lock_version, "價格版本"),
        createdAt: isoDateTime(row.created_at, "價格建立時間"),
        updatedAt: isoDateTime(row.updated_at, "價格更新時間"),
    };
}

function limitFromRow(row: FeatureLimitRow): AdminSubscriptionFeatureLimit {
    return {
        id: row.id,
        planId: row.plan_id,
        featureDefinitionId: row.feature_definition_id,
        featureKey: row.feature_key,
        displayName: row.display_name,
        valueType: featureValueType(row.value_type),
        unit: row.unit,
        featureStatus: featureStatus(row.feature_status),
        included: row.included,
        unlimited: row.unlimited,
        limit: row.limit_value === null
            ? null
            : nonNegativeInteger(row.limit_value, "功能上限"),
        lockVersion: positiveInteger(row.lock_version, "功能限制版本"),
        updatedAt: isoDateTime(row.updated_at, "功能限制更新時間"),
    };
}

export async function getSubscriptionPlan(
    runner: AdminQueryRunner,
    planId: string,
): Promise<AdminSubscriptionPlan> {
    const planResult = await runner.query<PlanRow>(`
        SELECT
            id,
            code,
            name,
            description,
            status,
            lock_version,
            created_at,
            updated_at
        FROM subscription_plans
        WHERE id = $1::uuid
    `, [planId]);
    const plan = planResult.rows[0];
    if (!plan) throw new AdminApiError("NOT_FOUND", "找不到指定的訂閱方案。", 404);

    const [priceResult, limitResult] = await Promise.all([
        runner.query<PriceRow>(`
            SELECT
                id,
                plan_id,
                currency,
                amount_minor,
                billing_interval,
                billing_interval_count,
                status,
                effective_from,
                effective_until,
                lock_version,
                created_at,
                updated_at
            FROM subscription_plan_prices
            WHERE plan_id = $1::uuid
            ORDER BY created_at DESC, id DESC
        `, [planId]),
        runner.query<FeatureLimitRow>(`
            SELECT
                feature_limit.id,
                feature_limit.plan_id,
                feature_limit.feature_definition_id,
                definition.feature_key,
                definition.display_name,
                definition.value_type,
                definition.unit,
                definition.status AS feature_status,
                feature_limit.included,
                feature_limit.unlimited,
                feature_limit.limit_value,
                feature_limit.lock_version,
                feature_limit.updated_at
            FROM subscription_plan_feature_limits AS feature_limit
            JOIN subscription_feature_definitions AS definition
                ON definition.id = feature_limit.feature_definition_id
            WHERE feature_limit.plan_id = $1::uuid
            ORDER BY definition.feature_key, definition.id
        `, [planId]),
    ]);
    return planFromRow(
        plan,
        priceResult.rows.map(priceFromRow),
        limitResult.rows.map(limitFromRow),
    );
}

export async function listSubscriptionFeatureDefinitions(
    runner: AdminQueryRunner,
): Promise<AdminSubscriptionFeatureDefinition[]> {
    const result = await runner.query<FeatureDefinitionRow>(`
        SELECT
            id,
            feature_key,
            display_name,
            description,
            value_type,
            unit,
            status,
            lock_version,
            created_at,
            updated_at
        FROM subscription_feature_definitions
        ORDER BY feature_key, id
    `);
    return result.rows.map((row) => ({
        id: row.id,
        featureKey: row.feature_key,
        displayName: row.display_name,
        description: row.description,
        valueType: featureValueType(row.value_type),
        unit: row.unit,
        status: featureStatus(row.status),
        lockVersion: positiveInteger(row.lock_version, "功能定義版本"),
        createdAt: isoDateTime(row.created_at, "功能定義建立時間"),
        updatedAt: isoDateTime(row.updated_at, "功能定義更新時間"),
    }));
}
