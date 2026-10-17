import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type {
    AdminQueryResult,
    AdminQueryRunner,
    SystemAdminActor,
} from "../app/lib/admin/admin-auth.ts";
import { resolveCatalogMutationAttempt } from "../app/components/admin/views/subscription-catalog-client.ts";
import {
    subscriptionBillingIntervalLabel,
    subscriptionCatalogStatusLabel,
} from "../app/components/admin/views/subscription-catalog-labels.ts";
import type {
    AdminMutationIdempotency,
    AdminMutationReceiptCompletion,
    AdminMutationReceiptRequest,
} from "../app/lib/admin/admin-mutation-receipts.ts";
import {
    parseAuditListQuery,
    parseSubscriptionFeatureDefinitionInput,
    parseSubscriptionFeatureDefinitionUpdateInput,
    parseSubscriptionFeatureLimitInput,
    parseSubscriptionFeatureLimitWriteInput,
    parseSubscriptionPlanListQuery,
    parseSubscriptionPriceUpdateInput,
} from "../app/lib/admin/admin-input.ts";
import { AdminApiError } from "../app/lib/admin/admin-types.ts";
import { buildSubscriptionPlansViewModel } from "../app/lib/admin/admin-view-model.ts";
import {
    listAuditLogs,
    sanitizeAuditData,
} from "../app/lib/admin/audit-repository.ts";
import { listSubscriptionPlans } from "../app/lib/admin/subscription-repository.ts";
import { SubscriptionCatalogService } from "../app/lib/admin/subscription-service.ts";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const KEY = "44444444-4444-4444-8444-444444444444";
const PLAN_ID = "55555555-5555-4555-8555-555555555555";
const PRICE_ID = "66666666-6666-4666-8666-666666666666";
const FEATURE_ID = "77777777-7777-4777-8777-777777777777";
const LIMIT_ID = "88888888-8888-4888-8888-888888888888";
const AUDIT_ID = "99999999-9999-4999-8999-999999999999";

const actor: SystemAdminActor = {
    userId: ACTOR_ID,
    sessionId: SESSION_ID,
    displayName: "Catalog Admin",
    expiresAt: "2026-10-20T00:00:00.000Z",
};

const evidence = { requestId: REQUEST_ID, idempotencyKey: KEY } as const;

interface QueryCall {
    text: string;
    values: readonly unknown[];
}

class FakeRunner implements AdminQueryRunner {
    readonly calls: QueryCall[] = [];
    private readonly resolver: (
        text: string,
        values: readonly unknown[],
        index: number,
    ) => QueryResultRow[];

    constructor(
        resolver: (
            text: string,
            values: readonly unknown[],
            index: number,
        ) => QueryResultRow[],
    ) {
        this.resolver = resolver;
    }

    async query<Row extends QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
    ): Promise<AdminQueryResult<Row>> {
        const index = this.calls.length;
        this.calls.push({ text, values });
        return { rows: this.resolver(text, values, index) as Row[] };
    }
}

class PassthroughReceipts implements AdminMutationIdempotency {
    readonly requests: AdminMutationReceiptRequest[] = [];
    readonly completions: AdminMutationReceiptCompletion<unknown>[] = [];

    async execute<Result>(
        runner: AdminQueryRunner,
        request: AdminMutationReceiptRequest,
        operation: () => Promise<AdminMutationReceiptCompletion<Result>>,
    ): Promise<Result> {
        assert.ok(runner);
        this.requests.push(request);
        const completion = await operation();
        this.completions.push(completion);
        return completion.result;
    }
}

class SequenceIds {
    private index = 0;
    constructor(privateIds: readonly string[]) {
        this.ids = privateIds;
    }
    private readonly ids: readonly string[];
    next(): string {
        const id = this.ids[this.index++];
        if (!id) throw new Error("test id sequence exhausted");
        return id;
    }
}

function context(runner: AdminQueryRunner, key = KEY) {
    return { actor, runner, evidence: { ...evidence, idempotencyKey: key } };
}

async function expectAdminError(
    operation: () => Promise<unknown> | unknown,
    code: string,
    status?: number,
): Promise<void> {
    await assert.rejects(async () => operation(), (error: unknown) => {
        assert.ok(error instanceof AdminApiError);
        assert.equal(error.code, code);
        if (status !== undefined) assert.equal(error.status, status);
        return true;
    });
}

test("subscription list parses allowlisted filters, sort and pagination", () => {
    assert.deepEqual(parseSubscriptionPlanListQuery({
        search: " 家庭 方案 ",
        status: "draft,active",
        sort: "name",
        direction: "asc",
        page: "2",
        perPage: "10",
    }), {
        search: "家庭 方案",
        statuses: ["draft", "active"],
        orderBy: [
            { field: "name", direction: "asc" },
            { field: "id", direction: "asc" },
        ],
        page: 2,
        pageSize: 10,
        offset: 10,
        limit: 10,
    });
    assert.throws(
        () => parseSubscriptionPlanListQuery({ sort: "revenue" }),
        (error: unknown) => error instanceof AdminApiError && error.code === "INVALID_QUERY",
    );
});

test("feature input supports boolean on, integer finite and integer unlimited states", () => {
    assert.equal(parseSubscriptionFeatureDefinitionInput({
        featureKey: "priority_review",
        displayName: "優先批改",
        description: null,
        valueType: "boolean",
        unit: null,
    }, evidence).unit, null);
    assert.equal(parseSubscriptionFeatureDefinitionInput({
        featureKey: "learners_per_account",
        displayName: "學習者數",
        description: null,
        valueType: "integer",
        unit: "learner",
    }, evidence).unit, "learner");

    assert.deepEqual(parseSubscriptionFeatureLimitInput({
        planId: PLAN_ID,
        featureKey: "priority_review",
        included: true,
        unlimited: false,
        limit: null,
    }, evidence).limit, null);
    assert.equal(parseSubscriptionFeatureLimitWriteInput({
        planId: PLAN_ID,
        featureDefinitionId: FEATURE_ID,
        expectedLockVersion: null,
        included: true,
        unlimited: false,
        limit: 3,
    }, evidence).limit, 3);
    assert.equal(parseSubscriptionFeatureLimitWriteInput({
        planId: PLAN_ID,
        featureDefinitionId: FEATURE_ID,
        expectedLockVersion: 2,
        included: true,
        unlimited: true,
        limit: null,
    }, evidence).unlimited, true);
});

test("feature definition rejects boolean units and missing or unsafe integer units", () => {
    for (const input of [
        { valueType: "boolean", unit: "seat" },
        { valueType: "integer", unit: null },
        { valueType: "integer", unit: "learner seats" },
    ]) {
        assert.throws(
            () => parseSubscriptionFeatureDefinitionInput({
                featureKey: "learners_per_account",
                displayName: "學習者數",
                description: null,
                ...input,
            }, evidence),
            (error: unknown) => error instanceof AdminApiError
                && error.code === "INVALID_FEATURE_LIMIT",
        );
    }
});

test("price and feature update parsers require lock evidence and preserve catalog terms", () => {
    assert.deepEqual(parseSubscriptionPriceUpdateInput({
        planId: PLAN_ID,
        priceId: PRICE_ID,
        expectedLockVersion: 3,
        currency: "TWD",
        amountMinor: 39900,
        billingInterval: "month",
        billingIntervalCount: 1,
        effectiveFrom: "2026-11-01",
        effectiveUntil: null,
    }, evidence), {
        planId: PLAN_ID,
        priceId: PRICE_ID,
        expectedLockVersion: 3,
        currency: "TWD",
        amountMinor: 39900,
        billingInterval: "month",
        billingIntervalCount: 1,
        effectiveFrom: "2026-11-01",
        effectiveUntil: null,
        ...evidence,
    });
    assert.deepEqual(parseSubscriptionFeatureDefinitionUpdateInput({
        featureDefinitionId: FEATURE_ID,
        expectedLockVersion: 2,
        displayName: "每月練習次數",
        description: "每個月可完成的練習數",
        valueType: "integer",
        unit: "session",
    }, evidence), {
        featureDefinitionId: FEATURE_ID,
        expectedLockVersion: 2,
        displayName: "每月練習次數",
        description: "每個月可完成的練習數",
        valueType: "integer",
        unit: "session",
        ...evidence,
    });
});

test("catalog client reuses retry evidence only for the same operation, target and body", () => {
    let sequence = 0;
    const nextKey = () => `key-${++sequence}`;
    const first = resolveCatalogMutationAttempt(
        null,
        "PATCH",
        `/api/v1/admin/subscription-plans/${PLAN_ID}`,
        { expectedLockVersion: 2, name: "家庭方案" },
        nextKey,
    );
    const retry = resolveCatalogMutationAttempt(
        first.evidence,
        "PATCH",
        `/api/v1/admin/subscription-plans/${PLAN_ID}`,
        { expectedLockVersion: 2, name: "家庭方案" },
        nextKey,
    );
    assert.equal(retry.evidence.idempotencyKey, first.evidence.idempotencyKey);
    assert.equal(sequence, 1);

    const changedPayload = resolveCatalogMutationAttempt(
        retry.evidence,
        "PATCH",
        `/api/v1/admin/subscription-plans/${PLAN_ID}`,
        { expectedLockVersion: 2, name: "家庭進階方案" },
        nextKey,
    );
    const changedTarget = resolveCatalogMutationAttempt(
        changedPayload.evidence,
        "PATCH",
        `/api/v1/admin/subscription-plans/${PLAN_ID}/status`,
        { expectedLockVersion: 2, name: "家庭進階方案" },
        nextKey,
    );
    assert.notEqual(changedPayload.evidence.idempotencyKey, retry.evidence.idempotencyKey);
    assert.notEqual(changedTarget.evidence.idempotencyKey, changedPayload.evidence.idempotencyKey);
    assert.equal(sequence, 3);
});

test("catalog presentation localizes lifecycle states and billing periods", () => {
    assert.equal(subscriptionCatalogStatusLabel("draft"), "草稿");
    assert.equal(subscriptionCatalogStatusLabel("active"), "啟用");
    assert.equal(subscriptionCatalogStatusLabel("retired"), "已停用");
    assert.equal(subscriptionBillingIntervalLabel("day"), "日");
    assert.equal(subscriptionBillingIntervalLabel("week"), "週");
    assert.equal(subscriptionBillingIntervalLabel("month"), "月");
    assert.equal(subscriptionBillingIntervalLabel("year"), "年");
});

test("subscription list query is parameterized and never reads payment or revenue models", async () => {
    const runner = new FakeRunner(() => [{
        id: PLAN_ID,
        code: "family_plus",
        name: "家庭進階方案",
        description: "最多三位學習者",
        status: "draft",
        lock_version: 1,
        created_at: "2026-10-16T00:00:00Z",
        updated_at: "2026-10-16T01:00:00Z",
        prices: [{
            id: PRICE_ID,
            planId: PLAN_ID,
            currency: "TWD",
            amountMinor: 29900,
            billingInterval: "month",
            billingIntervalCount: 1,
            status: "draft",
            effectiveFrom: "2026-11-01",
            effectiveUntil: null,
            lockVersion: 1,
            createdAt: "2026-10-16T00:00:00Z",
            updatedAt: "2026-10-16T00:00:00Z",
        }],
        feature_limits: [],
        total_count: "1",
    }]);
    const page = await listSubscriptionPlans(runner, parseSubscriptionPlanListQuery({
        search: "family",
        status: "draft",
        sort: "code",
        direction: "asc",
    }));
    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.prices[0]?.amountMinor, 29900);
    const call = runner.calls[0]!;
    assert.deepEqual(call.values, ["family", ["draft"], 25, 0]);
    assert.match(call.text, /ORDER BY page_row\.code ASC, page_row\.id ASC/iu);
    assert.doesNotMatch(call.text, /\b(payments?|invoices?|subscribers?|revenue|checkout)\b/iu);
    assert.doesNotMatch(call.text, /family(?!_limits)/iu);
});

test("subscription view model preserves filters, sorting, pagination and drawer context", () => {
    const query = parseSubscriptionPlanListQuery({
        search: "family",
        status: "draft,active",
        sort: "name",
        direction: "asc",
        page: "2",
        perPage: "10",
    });
    const plan = {
        id: PLAN_ID,
        code: "family_plus",
        name: "家庭進階方案",
        description: "最多三位學習者",
        status: "draft" as const,
        lockVersion: 2,
        createdAt: "2026-10-16T00:00:00.000Z",
        updatedAt: "2026-10-16T01:00:00.000Z",
        prices: [{
            id: PRICE_ID,
            planId: PLAN_ID,
            currency: "TWD",
            amountMinor: 29900,
            billingInterval: "month" as const,
            billingIntervalCount: 1,
            status: "draft" as const,
            effectiveFrom: "2026-11-01",
            effectiveUntil: null,
            lockVersion: 1,
            createdAt: "2026-10-16T00:00:00.000Z",
            updatedAt: "2026-10-16T00:00:00.000Z",
        }],
        featureLimits: [],
    };
    const view = buildSubscriptionPlansViewModel({
        query,
        page: { items: [plan], page: 2, pageSize: 10, total: 27 },
        detail: plan,
        featureDefinitions: [{
            id: FEATURE_ID,
            featureKey: "priority_review",
            displayName: "優先批改",
            description: null,
            valueType: "boolean",
            unit: null,
            status: "active",
            lockVersion: 2,
            createdAt: "2026-10-16T00:00:00.000Z",
            updatedAt: "2026-10-16T00:00:00.000Z",
        }],
    });

    assert.equal(view.rows[0]?.name, "家庭進階方案");
    assert.match(view.rows[0]?.detailHref ?? "", /search=family/u);
    assert.match(view.rows[0]?.detailHref ?? "", /status=draft%2Cactive/u);
    assert.match(view.rows[0]?.detailHref ?? "", /sort=name/u);
    assert.equal(view.pagination?.currentPage, 2);
    assert.equal(view.pagination?.totalItems, 27);
    assert.equal(view.detail?.prices[0]?.amountMinor, 29900);
    assert.equal(view.featureDefinitions?.[0]?.valueType, "boolean");
});

test("plan creation is draft-only, audited and wrapped by the common receipt contract", async () => {
    const runner = new FakeRunner((text, values) => {
        if (/INSERT INTO subscription_plans/iu.test(text)) return [{ id: values[0] }];
        if (/INSERT INTO admin_audit_logs/iu.test(text)) return [{ id: values[0] }];
        return [];
    });
    const receipts = new PassthroughReceipts();
    const service = new SubscriptionCatalogService({
        idempotency: receipts,
        ids: new SequenceIds([PLAN_ID, AUDIT_ID]),
    });
    const result = await service.createPlan(context(runner), {
        code: "family_plus",
        name: "家庭進階方案",
        description: null,
        status: "draft",
        ...evidence,
    });
    assert.deepEqual(result, {
        planId: PLAN_ID,
        code: "family_plus",
        status: "draft",
        lockVersion: 1,
    });
    assert.deepEqual(receipts.requests[0], {
        actorUserId: ACTOR_ID,
        operation: "subscription_plan_create",
        key: KEY,
        payloadFingerprint: receipts.requests[0]!.payloadFingerprint,
        requestId: REQUEST_ID,
    });
    assert.match(receipts.requests[0]!.payloadFingerprint, /^[0-9a-f]{64}$/u);
    const audit = runner.calls.find((call) => /INSERT INTO admin_audit_logs/iu.test(call.text));
    assert.equal(audit?.values[2], "subscription_plan_created");
    assert.equal(audit?.values[3], "subscription_plan");

    await expectAdminError(
        () => service.createPlan(context(runner), {
            code: "active_now",
            name: "不可直接啟用",
            description: null,
            status: "active",
            ...evidence,
        }),
        "INVALID_SUBSCRIPTION_PLAN",
        422,
    );
});

test("draft price updates use optimistic locking, the common receipt and exact audit target", async () => {
    const runner = new FakeRunner((text, values) => {
        if (/FROM subscription_plans\s+WHERE id/iu.test(text)) return [{
            id: PLAN_ID,
            code: "family_plus",
            name: "家庭進階方案",
            description: null,
            status: "draft",
            lock_version: 1,
        }];
        if (/FROM subscription_plan_prices\s+WHERE id/iu.test(text)) return [{
            id: PRICE_ID,
            plan_id: PLAN_ID,
            currency: "TWD",
            amount_minor: 29900,
            billing_interval: "month",
            billing_interval_count: 1,
            status: "draft",
            effective_from: "2026-11-01",
            effective_until: null,
            lock_version: 1,
        }];
        if (/UPDATE subscription_plan_prices/iu.test(text)) return [{
            id: PRICE_ID,
            plan_id: PLAN_ID,
            currency: "TWD",
            amount_minor: 39900,
            billing_interval: "month",
            billing_interval_count: 1,
            status: "draft",
            effective_from: "2026-11-01",
            effective_until: null,
            lock_version: 2,
        }];
        if (/INSERT INTO admin_audit_logs/iu.test(text)) return [{ id: values[0] }];
        return [];
    });
    const receipts = new PassthroughReceipts();
    const service = new SubscriptionCatalogService({
        idempotency: receipts,
        ids: new SequenceIds([AUDIT_ID]),
    });
    const result = await service.updatePrice(context(runner), {
        planId: PLAN_ID,
        priceId: PRICE_ID,
        expectedLockVersion: 1,
        currency: "TWD",
        amountMinor: 39900,
        billingInterval: "month",
        billingIntervalCount: 1,
        effectiveFrom: "2026-11-01",
        effectiveUntil: null,
        ...evidence,
    });

    assert.deepEqual(result, {
        planId: PLAN_ID,
        priceId: PRICE_ID,
        status: "draft",
        lockVersion: 2,
    });
    assert.equal(receipts.requests[0]?.operation, "subscription_price_update");
    assert.equal(receipts.completions[0]?.receipt.targetType, "subscription_plan_price");
    const audit = runner.calls.find((call) => /INSERT INTO admin_audit_logs/iu.test(call.text));
    assert.equal(audit?.values[2], "subscription_price_updated");
    assert.equal(audit?.values[3], "subscription_plan_price");
});

test("active prices permit a first end date but reject changes to frozen terms", async () => {
    const runner = new FakeRunner((text, values) => {
        if (/FROM subscription_plans\s+WHERE id/iu.test(text)) return [{
            id: PLAN_ID,
            code: "family_plus",
            name: "家庭進階方案",
            description: null,
            status: "active",
            lock_version: 2,
        }];
        if (/FROM subscription_plan_prices\s+WHERE id/iu.test(text)) return [{
            id: PRICE_ID,
            plan_id: PLAN_ID,
            currency: "TWD",
            amount_minor: 29900,
            billing_interval: "month",
            billing_interval_count: 1,
            status: "active",
            effective_from: "2026-11-01",
            effective_until: null,
            lock_version: 2,
        }];
        if (/UPDATE subscription_plan_prices/iu.test(text)) return [{
            id: PRICE_ID,
            plan_id: PLAN_ID,
            currency: "TWD",
            amount_minor: 29900,
            billing_interval: "month",
            billing_interval_count: 1,
            status: "active",
            effective_from: "2026-11-01",
            effective_until: "2027-01-31",
            lock_version: 3,
        }];
        if (/INSERT INTO admin_audit_logs/iu.test(text)) return [{ id: values[0] }];
        return [];
    });
    const service = new SubscriptionCatalogService({
        idempotency: new PassthroughReceipts(),
        ids: new SequenceIds([AUDIT_ID]),
    });
    await service.updatePrice(context(runner), {
        planId: PLAN_ID,
        priceId: PRICE_ID,
        expectedLockVersion: 2,
        currency: "TWD",
        amountMinor: 29900,
        billingInterval: "month",
        billingIntervalCount: 1,
        effectiveFrom: "2026-11-01",
        effectiveUntil: "2027-01-31",
        ...evidence,
    });

    const rejectingService = new SubscriptionCatalogService({
        idempotency: new PassthroughReceipts(),
        ids: new SequenceIds([]),
    });
    await expectAdminError(
        () => rejectingService.updatePrice(context(
            runner,
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        ), {
            planId: PLAN_ID,
            priceId: PRICE_ID,
            expectedLockVersion: 2,
            currency: "TWD",
            amountMinor: 49900,
            billingInterval: "month",
            billingIntervalCount: 1,
            effectiveFrom: "2026-11-01",
            effectiveUntil: "2027-01-31",
            requestId: REQUEST_ID,
            idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
        "INVALID_SUBSCRIPTION_PRICE",
        409,
    );
});

test("feature metadata updates preserve active type and produce audited receipts", async () => {
    const runner = new FakeRunner((text, values) => {
        if (/FROM subscription_feature_definitions/iu.test(text)) return [{
            id: FEATURE_ID,
            feature_key: "priority_review",
            display_name: "優先批改",
            description: null,
            value_type: "boolean",
            unit: null,
            status: "active",
            lock_version: 2,
        }];
        if (/UPDATE subscription_feature_definitions/iu.test(text)) return [{
            id: FEATURE_ID,
            feature_key: "priority_review",
            display_name: "優先批改服務",
            description: "可優先進入批改佇列",
            value_type: "boolean",
            unit: null,
            status: "active",
            lock_version: 3,
        }];
        if (/INSERT INTO admin_audit_logs/iu.test(text)) return [{ id: values[0] }];
        return [];
    });
    const receipts = new PassthroughReceipts();
    const service = new SubscriptionCatalogService({
        idempotency: receipts,
        ids: new SequenceIds([AUDIT_ID]),
    });
    await service.updateFeatureDefinition(context(runner), {
        featureDefinitionId: FEATURE_ID,
        expectedLockVersion: 2,
        displayName: "優先批改服務",
        description: "可優先進入批改佇列",
        valueType: "boolean",
        unit: null,
        ...evidence,
    });
    assert.equal(receipts.requests[0]?.operation, "subscription_feature_update");
    assert.equal(receipts.completions[0]?.receipt.targetType, "subscription_feature_definition");

    await expectAdminError(
        () => service.updateFeatureDefinition(context(
            runner,
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ), {
            featureDefinitionId: FEATURE_ID,
            expectedLockVersion: 2,
            displayName: "優先批改",
            description: null,
            valueType: "integer",
            unit: "review",
            requestId: REQUEST_ID,
            idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
        "INVALID_FEATURE_LIMIT",
        409,
    );
});

test("activation remains reachable only in plan-then-price order", async () => {
    let planStatus: "draft" | "active" = "draft";
    let planVersion = 1;
    let priceStatus: "draft" | "active" = "draft";
    let priceVersion = 1;
    const runner = new FakeRunner((text, values) => {
        if (/FROM subscription_plans\s+WHERE id/iu.test(text)) return [{
            id: PLAN_ID,
            code: "family_plus",
            name: "家庭進階方案",
            description: null,
            status: planStatus,
            lock_version: planVersion,
        }];
        if (/UPDATE subscription_plans/iu.test(text)) {
            planStatus = "active";
            planVersion += 1;
            return [{
                id: PLAN_ID,
                code: "family_plus",
                name: "家庭進階方案",
                description: null,
                status: planStatus,
                lock_version: planVersion,
            }];
        }
        if (/FROM subscription_plan_prices\s+WHERE id/iu.test(text)) return [{
            id: PRICE_ID,
            plan_id: PLAN_ID,
            currency: "TWD",
            amount_minor: 29900,
            billing_interval: "month",
            billing_interval_count: 1,
            status: priceStatus,
            effective_from: "2026-11-01",
            effective_until: null,
            lock_version: priceVersion,
        }];
        if (/UPDATE subscription_plan_prices/iu.test(text)) {
            priceStatus = "active";
            priceVersion += 1;
            return [{
                id: PRICE_ID,
                plan_id: PLAN_ID,
                currency: "TWD",
                amount_minor: 29900,
                billing_interval: "month",
                billing_interval_count: 1,
                status: priceStatus,
                effective_from: "2026-11-01",
                effective_until: null,
                lock_version: priceVersion,
            }];
        }
        if (/INSERT INTO admin_audit_logs/iu.test(text)) return [{ id: values[0] }];
        return [];
    });
    const receipts = new PassthroughReceipts();
    const service = new SubscriptionCatalogService({
        idempotency: receipts,
        ids: new SequenceIds([AUDIT_ID, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]),
    });

    await service.transitionPlan(context(runner), {
        planId: PLAN_ID,
        expectedLockVersion: 1,
        targetStatus: "active",
        ...evidence,
    });
    await service.transitionPrice(context(
        runner,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ), {
        planId: PLAN_ID,
        priceId: PRICE_ID,
        expectedLockVersion: 1,
        targetStatus: "active",
        requestId: REQUEST_ID,
        idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });

    const planUpdate = runner.calls.findIndex((call) => /UPDATE subscription_plans/iu.test(call.text));
    const priceUpdate = runner.calls.findIndex((call) => /UPDATE subscription_plan_prices/iu.test(call.text));
    assert.ok(planUpdate >= 0 && priceUpdate > planUpdate);
    const priceAudit = runner.calls.find((call) =>
        /INSERT INTO admin_audit_logs/iu.test(call.text)
        && call.values[2] === "subscription_price_activated",
    );
    assert.equal(priceAudit?.values[3], "subscription_plan_price");
});

test("catalog state guards reject invalid included features before deferred database checks", async () => {
    const planRunner = new FakeRunner((text) => {
        if (/FROM subscription_plans\s+WHERE id/iu.test(text)) return [{
            id: PLAN_ID,
            code: "family_plus",
            name: "家庭進階方案",
            description: null,
            status: "draft",
            lock_version: 1,
        }];
        if (/FROM subscription_plan_feature_limits/iu.test(text)) return [{ item_count: 1 }];
        return [];
    });
    const service = new SubscriptionCatalogService({
        idempotency: new PassthroughReceipts(),
        ids: new SequenceIds([]),
    });
    await expectAdminError(
        () => service.transitionPlan(context(planRunner), {
            planId: PLAN_ID,
            expectedLockVersion: 1,
            targetStatus: "active",
            ...evidence,
        }),
        "INVALID_SUBSCRIPTION_PLAN",
        409,
    );

    const featureRunner = new FakeRunner((text) => {
        if (/FROM subscription_feature_definitions/iu.test(text)) return [{
            id: FEATURE_ID,
            feature_key: "priority_review",
            display_name: "優先批改",
            description: null,
            value_type: "boolean",
            unit: null,
            status: "active",
            lock_version: 2,
        }];
        if (/FROM subscription_plan_feature_limits/iu.test(text)) return [{ item_count: 1 }];
        return [];
    });
    await expectAdminError(
        () => service.transitionFeatureDefinition(context(featureRunner), {
            featureDefinitionId: FEATURE_ID,
            expectedLockVersion: 2,
            targetStatus: "retired",
            ...evidence,
        }),
        "INVALID_FEATURE_LIMIT",
        409,
    );
});

test("feature value type is enforced after locking the trusted definition", async () => {
    const definitionType = { value: "boolean" as "boolean" | "integer" };
    const runner = new FakeRunner((text) => {
        if (/FROM subscription_plans\s+WHERE id/iu.test(text)) return [{
            id: PLAN_ID,
            code: "family_plus",
            name: "家庭進階方案",
            description: null,
            status: "draft",
            lock_version: 1,
        }];
        if (/FROM subscription_feature_definitions/iu.test(text)) return [{
            id: FEATURE_ID,
            feature_key: "limit",
            display_name: "限制",
            description: null,
            value_type: definitionType.value,
            unit: definitionType.value === "integer" ? "item" : null,
            status: "active",
            lock_version: 1,
        }];
        return [];
    });
    const service = new SubscriptionCatalogService({
        idempotency: new PassthroughReceipts(),
        ids: new SequenceIds([LIMIT_ID, AUDIT_ID]),
    });

    await expectAdminError(
        () => service.setFeatureLimit(context(runner), {
            planId: PLAN_ID,
            featureDefinitionId: FEATURE_ID,
            expectedLockVersion: null,
            included: true,
            unlimited: true,
            limit: null,
            ...evidence,
        }),
        "INVALID_FEATURE_LIMIT",
        422,
    );

    definitionType.value = "integer";
    await expectAdminError(
        () => service.setFeatureLimit(context(runner), {
            planId: PLAN_ID,
            featureDefinitionId: FEATURE_ID,
            expectedLockVersion: null,
            included: true,
            unlimited: false,
            limit: null,
            ...evidence,
        }),
        "INVALID_FEATURE_LIMIT",
        422,
    );
});

test("subscription audit allowlists show catalog evidence without receipt or payment payloads", async () => {
    assert.deepEqual(sanitizeAuditData("subscription_price_created", {
        planId: PLAN_ID,
        currency: "TWD",
        amountMinor: 29900,
        billingInterval: "month",
        billingIntervalCount: 1,
        effectiveFrom: "2026-11-01",
        effectiveUntil: null,
        status: "draft",
        lockVersion: 1,
        idempotencyKey: KEY,
        requestFingerprint: "secret",
        providerPriceId: "price_live_secret",
        revenue: 999999,
    }), {
        planId: PLAN_ID,
        currency: "TWD",
        amountMinor: 29900,
        billingInterval: "month",
        billingIntervalCount: 1,
        effectiveFrom: "2026-11-01",
        effectiveUntil: null,
        status: "draft",
        lockVersion: 1,
    });

    const runner = new FakeRunner(() => [{
        id: AUDIT_ID,
        actor_type: "user",
        actor_user_id: ACTOR_ID,
        actor_display_name: "Catalog Admin",
        action: "subscription_feature_limit_set",
        target_type: "subscription_plan_feature_limit",
        target_id: LIMIT_ID,
        before_data: null,
        after_data: {
            planId: PLAN_ID,
            featureDefinitionId: FEATURE_ID,
            included: true,
            unlimited: false,
            limit: 3,
            lockVersion: 1,
            paymentToken: "must-not-leak",
        },
        request_id: REQUEST_ID,
        created_at: "2026-10-16T00:00:00Z",
        total_count: "1",
    }]);
    const page = await listAuditLogs(runner, parseAuditListQuery({}));
    assert.deepEqual(page.items[0]?.after, {
        planId: PLAN_ID,
        featureDefinitionId: FEATURE_ID,
        included: true,
        unlimited: false,
        limit: 3,
        lockVersion: 1,
    });
    assert.doesNotMatch(JSON.stringify(page), /paymentToken|must-not-leak/u);
});

test("subscription page and GET APIs authorize and read inside one snapshot", async () => {
    const files = await Promise.all([
        readFile(new URL("../app/admin/subscription-plans/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/admin/subscription-plans/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/admin/subscription-plans/[planId]/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/admin/subscription-plans/feature-definitions/route.ts", import.meta.url), "utf8"),
    ]);
    for (const source of files) {
        assert.match(source, /withAdminReadOnlySnapshot/iu);
        assert.doesNotMatch(source, /adminPostgresRunner/iu);
    }
    assert.match(files[0]!, /readAdminPageAccessInSnapshot\(runner\)/u);
    assert.match(files[0]!, /unstable_rethrow\(error\)/u);
    for (const source of files.slice(1)) {
        assert.match(source, /requireAdminReadContext\(request, runner\)/u);
    }
});

test("subscription path ids are parsed only inside authenticated mutation handlers", async () => {
    const paths = [
        "../app/api/v1/admin/subscription-plans/[planId]/route.ts",
        "../app/api/v1/admin/subscription-plans/[planId]/status/route.ts",
        "../app/api/v1/admin/subscription-plans/[planId]/prices/route.ts",
        "../app/api/v1/admin/subscription-plans/[planId]/prices/[priceId]/route.ts",
        "../app/api/v1/admin/subscription-plans/[planId]/prices/[priceId]/status/route.ts",
        "../app/api/v1/admin/subscription-plans/[planId]/feature-limits/[featureDefinitionId]/route.ts",
        "../app/api/v1/admin/subscription-plans/feature-definitions/[featureDefinitionId]/route.ts",
        "../app/api/v1/admin/subscription-plans/feature-definitions/[featureDefinitionId]/status/route.ts",
    ];
    for (const path of paths) {
        const source = await readFile(new URL(path, import.meta.url), "utf8");
        const handlerIndex = source.indexOf("handleAdminMutation(");
        const parserIndex = source.indexOf("parse:", handlerIndex);
        const uuidIndex = source.indexOf("parseUuid(", parserIndex);
        assert.ok(handlerIndex >= 0, `${path} must use handleAdminMutation`);
        assert.ok(parserIndex > handlerIndex, `${path} must parse inside the mutation spec`);
        assert.ok(uuidIndex > parserIndex, `${path} must parse path UUIDs in the authenticated parser`);
    }
});

test("catalog dialogs retain a failed attempt key, clear it on success and suppress double submit", async () => {
    const source = await readFile(
        new URL("../app/components/admin/views/subscription-catalog-actions.tsx", import.meta.url),
        "utf8",
    );
    assert.match(source, /if \(pending\) return;/u);
    assert.match(source, /resolveCatalogMutationAttempt\(/u);
    assert.match(source, /retryEvidence\.current = attempt\.evidence/u);
    assert.match(
        source,
        /await mutateCatalog\([\s\S]*?retryEvidence\.current = null;[\s\S]*?setOpen\(false\)/u,
    );
    assert.doesNotMatch(source, /"idempotency-key":\s*crypto\.randomUUID\(\)/u);
});

test("catalog forms expose only coherent conditional fields and cannot close while pending", async () => {
    const actions = await readFile(
        new URL("../app/components/admin/views/subscription-catalog-actions.tsx", import.meta.url),
        "utf8",
    );
    const view = await readFile(
        new URL("../app/components/admin/views/subscription-plans-view.tsx", import.meta.url),
        "utf8",
    );
    assert.match(actions, /valueType === "integer" \? \(/u);
    assert.match(actions, /integerFeature && mode === "finite" \? \(/u);
    assert.match(actions, /if \(!nextOpen && pending\) return;/u);
    assert.match(actions, /errorRef\.current\?\.focus\(\)/u);
    assert.match(actions, /scrollIntoView\(\{ block: "nearest" \}\)/u);
    assert.match(view, /找不到符合條件的方案/u);
    assert.match(view, /請調整搜尋字詞或狀態篩選條件/u);
});
