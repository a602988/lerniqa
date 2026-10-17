import { createHash, randomUUID } from "node:crypto";

import type { AdminMutationIdempotency } from "./admin-mutation-receipts.ts";
import type { AdminMutationContext } from "./admin-mutation-handler.ts";
import {
    acquireSubscriptionCatalogKeyLock,
    countInactiveIncludedFeaturesForPlan,
    countIncludedNonRetiredPlansForFeature,
    countNonRetiredSubscriptionPrices,
    insertSubscriptionAudit,
    insertSubscriptionFeatureDefinition,
    insertSubscriptionFeatureLimit,
    insertSubscriptionPlan,
    insertSubscriptionPrice,
    lockSubscriptionFeatureDefinition,
    lockSubscriptionFeatureLimit,
    lockSubscriptionPlan,
    lockSubscriptionPrice,
    transitionSubscriptionFeatureDefinition,
    transitionSubscriptionPlan,
    transitionSubscriptionPrice,
    updateSubscriptionFeatureDefinitionMetadata,
    updateSubscriptionFeatureLimit,
    updateSubscriptionPlanMetadata,
    updateSubscriptionPriceTerms,
} from "./subscription-mutation-repository.ts";
import {
    AdminApiError,
    type SubscriptionFeatureDefinitionInput,
    type SubscriptionFeatureDefinitionStatusInput,
    type SubscriptionFeatureDefinitionUpdateInput,
    type SubscriptionFeatureLimitWriteInput,
    type SubscriptionPlanInput,
    type SubscriptionPlanStatusInput,
    type SubscriptionPlanUpdateInput,
    type SubscriptionPriceInput,
    type SubscriptionPriceStatusInput,
    type SubscriptionPriceUpdateInput,
} from "./admin-types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const EVIDENCE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MACHINE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/u;

export interface SubscriptionIdGenerator {
    next(): string;
}

interface SubscriptionServiceDependencies {
    idempotency: AdminMutationIdempotency;
    ids?: SubscriptionIdGenerator;
}

export interface SubscriptionPlanMutationResult {
    planId: string;
    code: string;
    status: "draft" | "active" | "retired";
    lockVersion: number;
}

export interface SubscriptionPriceMutationResult {
    planId: string;
    priceId: string;
    status: "draft" | "active" | "retired";
    lockVersion: number;
}

export interface SubscriptionFeatureDefinitionMutationResult {
    featureDefinitionId: string;
    featureKey: string;
    status: "draft" | "active" | "retired";
    lockVersion: number;
}

export interface SubscriptionFeatureLimitMutationResult {
    planId: string;
    featureDefinitionId: string;
    featureLimitId: string;
    lockVersion: number;
}

const randomIds: SubscriptionIdGenerator = { next: randomUUID };

function fingerprint(parts: readonly unknown[]): string {
    return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function assertUuid(value: string, label: string): void {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        throw new AdminApiError("INVALID_INPUT", `${label}格式不正確。`, 422);
    }
}

function assertEvidence(context: AdminMutationContext): void {
    if (
        !EVIDENCE_UUID_PATTERN.test(context.evidence.requestId)
        || !EVIDENCE_UUID_PATTERN.test(context.evidence.idempotencyKey)
    ) {
        throw new AdminApiError("INVALID_INPUT", "管理操作證據格式不正確。", 422);
    }
}

function assertPositiveLock(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new AdminApiError("INVALID_INPUT", "預期資料版本不正確。", 422);
    }
}

function assertCurrentVersion(actual: number, expected: number, label: string): void {
    if (actual !== expected) {
        throw new AdminApiError("STALE_VERSION", `${label}已被其他操作更新。`, 409);
    }
}

function assertPlanMutable(status: string): void {
    if (status === "retired") {
        throw new AdminApiError("INVALID_SUBSCRIPTION_PLAN", "已停用方案不可再修改。", 409);
    }
}

function planTransitionAllowed(current: string, target: string): boolean {
    return (current === "draft" && (target === "active" || target === "retired"))
        || (current === "active" && target === "retired");
}

function catalogReceipt(
    targetType: string,
    targetId: string,
    auditLogId: string,
    responseStatus: 200 | 201,
) {
    return { targetType, targetId, auditLogId, responseStatus };
}

export class SubscriptionCatalogService {
    private readonly idempotency: AdminMutationIdempotency;
    private readonly ids: SubscriptionIdGenerator;

    constructor(dependencies: SubscriptionServiceDependencies) {
        if (!dependencies.idempotency) {
            throw new TypeError("A durable admin mutation receipt adapter is required");
        }
        this.idempotency = dependencies.idempotency;
        this.ids = dependencies.ids ?? randomIds;
    }

    async createPlan(
        context: AdminMutationContext,
        input: SubscriptionPlanInput,
    ): Promise<SubscriptionPlanMutationResult> {
        assertEvidence(context);
        if (input.status !== "draft") {
            throw new AdminApiError(
                "INVALID_SUBSCRIPTION_PLAN",
                "新方案必須先建立為草稿。",
                422,
            );
        }
        const planId = this.ids.next();
        const auditId = this.ids.next();
        assertUuid(planId, "方案識別碼");
        assertUuid(auditId, "稽核識別碼");

        return this.idempotency.execute(context.runner, {
            actorUserId: context.actor.userId,
            operation: "subscription_plan_create",
            key: context.evidence.idempotencyKey,
            payloadFingerprint: fingerprint([
                "subscription_plan_create",
                input.code,
                input.name,
                input.description,
            ]),
            requestId: context.evidence.requestId,
        }, async () => {
            await acquireSubscriptionCatalogKeyLock(context.runner, "plan", input.code);
            await insertSubscriptionPlan(context.runner, {
                id: planId,
                actorUserId: context.actor.userId,
                code: input.code,
                name: input.name,
                description: input.description,
            });
            await insertSubscriptionAudit(context.runner, {
                auditId,
                actorUserId: context.actor.userId,
                action: "subscription_plan_created",
                targetType: "subscription_plan",
                targetId: planId,
                beforeData: null,
                afterData: {
                    code: input.code,
                    name: input.name,
                    description: input.description,
                    status: "draft",
                    lockVersion: 1,
                },
                requestId: context.evidence.requestId,
            });
            const result: SubscriptionPlanMutationResult = {
                planId,
                code: input.code,
                status: "draft",
                lockVersion: 1,
            };
            return {
                result,
                receipt: catalogReceipt("subscription_plan", planId, auditId, 201),
            };
        });
    }

    async updatePlan(
        context: AdminMutationContext,
        input: SubscriptionPlanUpdateInput,
    ): Promise<SubscriptionPlanMutationResult> {
        assertEvidence(context);
        assertUuid(input.planId, "方案識別碼");
        assertPositiveLock(input.expectedLockVersion);

        return this.idempotency.execute(context.runner, {
            actorUserId: context.actor.userId,
            operation: "subscription_plan_update",
            key: context.evidence.idempotencyKey,
            payloadFingerprint: fingerprint([
                "subscription_plan_update",
                input.planId,
                input.expectedLockVersion,
                input.name,
                input.description,
            ]),
            requestId: context.evidence.requestId,
        }, async () => {
            const current = await lockSubscriptionPlan(context.runner, input.planId);
            assertCurrentVersion(current.lockVersion, input.expectedLockVersion, "方案");
            assertPlanMutable(current.status);
            if (current.name === input.name && current.description === input.description) {
                throw new AdminApiError("CONFLICT", "方案內容沒有變更。", 409);
            }
            const auditId = this.ids.next();
            assertUuid(auditId, "稽核識別碼");
            const lockVersion = await updateSubscriptionPlanMetadata(context.runner, {
                ...input,
                actorUserId: context.actor.userId,
            });
            await insertSubscriptionAudit(context.runner, {
                auditId,
                actorUserId: context.actor.userId,
                action: "subscription_plan_updated",
                targetType: "subscription_plan",
                targetId: current.id,
                beforeData: {
                    name: current.name,
                    description: current.description,
                    status: current.status,
                    lockVersion: current.lockVersion,
                },
                afterData: {
                    name: input.name,
                    description: input.description,
                    status: current.status,
                    lockVersion,
                },
                requestId: context.evidence.requestId,
            });
            const result: SubscriptionPlanMutationResult = {
                planId: current.id,
                code: current.code,
                status: current.status,
                lockVersion,
            };
            return {
                result,
                receipt: catalogReceipt("subscription_plan", current.id, auditId, 200),
            };
        });
    }

    async transitionPlan(
        context: AdminMutationContext,
        input: SubscriptionPlanStatusInput,
    ): Promise<SubscriptionPlanMutationResult> {
        assertEvidence(context);
        assertUuid(input.planId, "方案識別碼");
        assertPositiveLock(input.expectedLockVersion);

        return this.idempotency.execute(context.runner, {
            actorUserId: context.actor.userId,
            operation: "subscription_plan_status",
            key: context.evidence.idempotencyKey,
            payloadFingerprint: fingerprint([
                "subscription_plan_status",
                input.planId,
                input.expectedLockVersion,
                input.targetStatus,
            ]),
            requestId: context.evidence.requestId,
        }, async () => {
            const current = await lockSubscriptionPlan(context.runner, input.planId);
            assertCurrentVersion(current.lockVersion, input.expectedLockVersion, "方案");
            if (!planTransitionAllowed(current.status, input.targetStatus)) {
                throw new AdminApiError(
                    "INVALID_SUBSCRIPTION_PLAN",
                    "方案狀態只能由草稿啟用或停用，啟用後只能停用。",
                    409,
                );
            }
            if (
                input.targetStatus === "active"
                && await countInactiveIncludedFeaturesForPlan(context.runner, current.id) > 0
            ) {
                throw new AdminApiError(
                    "INVALID_SUBSCRIPTION_PLAN",
                    "啟用方案前必須先啟用所有已包含的功能定義。",
                    409,
                );
            }
            if (
                input.targetStatus === "retired"
                && await countNonRetiredSubscriptionPrices(context.runner, current.id) > 0
            ) {
                throw new AdminApiError(
                    "INVALID_SUBSCRIPTION_PLAN",
                    "停用方案前必須先停用所有草稿與啟用中的價格。",
                    409,
                );
            }
            const auditId = this.ids.next();
            assertUuid(auditId, "稽核識別碼");
            const lockVersion = await transitionSubscriptionPlan(context.runner, {
                ...input,
                actorUserId: context.actor.userId,
            });
            await insertSubscriptionAudit(context.runner, {
                auditId,
                actorUserId: context.actor.userId,
                action: input.targetStatus === "active"
                    ? "subscription_plan_activated"
                    : "subscription_plan_retired",
                targetType: "subscription_plan",
                targetId: current.id,
                beforeData: { status: current.status, lockVersion: current.lockVersion },
                afterData: { status: input.targetStatus, lockVersion },
                requestId: context.evidence.requestId,
            });
            const result: SubscriptionPlanMutationResult = {
                planId: current.id,
                code: current.code,
                status: input.targetStatus,
                lockVersion,
            };
            return {
                result,
                receipt: catalogReceipt("subscription_plan", current.id, auditId, 200),
            };
        });
    }

    async createPrice(
        context: AdminMutationContext,
        input: SubscriptionPriceInput,
    ): Promise<SubscriptionPriceMutationResult> {
        assertEvidence(context);
        assertUuid(input.planId, "方案識別碼");
        if (input.status !== "draft") {
            throw new AdminApiError("INVALID_SUBSCRIPTION_PRICE", "新價格必須先建立為草稿。", 422);
        }
        const priceId = this.ids.next();
        const auditId = this.ids.next();
        assertUuid(priceId, "價格識別碼");
        assertUuid(auditId, "稽核識別碼");

        return this.idempotency.execute(context.runner, {
            actorUserId: context.actor.userId,
            operation: "subscription_price_create",
            key: context.evidence.idempotencyKey,
            payloadFingerprint: fingerprint([
                "subscription_price_create",
                input.planId,
                input.currency,
                input.amountMinor,
                input.billingInterval,
                input.billingIntervalCount,
                input.effectiveFrom,
                input.effectiveUntil,
            ]),
            requestId: context.evidence.requestId,
        }, async () => {
            const plan = await lockSubscriptionPlan(context.runner, input.planId);
            assertPlanMutable(plan.status);
            await insertSubscriptionPrice(context.runner, {
                id: priceId,
                actorUserId: context.actor.userId,
                planId: input.planId,
                currency: input.currency,
                amountMinor: input.amountMinor,
                billingInterval: input.billingInterval,
                billingIntervalCount: input.billingIntervalCount,
                effectiveFrom: input.effectiveFrom,
                effectiveUntil: input.effectiveUntil,
            });
            await insertSubscriptionAudit(context.runner, {
                auditId,
                actorUserId: context.actor.userId,
                action: "subscription_price_created",
                targetType: "subscription_plan_price",
                targetId: priceId,
                beforeData: null,
                afterData: {
                    planId: input.planId,
                    currency: input.currency,
                    amountMinor: input.amountMinor,
                    billingInterval: input.billingInterval,
                    billingIntervalCount: input.billingIntervalCount,
                    effectiveFrom: input.effectiveFrom,
                    effectiveUntil: input.effectiveUntil,
                    status: "draft",
                    lockVersion: 1,
                },
                requestId: context.evidence.requestId,
            });
            const result: SubscriptionPriceMutationResult = {
                planId: input.planId,
                priceId,
                status: "draft",
                lockVersion: 1,
            };
            return {
                result,
                receipt: catalogReceipt("subscription_plan_price", priceId, auditId, 201),
            };
        });
    }

    async updatePrice(
        context: AdminMutationContext,
        input: SubscriptionPriceUpdateInput,
    ): Promise<SubscriptionPriceMutationResult> {
        assertEvidence(context);
        assertUuid(input.planId, "方案識別碼");
        assertUuid(input.priceId, "價格識別碼");
        assertPositiveLock(input.expectedLockVersion);

        return this.idempotency.execute(context.runner, {
            actorUserId: context.actor.userId,
            operation: "subscription_price_update",
            key: context.evidence.idempotencyKey,
            payloadFingerprint: fingerprint([
                "subscription_price_update",
                input.planId,
                input.priceId,
                input.expectedLockVersion,
                input.currency,
                input.amountMinor,
                input.billingInterval,
                input.billingIntervalCount,
                input.effectiveFrom,
                input.effectiveUntil,
            ]),
            requestId: context.evidence.requestId,
        }, async () => {
            const plan = await lockSubscriptionPlan(context.runner, input.planId);
            assertPlanMutable(plan.status);
            const current = await lockSubscriptionPrice(
                context.runner,
                input.planId,
                input.priceId,
            );
            assertCurrentVersion(current.lockVersion, input.expectedLockVersion, "價格");
            if (current.status === "retired") {
                throw new AdminApiError(
                    "INVALID_SUBSCRIPTION_PRICE",
                    "已停用價格不可再修改。",
                    409,
                );
            }
            if (
                current.status === "active"
                && (
                    current.currency !== input.currency
                    || current.amountMinor !== input.amountMinor
                    || current.billingInterval !== input.billingInterval
                    || current.billingIntervalCount !== input.billingIntervalCount
                    || current.effectiveFrom !== input.effectiveFrom
                    || current.effectiveUntil !== null
                    || input.effectiveUntil === null
                )
            ) {
                throw new AdminApiError(
                    "INVALID_SUBSCRIPTION_PRICE",
                    "啟用價格的條件不可修改；只能設定一次尚未填寫的結束日。",
                    409,
                );
            }
            if (
                current.currency === input.currency
                && current.amountMinor === input.amountMinor
                && current.billingInterval === input.billingInterval
                && current.billingIntervalCount === input.billingIntervalCount
                && current.effectiveFrom === input.effectiveFrom
                && current.effectiveUntil === input.effectiveUntil
            ) {
                throw new AdminApiError("CONFLICT", "價格內容沒有變更。", 409);
            }
            const auditId = this.ids.next();
            assertUuid(auditId, "稽核識別碼");
            const lockVersion = await updateSubscriptionPriceTerms(context.runner, {
                ...input,
                actorUserId: context.actor.userId,
            });
            await insertSubscriptionAudit(context.runner, {
                auditId,
                actorUserId: context.actor.userId,
                action: "subscription_price_updated",
                targetType: "subscription_plan_price",
                targetId: current.id,
                beforeData: {
                    planId: current.planId,
                    currency: current.currency,
                    amountMinor: current.amountMinor,
                    billingInterval: current.billingInterval,
                    billingIntervalCount: current.billingIntervalCount,
                    effectiveFrom: current.effectiveFrom,
                    effectiveUntil: current.effectiveUntil,
                    status: current.status,
                    lockVersion: current.lockVersion,
                },
                afterData: {
                    planId: input.planId,
                    currency: input.currency,
                    amountMinor: input.amountMinor,
                    billingInterval: input.billingInterval,
                    billingIntervalCount: input.billingIntervalCount,
                    effectiveFrom: input.effectiveFrom,
                    effectiveUntil: input.effectiveUntil,
                    status: current.status,
                    lockVersion,
                },
                requestId: context.evidence.requestId,
            });
            const result: SubscriptionPriceMutationResult = {
                planId: input.planId,
                priceId: current.id,
                status: current.status,
                lockVersion,
            };
            return {
                result,
                receipt: catalogReceipt("subscription_plan_price", current.id, auditId, 200),
            };
        });
    }

    async transitionPrice(
        context: AdminMutationContext,
        input: SubscriptionPriceStatusInput,
    ): Promise<SubscriptionPriceMutationResult> {
        assertEvidence(context);
        assertUuid(input.planId, "方案識別碼");
        assertUuid(input.priceId, "價格識別碼");
        assertPositiveLock(input.expectedLockVersion);

        return this.idempotency.execute(context.runner, {
            actorUserId: context.actor.userId,
            operation: "subscription_price_status",
            key: context.evidence.idempotencyKey,
            payloadFingerprint: fingerprint([
                "subscription_price_status",
                input.planId,
                input.priceId,
                input.expectedLockVersion,
                input.targetStatus,
            ]),
            requestId: context.evidence.requestId,
        }, async () => {
            const plan = await lockSubscriptionPlan(context.runner, input.planId);
            assertPlanMutable(plan.status);
            const current = await lockSubscriptionPrice(
                context.runner,
                input.planId,
                input.priceId,
            );
            assertCurrentVersion(current.lockVersion, input.expectedLockVersion, "價格");
            if (input.targetStatus === "active" && plan.status !== "active") {
                throw new AdminApiError(
                    "INVALID_SUBSCRIPTION_PRICE",
                    "必須先啟用方案，才能啟用價格。",
                    409,
                );
            }
            if (!planTransitionAllowed(current.status, input.targetStatus)) {
                throw new AdminApiError(
                    "INVALID_SUBSCRIPTION_PRICE",
                    "價格狀態只能由草稿啟用或停用，啟用後只能停用。",
                    409,
                );
            }
            if (input.targetStatus === "active" && current.effectiveFrom === null) {
                throw new AdminApiError(
                    "INVALID_SUBSCRIPTION_PRICE",
                    "啟用價格前必須設定生效日。",
                    422,
                );
            }
            const auditId = this.ids.next();
            assertUuid(auditId, "稽核識別碼");
            const lockVersion = await transitionSubscriptionPrice(context.runner, {
                ...input,
                actorUserId: context.actor.userId,
            });
            await insertSubscriptionAudit(context.runner, {
                auditId,
                actorUserId: context.actor.userId,
                action: input.targetStatus === "active"
                    ? "subscription_price_activated"
                    : "subscription_price_retired",
                targetType: "subscription_plan_price",
                targetId: current.id,
                beforeData: { status: current.status, lockVersion: current.lockVersion },
                afterData: { status: input.targetStatus, lockVersion },
                requestId: context.evidence.requestId,
            });
            const result: SubscriptionPriceMutationResult = {
                planId: input.planId,
                priceId: current.id,
                status: input.targetStatus,
                lockVersion,
            };
            return {
                result,
                receipt: catalogReceipt("subscription_plan_price", current.id, auditId, 200),
            };
        });
    }

    async createFeatureDefinition(
        context: AdminMutationContext,
        input: SubscriptionFeatureDefinitionInput,
    ): Promise<SubscriptionFeatureDefinitionMutationResult> {
        assertEvidence(context);
        if (
            (input.valueType === "boolean" && input.unit !== null)
            || (
                input.valueType === "integer"
                && (
                    input.unit === null
                    || !MACHINE_KEY_PATTERN.test(input.unit)
                    || input.unit.length > 40
                )
            )
        ) {
            throw new AdminApiError(
                "INVALID_FEATURE_LIMIT",
                input.valueType === "boolean"
                    ? "布林功能不可設定計量單位。"
                    : "整數功能必須設定計量單位。",
                422,
            );
        }
        const featureDefinitionId = this.ids.next();
        const auditId = this.ids.next();
        assertUuid(featureDefinitionId, "功能定義識別碼");
        assertUuid(auditId, "稽核識別碼");

        return this.idempotency.execute(context.runner, {
            actorUserId: context.actor.userId,
            operation: "subscription_feature_create",
            key: context.evidence.idempotencyKey,
            payloadFingerprint: fingerprint([
                "subscription_feature_create",
                input.featureKey,
                input.displayName,
                input.description,
                input.valueType,
                input.unit,
            ]),
            requestId: context.evidence.requestId,
        }, async () => {
            await acquireSubscriptionCatalogKeyLock(context.runner, "feature", input.featureKey);
            await insertSubscriptionFeatureDefinition(context.runner, {
                id: featureDefinitionId,
                actorUserId: context.actor.userId,
                featureKey: input.featureKey,
                displayName: input.displayName,
                description: input.description,
                valueType: input.valueType,
                unit: input.unit,
            });
            await insertSubscriptionAudit(context.runner, {
                auditId,
                actorUserId: context.actor.userId,
                action: "subscription_feature_definition_created",
                targetType: "subscription_feature_definition",
                targetId: featureDefinitionId,
                beforeData: null,
                afterData: {
                    featureKey: input.featureKey,
                    displayName: input.displayName,
                    description: input.description,
                    valueType: input.valueType,
                    unit: input.unit,
                    status: "draft",
                    lockVersion: 1,
                },
                requestId: context.evidence.requestId,
            });
            const result: SubscriptionFeatureDefinitionMutationResult = {
                featureDefinitionId,
                featureKey: input.featureKey,
                status: "draft",
                lockVersion: 1,
            };
            return {
                result,
                receipt: catalogReceipt(
                    "subscription_feature_definition",
                    featureDefinitionId,
                    auditId,
                    201,
                ),
            };
        });
    }

    async updateFeatureDefinition(
        context: AdminMutationContext,
        input: SubscriptionFeatureDefinitionUpdateInput,
    ): Promise<SubscriptionFeatureDefinitionMutationResult> {
        assertEvidence(context);
        assertUuid(input.featureDefinitionId, "功能定義識別碼");
        assertPositiveLock(input.expectedLockVersion);
        if (
            (input.valueType === "boolean" && input.unit !== null)
            || (
                input.valueType === "integer"
                && (
                    input.unit === null
                    || !MACHINE_KEY_PATTERN.test(input.unit)
                    || input.unit.length > 40
                )
            )
        ) {
            throw new AdminApiError(
                "INVALID_FEATURE_LIMIT",
                input.valueType === "boolean"
                    ? "布林功能不可設定計量單位。"
                    : "整數功能必須設定有效的計量單位。",
                422,
            );
        }

        return this.idempotency.execute(context.runner, {
            actorUserId: context.actor.userId,
            operation: "subscription_feature_update",
            key: context.evidence.idempotencyKey,
            payloadFingerprint: fingerprint([
                "subscription_feature_update",
                input.featureDefinitionId,
                input.expectedLockVersion,
                input.displayName,
                input.description,
                input.valueType,
                input.unit,
            ]),
            requestId: context.evidence.requestId,
        }, async () => {
            const current = await lockSubscriptionFeatureDefinition(
                context.runner,
                input.featureDefinitionId,
            );
            assertCurrentVersion(current.lockVersion, input.expectedLockVersion, "功能定義");
            if (current.status === "retired") {
                throw new AdminApiError("INVALID_FEATURE_LIMIT", "已停用功能不可再修改。", 409);
            }
            if (
                current.status !== "draft"
                && (current.valueType !== input.valueType || current.unit !== input.unit)
            ) {
                throw new AdminApiError(
                    "INVALID_FEATURE_LIMIT",
                    "功能啟用後不可變更值類型或計量單位。",
                    409,
                );
            }
            if (
                current.displayName === input.displayName
                && current.description === input.description
                && current.valueType === input.valueType
                && current.unit === input.unit
            ) {
                throw new AdminApiError("CONFLICT", "功能定義內容沒有變更。", 409);
            }
            const auditId = this.ids.next();
            assertUuid(auditId, "稽核識別碼");
            const lockVersion = await updateSubscriptionFeatureDefinitionMetadata(
                context.runner,
                { ...input, actorUserId: context.actor.userId },
            );
            await insertSubscriptionAudit(context.runner, {
                auditId,
                actorUserId: context.actor.userId,
                action: "subscription_feature_definition_updated",
                targetType: "subscription_feature_definition",
                targetId: current.id,
                beforeData: {
                    featureKey: current.featureKey,
                    displayName: current.displayName,
                    description: current.description,
                    valueType: current.valueType,
                    unit: current.unit,
                    status: current.status,
                    lockVersion: current.lockVersion,
                },
                afterData: {
                    featureKey: current.featureKey,
                    displayName: input.displayName,
                    description: input.description,
                    valueType: input.valueType,
                    unit: input.unit,
                    status: current.status,
                    lockVersion,
                },
                requestId: context.evidence.requestId,
            });
            const result: SubscriptionFeatureDefinitionMutationResult = {
                featureDefinitionId: current.id,
                featureKey: current.featureKey,
                status: current.status,
                lockVersion,
            };
            return {
                result,
                receipt: catalogReceipt(
                    "subscription_feature_definition",
                    current.id,
                    auditId,
                    200,
                ),
            };
        });
    }

    async transitionFeatureDefinition(
        context: AdminMutationContext,
        input: SubscriptionFeatureDefinitionStatusInput,
    ): Promise<SubscriptionFeatureDefinitionMutationResult> {
        assertEvidence(context);
        assertUuid(input.featureDefinitionId, "功能定義識別碼");
        assertPositiveLock(input.expectedLockVersion);

        return this.idempotency.execute(context.runner, {
            actorUserId: context.actor.userId,
            operation: "subscription_feature_status",
            key: context.evidence.idempotencyKey,
            payloadFingerprint: fingerprint([
                "subscription_feature_status",
                input.featureDefinitionId,
                input.expectedLockVersion,
                input.targetStatus,
            ]),
            requestId: context.evidence.requestId,
        }, async () => {
            const current = await lockSubscriptionFeatureDefinition(
                context.runner,
                input.featureDefinitionId,
            );
            assertCurrentVersion(current.lockVersion, input.expectedLockVersion, "功能定義");
            if (!planTransitionAllowed(current.status, input.targetStatus)) {
                throw new AdminApiError(
                    "INVALID_FEATURE_LIMIT",
                    "功能狀態只能由草稿啟用或停用，啟用後只能停用。",
                    409,
                );
            }
            if (
                input.targetStatus === "retired"
                && await countIncludedNonRetiredPlansForFeature(
                    context.runner,
                    current.id,
                ) > 0
            ) {
                throw new AdminApiError(
                    "INVALID_FEATURE_LIMIT",
                    "停用功能前必須先從所有未停用方案排除這項功能。",
                    409,
                );
            }
            const auditId = this.ids.next();
            assertUuid(auditId, "稽核識別碼");
            const lockVersion = await transitionSubscriptionFeatureDefinition(context.runner, {
                ...input,
                actorUserId: context.actor.userId,
            });
            await insertSubscriptionAudit(context.runner, {
                auditId,
                actorUserId: context.actor.userId,
                action: input.targetStatus === "active"
                    ? "subscription_feature_definition_activated"
                    : "subscription_feature_definition_retired",
                targetType: "subscription_feature_definition",
                targetId: current.id,
                beforeData: { status: current.status, lockVersion: current.lockVersion },
                afterData: { status: input.targetStatus, lockVersion },
                requestId: context.evidence.requestId,
            });
            const result: SubscriptionFeatureDefinitionMutationResult = {
                featureDefinitionId: current.id,
                featureKey: current.featureKey,
                status: input.targetStatus,
                lockVersion,
            };
            return {
                result,
                receipt: catalogReceipt(
                    "subscription_feature_definition",
                    current.id,
                    auditId,
                    200,
                ),
            };
        });
    }

    async setFeatureLimit(
        context: AdminMutationContext,
        input: SubscriptionFeatureLimitWriteInput,
    ): Promise<SubscriptionFeatureLimitMutationResult> {
        assertEvidence(context);
        assertUuid(input.planId, "方案識別碼");
        assertUuid(input.featureDefinitionId, "功能定義識別碼");
        if (input.expectedLockVersion !== null) assertPositiveLock(input.expectedLockVersion);

        return this.idempotency.execute(context.runner, {
            actorUserId: context.actor.userId,
            operation: "subscription_feature_limit_set",
            key: context.evidence.idempotencyKey,
            payloadFingerprint: fingerprint([
                "subscription_feature_limit_set",
                input.planId,
                input.featureDefinitionId,
                input.expectedLockVersion,
                input.included,
                input.unlimited,
                input.limit,
            ]),
            requestId: context.evidence.requestId,
        }, async () => {
            const plan = await lockSubscriptionPlan(context.runner, input.planId);
            assertPlanMutable(plan.status);
            const definition = await lockSubscriptionFeatureDefinition(
                context.runner,
                input.featureDefinitionId,
            );
            if (definition.status === "retired") {
                throw new AdminApiError(
                    "INVALID_FEATURE_LIMIT",
                    "已停用功能不可再設定方案限制。",
                    409,
                );
            }
            if (!input.included && (input.unlimited || input.limit !== null)) {
                throw new AdminApiError(
                    "INVALID_FEATURE_LIMIT",
                    "未包含的功能不可設定用量。",
                    422,
                );
            }
            if (
                definition.valueType === "boolean"
                && input.included
                && (input.unlimited || input.limit !== null)
            ) {
                throw new AdminApiError(
                    "INVALID_FEATURE_LIMIT",
                    "布林功能只能設定為包含或不包含。",
                    422,
                );
            }
            if (
                definition.valueType === "integer"
                && input.included
                && (
                    (input.unlimited && input.limit !== null)
                    || (!input.unlimited && input.limit === null)
                )
            ) {
                throw new AdminApiError(
                    "INVALID_FEATURE_LIMIT",
                    "整數功能必須設定有限數量或無上限。",
                    422,
                );
            }
            if (plan.status === "active" && input.included && definition.status !== "active") {
                throw new AdminApiError(
                    "INVALID_FEATURE_LIMIT",
                    "啟用方案只能包含已啟用的功能定義。",
                    422,
                );
            }
            const current = await lockSubscriptionFeatureLimit(
                context.runner,
                input.planId,
                input.featureDefinitionId,
            );
            if (current === null && input.expectedLockVersion !== null) {
                throw new AdminApiError("STALE_VERSION", "功能限制已被其他操作更新。", 409);
            }
            if (current !== null) {
                if (input.expectedLockVersion === null) {
                    throw new AdminApiError("STALE_VERSION", "功能限制已存在，請重新載入。", 409);
                }
                assertCurrentVersion(current.lockVersion, input.expectedLockVersion, "功能限制");
                if (
                    current.included === input.included
                    && current.unlimited === input.unlimited
                    && current.limit === input.limit
                ) {
                    throw new AdminApiError("CONFLICT", "功能限制沒有變更。", 409);
                }
            }

            const featureLimitId = current?.id ?? this.ids.next();
            const auditId = this.ids.next();
            assertUuid(featureLimitId, "功能限制識別碼");
            assertUuid(auditId, "稽核識別碼");
            let lockVersion: number;
            if (current) {
                lockVersion = await updateSubscriptionFeatureLimit(context.runner, {
                    id: current.id,
                    actorUserId: context.actor.userId,
                    expectedLockVersion: current.lockVersion,
                    included: input.included,
                    unlimited: input.unlimited,
                    limit: input.limit,
                });
            }
            else {
                await insertSubscriptionFeatureLimit(context.runner, {
                    id: featureLimitId,
                    actorUserId: context.actor.userId,
                    planId: input.planId,
                    featureDefinitionId: input.featureDefinitionId,
                    included: input.included,
                    unlimited: input.unlimited,
                    limit: input.limit,
                });
                lockVersion = 1;
            }
            await insertSubscriptionAudit(context.runner, {
                auditId,
                actorUserId: context.actor.userId,
                action: current
                    ? "subscription_feature_limit_updated"
                    : "subscription_feature_limit_set",
                targetType: "subscription_plan_feature_limit",
                targetId: featureLimitId,
                beforeData: current ? {
                    planId: current.planId,
                    featureDefinitionId: current.featureDefinitionId,
                    included: current.included,
                    unlimited: current.unlimited,
                    limit: current.limit,
                    lockVersion: current.lockVersion,
                } : null,
                afterData: {
                    planId: input.planId,
                    featureDefinitionId: input.featureDefinitionId,
                    included: input.included,
                    unlimited: input.unlimited,
                    limit: input.limit,
                    lockVersion,
                },
                requestId: context.evidence.requestId,
            });
            const result: SubscriptionFeatureLimitMutationResult = {
                planId: input.planId,
                featureDefinitionId: input.featureDefinitionId,
                featureLimitId,
                lockVersion,
            };
            return {
                result,
                receipt: catalogReceipt(
                    "subscription_plan_feature_limit",
                    featureLimitId,
                    auditId,
                    current ? 200 : 201,
                ),
            };
        });
    }
}
