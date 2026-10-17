import type { QueryResultRow } from "pg";

import type { AdminQueryRunner } from "./admin-auth.ts";
import {
    AdminApiError,
    type SubscriptionFeatureStatus,
    type SubscriptionFeatureValueType,
    type SubscriptionPlanStatus,
    type SubscriptionPriceStatus,
} from "./admin-types.ts";

export type SubscriptionAuditAction =
    | "subscription_plan_created"
    | "subscription_plan_updated"
    | "subscription_plan_activated"
    | "subscription_plan_retired"
    | "subscription_price_created"
    | "subscription_price_updated"
    | "subscription_price_activated"
    | "subscription_price_retired"
    | "subscription_feature_definition_created"
    | "subscription_feature_definition_updated"
    | "subscription_feature_definition_activated"
    | "subscription_feature_definition_retired"
    | "subscription_feature_limit_set"
    | "subscription_feature_limit_updated";

export type SubscriptionAuditTargetType =
    | "subscription_plan"
    | "subscription_plan_price"
    | "subscription_feature_definition"
    | "subscription_plan_feature_limit";

export interface LockedSubscriptionPlan {
    id: string;
    code: string;
    name: string;
    description: string | null;
    status: SubscriptionPlanStatus;
    lockVersion: number;
}

export interface LockedSubscriptionPrice {
    id: string;
    planId: string;
    currency: string;
    amountMinor: number;
    billingInterval: "day" | "week" | "month" | "year";
    billingIntervalCount: number;
    status: SubscriptionPriceStatus;
    effectiveFrom: string | null;
    effectiveUntil: string | null;
    lockVersion: number;
}

export interface LockedSubscriptionFeatureDefinition {
    id: string;
    featureKey: string;
    displayName: string;
    description: string | null;
    valueType: SubscriptionFeatureValueType;
    unit: string | null;
    status: SubscriptionFeatureStatus;
    lockVersion: number;
}

export interface LockedSubscriptionFeatureLimit {
    id: string;
    planId: string;
    featureDefinitionId: string;
    included: boolean;
    unlimited: boolean;
    limit: number | null;
    lockVersion: number;
}

interface PlanRow extends QueryResultRow {
    id: string;
    code: string;
    name: string;
    description: string | null;
    status: SubscriptionPlanStatus;
    lock_version: number | string;
}

interface PriceRow extends QueryResultRow {
    id: string;
    plan_id: string;
    currency: string;
    amount_minor: number | string;
    billing_interval: LockedSubscriptionPrice["billingInterval"];
    billing_interval_count: number | string;
    status: SubscriptionPriceStatus;
    effective_from: string | Date | null;
    effective_until: string | Date | null;
    lock_version: number | string;
}

interface FeatureDefinitionRow extends QueryResultRow {
    id: string;
    feature_key: string;
    display_name: string;
    description: string | null;
    value_type: SubscriptionFeatureValueType;
    unit: string | null;
    status: SubscriptionFeatureStatus;
    lock_version: number | string;
}

interface FeatureLimitRow extends QueryResultRow {
    id: string;
    plan_id: string;
    feature_definition_id: string;
    included: boolean;
    unlimited: boolean;
    limit_value: number | string | null;
    lock_version: number | string;
}

interface ReturnedIdRow extends QueryResultRow {
    id: string;
}

interface CountRow extends QueryResultRow {
    item_count: number | string;
}

function integer(value: number | string, minimum: number, label: string): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum) {
        throw new AdminApiError("INTERNAL_ERROR", `${label}資料格式不正確。`, 500);
    }
    return parsed;
}

function dateOnly(value: string | Date | null): string | null {
    if (value === null) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const match = /^\d{4}-\d{2}-\d{2}/u.exec(value);
    if (!match) throw new AdminApiError("INTERNAL_ERROR", "價格日期資料格式不正確。", 500);
    return match[0];
}

function expectReturnedId(
    result: { rows: ReturnedIdRow[] },
    message: string,
): string {
    const id = result.rows[0]?.id;
    if (!id) throw new AdminApiError("STALE_VERSION", message, 409);
    return id;
}

export async function acquireSubscriptionCatalogKeyLock(
    runner: AdminQueryRunner,
    domain: "plan" | "feature",
    key: string,
): Promise<void> {
    await runner.query(`
        SELECT pg_advisory_xact_lock(
            hashtextextended('lerniqa-admin-subscription:' || $1::text || ':' || $2::text, 0)
        )
    `, [domain, key]);
}

export async function lockSubscriptionPlan(
    runner: AdminQueryRunner,
    planId: string,
): Promise<LockedSubscriptionPlan> {
    const result = await runner.query<PlanRow>(`
        SELECT id, code, name, description, status, lock_version
        FROM subscription_plans
        WHERE id = $1::uuid
        FOR UPDATE
    `, [planId]);
    const row = result.rows[0];
    if (!row) throw new AdminApiError("NOT_FOUND", "找不到指定的訂閱方案。", 404);
    return {
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        status: row.status,
        lockVersion: integer(row.lock_version, 1, "方案版本"),
    };
}

export async function lockSubscriptionPrice(
    runner: AdminQueryRunner,
    planId: string,
    priceId: string,
): Promise<LockedSubscriptionPrice> {
    const result = await runner.query<PriceRow>(`
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
            lock_version
        FROM subscription_plan_prices
        WHERE id = $1::uuid
            AND plan_id = $2::uuid
        FOR UPDATE
    `, [priceId, planId]);
    const row = result.rows[0];
    if (!row) throw new AdminApiError("NOT_FOUND", "找不到指定的方案價格。", 404);
    return {
        id: row.id,
        planId: row.plan_id,
        currency: row.currency,
        amountMinor: integer(row.amount_minor, 0, "價格金額"),
        billingInterval: row.billing_interval,
        billingIntervalCount: integer(row.billing_interval_count, 1, "價格週期數"),
        status: row.status,
        effectiveFrom: dateOnly(row.effective_from),
        effectiveUntil: dateOnly(row.effective_until),
        lockVersion: integer(row.lock_version, 1, "價格版本"),
    };
}

export async function lockSubscriptionFeatureDefinition(
    runner: AdminQueryRunner,
    featureDefinitionId: string,
): Promise<LockedSubscriptionFeatureDefinition> {
    const result = await runner.query<FeatureDefinitionRow>(`
        SELECT
            id,
            feature_key,
            display_name,
            description,
            value_type,
            unit,
            status,
            lock_version
        FROM subscription_feature_definitions
        WHERE id = $1::uuid
        FOR UPDATE
    `, [featureDefinitionId]);
    const row = result.rows[0];
    if (!row) throw new AdminApiError("NOT_FOUND", "找不到指定的功能定義。", 404);
    return {
        id: row.id,
        featureKey: row.feature_key,
        displayName: row.display_name,
        description: row.description,
        valueType: row.value_type,
        unit: row.unit,
        status: row.status,
        lockVersion: integer(row.lock_version, 1, "功能定義版本"),
    };
}

export async function lockSubscriptionFeatureLimit(
    runner: AdminQueryRunner,
    planId: string,
    featureDefinitionId: string,
): Promise<LockedSubscriptionFeatureLimit | null> {
    const result = await runner.query<FeatureLimitRow>(`
        SELECT
            id,
            plan_id,
            feature_definition_id,
            included,
            unlimited,
            limit_value,
            lock_version
        FROM subscription_plan_feature_limits
        WHERE plan_id = $1::uuid
            AND feature_definition_id = $2::uuid
        FOR UPDATE
    `, [planId, featureDefinitionId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
        id: row.id,
        planId: row.plan_id,
        featureDefinitionId: row.feature_definition_id,
        included: row.included,
        unlimited: row.unlimited,
        limit: row.limit_value === null ? null : integer(row.limit_value, 0, "功能上限"),
        lockVersion: integer(row.lock_version, 1, "功能限制版本"),
    };
}

export async function countNonRetiredSubscriptionPrices(
    runner: AdminQueryRunner,
    planId: string,
): Promise<number> {
    const result = await runner.query<CountRow>(`
        SELECT count(*)::integer AS item_count
        FROM subscription_plan_prices
        WHERE plan_id = $1::uuid
            AND status <> 'retired'
    `, [planId]);
    return integer(result.rows[0]?.item_count ?? 0, 0, "未停用價格數");
}

export async function countInactiveIncludedFeaturesForPlan(
    runner: AdminQueryRunner,
    planId: string,
): Promise<number> {
    const result = await runner.query<CountRow>(`
        SELECT count(*)::integer AS item_count
        FROM subscription_plan_feature_limits AS feature_limit
        JOIN subscription_feature_definitions AS feature
            ON feature.id = feature_limit.feature_definition_id
        WHERE feature_limit.plan_id = $1::uuid
            AND feature_limit.included
            AND feature.status <> 'active'
    `, [planId]);
    return integer(result.rows[0]?.item_count ?? 0, 0, "未啟用功能數");
}

export async function countIncludedNonRetiredPlansForFeature(
    runner: AdminQueryRunner,
    featureDefinitionId: string,
): Promise<number> {
    const result = await runner.query<CountRow>(`
        SELECT count(*)::integer AS item_count
        FROM subscription_plan_feature_limits AS feature_limit
        JOIN subscription_plans AS plan ON plan.id = feature_limit.plan_id
        WHERE feature_limit.feature_definition_id = $1::uuid
            AND feature_limit.included
            AND plan.status <> 'retired'
    `, [featureDefinitionId]);
    return integer(result.rows[0]?.item_count ?? 0, 0, "仍使用功能的方案數");
}

export async function insertSubscriptionPlan(
    runner: AdminQueryRunner,
    input: Readonly<{
        id: string;
        actorUserId: string;
        code: string;
        name: string;
        description: string | null;
    }>,
): Promise<void> {
    const result = await runner.query<ReturnedIdRow>(`
        INSERT INTO subscription_plans (
            id, code, name, description, status,
            created_by_user_id, updated_by_user_id,
            lock_version, created_at, updated_at
        )
        VALUES (
            $1::uuid, $2::varchar, $3::varchar, $4::text, 'draft',
            $5::uuid, $5::uuid,
            1, transaction_timestamp(), transaction_timestamp()
        )
        RETURNING id
    `, [input.id, input.code, input.name, input.description, input.actorUserId]);
    expectReturnedId(result, "方案未建立，請重新提交。");
}

export async function updateSubscriptionPlanMetadata(
    runner: AdminQueryRunner,
    input: Readonly<{
        planId: string;
        actorUserId: string;
        expectedLockVersion: number;
        name: string;
        description: string | null;
    }>,
): Promise<number> {
    const result = await runner.query<PlanRow>(`
        UPDATE subscription_plans
        SET
            name = $3::varchar,
            description = $4::text,
            updated_by_user_id = $5::uuid,
            lock_version = lock_version + 1,
            updated_at = transaction_timestamp()
        WHERE id = $1::uuid
            AND lock_version = $2::integer
        RETURNING id, code, name, description, status, lock_version
    `, [
        input.planId,
        input.expectedLockVersion,
        input.name,
        input.description,
        input.actorUserId,
    ]);
    const row = result.rows[0];
    if (!row) throw new AdminApiError("STALE_VERSION", "方案已被其他操作更新。", 409);
    return integer(row.lock_version, 1, "方案版本");
}

export async function transitionSubscriptionPlan(
    runner: AdminQueryRunner,
    input: Readonly<{
        planId: string;
        actorUserId: string;
        expectedLockVersion: number;
        targetStatus: Exclude<SubscriptionPlanStatus, "draft">;
    }>,
): Promise<number> {
    const result = await runner.query<PlanRow>(`
        UPDATE subscription_plans
        SET
            status = $3::varchar,
            updated_by_user_id = $4::uuid,
            lock_version = lock_version + 1,
            updated_at = transaction_timestamp()
        WHERE id = $1::uuid
            AND lock_version = $2::integer
        RETURNING id, code, name, description, status, lock_version
    `, [input.planId, input.expectedLockVersion, input.targetStatus, input.actorUserId]);
    const row = result.rows[0];
    if (!row) throw new AdminApiError("STALE_VERSION", "方案已被其他操作更新。", 409);
    return integer(row.lock_version, 1, "方案版本");
}

export async function insertSubscriptionPrice(
    runner: AdminQueryRunner,
    input: Readonly<{
        id: string;
        actorUserId: string;
        planId: string;
        currency: string;
        amountMinor: number;
        billingInterval: string;
        billingIntervalCount: number;
        effectiveFrom: string | null;
        effectiveUntil: string | null;
    }>,
): Promise<void> {
    const result = await runner.query<ReturnedIdRow>(`
        INSERT INTO subscription_plan_prices (
            id, plan_id, currency, amount_minor,
            billing_interval, billing_interval_count,
            status, effective_from, effective_until,
            created_by_user_id, updated_by_user_id,
            lock_version, created_at, updated_at
        )
        VALUES (
            $1::uuid, $2::uuid, $3::char(3), $4::bigint,
            $5::varchar, $6::integer,
            'draft', $7::date, $8::date,
            $9::uuid, $9::uuid,
            1, transaction_timestamp(), transaction_timestamp()
        )
        RETURNING id
    `, [
        input.id,
        input.planId,
        input.currency,
        input.amountMinor,
        input.billingInterval,
        input.billingIntervalCount,
        input.effectiveFrom,
        input.effectiveUntil,
        input.actorUserId,
    ]);
    expectReturnedId(result, "價格未建立，請重新提交。");
}

export async function updateSubscriptionPriceTerms(
    runner: AdminQueryRunner,
    input: Readonly<{
        priceId: string;
        planId: string;
        actorUserId: string;
        expectedLockVersion: number;
        currency: string;
        amountMinor: number;
        billingInterval: string;
        billingIntervalCount: number;
        effectiveFrom: string | null;
        effectiveUntil: string | null;
    }>,
): Promise<number> {
    const result = await runner.query<PriceRow>(`
        UPDATE subscription_plan_prices
        SET
            currency = $4::char(3),
            amount_minor = $5::bigint,
            billing_interval = $6::varchar,
            billing_interval_count = $7::integer,
            effective_from = $8::date,
            effective_until = $9::date,
            updated_by_user_id = $10::uuid,
            lock_version = lock_version + 1,
            updated_at = transaction_timestamp()
        WHERE id = $1::uuid
            AND plan_id = $2::uuid
            AND lock_version = $3::integer
            AND status <> 'retired'
        RETURNING
            id, plan_id, currency, amount_minor,
            billing_interval, billing_interval_count, status,
            effective_from, effective_until, lock_version
    `, [
        input.priceId,
        input.planId,
        input.expectedLockVersion,
        input.currency,
        input.amountMinor,
        input.billingInterval,
        input.billingIntervalCount,
        input.effectiveFrom,
        input.effectiveUntil,
        input.actorUserId,
    ]);
    const row = result.rows[0];
    if (!row) throw new AdminApiError("STALE_VERSION", "價格已被其他操作更新。", 409);
    return integer(row.lock_version, 1, "價格版本");
}

export async function transitionSubscriptionPrice(
    runner: AdminQueryRunner,
    input: Readonly<{
        priceId: string;
        planId: string;
        actorUserId: string;
        expectedLockVersion: number;
        targetStatus: Exclude<SubscriptionPriceStatus, "draft">;
    }>,
): Promise<number> {
    const result = await runner.query<PriceRow>(`
        UPDATE subscription_plan_prices
        SET
            status = $4::varchar,
            updated_by_user_id = $5::uuid,
            lock_version = lock_version + 1,
            updated_at = transaction_timestamp()
        WHERE id = $1::uuid
            AND plan_id = $2::uuid
            AND lock_version = $3::integer
        RETURNING
            id, plan_id, currency, amount_minor,
            billing_interval, billing_interval_count, status,
            effective_from, effective_until, lock_version
    `, [
        input.priceId,
        input.planId,
        input.expectedLockVersion,
        input.targetStatus,
        input.actorUserId,
    ]);
    const row = result.rows[0];
    if (!row) throw new AdminApiError("STALE_VERSION", "價格已被其他操作更新。", 409);
    return integer(row.lock_version, 1, "價格版本");
}

export async function insertSubscriptionFeatureDefinition(
    runner: AdminQueryRunner,
    input: Readonly<{
        id: string;
        actorUserId: string;
        featureKey: string;
        displayName: string;
        description: string | null;
        valueType: SubscriptionFeatureValueType;
        unit: string | null;
    }>,
): Promise<void> {
    const result = await runner.query<ReturnedIdRow>(`
        INSERT INTO subscription_feature_definitions (
            id, feature_key, display_name, description, value_type, unit, status,
            created_by_user_id, updated_by_user_id,
            lock_version, created_at, updated_at
        )
        VALUES (
            $1::uuid, $2::varchar, $3::varchar, $4::text, $5::varchar, $6::varchar, 'draft',
            $7::uuid, $7::uuid,
            1, transaction_timestamp(), transaction_timestamp()
        )
        RETURNING id
    `, [
        input.id,
        input.featureKey,
        input.displayName,
        input.description,
        input.valueType,
        input.unit,
        input.actorUserId,
    ]);
    expectReturnedId(result, "功能定義未建立，請重新提交。");
}

export async function updateSubscriptionFeatureDefinitionMetadata(
    runner: AdminQueryRunner,
    input: Readonly<{
        featureDefinitionId: string;
        actorUserId: string;
        expectedLockVersion: number;
        displayName: string;
        description: string | null;
        valueType: SubscriptionFeatureValueType;
        unit: string | null;
    }>,
): Promise<number> {
    const result = await runner.query<FeatureDefinitionRow>(`
        UPDATE subscription_feature_definitions
        SET
            display_name = $3::varchar,
            description = $4::text,
            value_type = $5::varchar,
            unit = $6::varchar,
            updated_by_user_id = $7::uuid,
            lock_version = lock_version + 1,
            updated_at = transaction_timestamp()
        WHERE id = $1::uuid
            AND lock_version = $2::integer
            AND status <> 'retired'
        RETURNING
            id, feature_key, display_name, description,
            value_type, unit, status, lock_version
    `, [
        input.featureDefinitionId,
        input.expectedLockVersion,
        input.displayName,
        input.description,
        input.valueType,
        input.unit,
        input.actorUserId,
    ]);
    const row = result.rows[0];
    if (!row) throw new AdminApiError("STALE_VERSION", "功能定義已被其他操作更新。", 409);
    return integer(row.lock_version, 1, "功能定義版本");
}

export async function transitionSubscriptionFeatureDefinition(
    runner: AdminQueryRunner,
    input: Readonly<{
        featureDefinitionId: string;
        actorUserId: string;
        expectedLockVersion: number;
        targetStatus: Exclude<SubscriptionFeatureStatus, "draft">;
    }>,
): Promise<number> {
    const result = await runner.query<FeatureDefinitionRow>(`
        UPDATE subscription_feature_definitions
        SET
            status = $3::varchar,
            updated_by_user_id = $4::uuid,
            lock_version = lock_version + 1,
            updated_at = transaction_timestamp()
        WHERE id = $1::uuid
            AND lock_version = $2::integer
        RETURNING
            id, feature_key, display_name, description,
            value_type, unit, status, lock_version
    `, [
        input.featureDefinitionId,
        input.expectedLockVersion,
        input.targetStatus,
        input.actorUserId,
    ]);
    const row = result.rows[0];
    if (!row) throw new AdminApiError("STALE_VERSION", "功能定義已被其他操作更新。", 409);
    return integer(row.lock_version, 1, "功能定義版本");
}

export async function insertSubscriptionFeatureLimit(
    runner: AdminQueryRunner,
    input: Readonly<{
        id: string;
        actorUserId: string;
        planId: string;
        featureDefinitionId: string;
        included: boolean;
        unlimited: boolean;
        limit: number | null;
    }>,
): Promise<void> {
    const result = await runner.query<ReturnedIdRow>(`
        INSERT INTO subscription_plan_feature_limits (
            id, plan_id, feature_definition_id,
            included, unlimited, limit_value,
            created_by_user_id, updated_by_user_id,
            lock_version, created_at, updated_at
        )
        VALUES (
            $1::uuid, $2::uuid, $3::uuid,
            $4::boolean, $5::boolean, $6::bigint,
            $7::uuid, $7::uuid,
            1, transaction_timestamp(), transaction_timestamp()
        )
        RETURNING id
    `, [
        input.id,
        input.planId,
        input.featureDefinitionId,
        input.included,
        input.unlimited,
        input.limit,
        input.actorUserId,
    ]);
    expectReturnedId(result, "功能限制未建立，請重新提交。");
}

export async function updateSubscriptionFeatureLimit(
    runner: AdminQueryRunner,
    input: Readonly<{
        id: string;
        actorUserId: string;
        expectedLockVersion: number;
        included: boolean;
        unlimited: boolean;
        limit: number | null;
    }>,
): Promise<number> {
    const result = await runner.query<FeatureLimitRow>(`
        UPDATE subscription_plan_feature_limits
        SET
            included = $3::boolean,
            unlimited = $4::boolean,
            limit_value = $5::bigint,
            updated_by_user_id = $6::uuid,
            lock_version = lock_version + 1,
            updated_at = transaction_timestamp()
        WHERE id = $1::uuid
            AND lock_version = $2::integer
        RETURNING
            id, plan_id, feature_definition_id,
            included, unlimited, limit_value, lock_version
    `, [
        input.id,
        input.expectedLockVersion,
        input.included,
        input.unlimited,
        input.limit,
        input.actorUserId,
    ]);
    const row = result.rows[0];
    if (!row) throw new AdminApiError("STALE_VERSION", "功能限制已被其他操作更新。", 409);
    return integer(row.lock_version, 1, "功能限制版本");
}

export async function insertSubscriptionAudit(
    runner: AdminQueryRunner,
    input: Readonly<{
        auditId: string;
        actorUserId: string;
        action: SubscriptionAuditAction;
        targetType: SubscriptionAuditTargetType;
        targetId: string;
        beforeData: Readonly<Record<string, unknown>> | null;
        afterData: Readonly<Record<string, unknown>> | null;
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
            $4::varchar, $5::uuid, $6::jsonb, $7::jsonb,
            $8::varchar, transaction_timestamp()
        )
        RETURNING id
    `, [
        input.auditId,
        input.actorUserId,
        input.action,
        input.targetType,
        input.targetId,
        input.beforeData === null ? null : JSON.stringify(input.beforeData),
        input.afterData === null ? null : JSON.stringify(input.afterData),
        input.requestId,
    ]);
    expectReturnedId(result, "訂閱目錄稽核未完成，請重新提交。");
}
