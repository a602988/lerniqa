import assert from "node:assert/strict";
import test from "node:test";

import {
    ADMIN_DEFAULT_PAGE_SIZE,
    ADMIN_DEFAULT_REVISION_PAGE_SIZE,
    ADMIN_MAX_PAGE,
    ADMIN_MAX_PAGE_SIZE,
    parseAccountListQuery,
    parseAccountStatusTransitionInput,
    parseAuditListQuery,
    parseDateOnly,
    parseQuestionDraftInput,
    parseQuestionDetailQuery,
    parseQuestionListQuery,
    parseQuestionRevisionMutationInput,
    parseSubscriptionFeatureLimitInput,
    parseSubscriptionPlanInput,
    parseSubscriptionPriceInput,
    parseUuid,
} from "../app/lib/admin/admin-input.ts";
import {
    AdminApiError,
    toAdminApiErrorBody,
} from "../app/lib/admin/admin-types.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const QUESTION_ID = "22222222-2222-4222-8222-222222222222";
const REVISION_ID = "33333333-3333-4333-8333-333333333333";
const DRAFT_ID = "44444444-4444-4444-8444-444444444444";
const PLAN_ID = "55555555-5555-4555-8555-555555555555";
const IDEMPOTENCY_KEY = "0199ef00-1234-7abc-8abc-0123456789ab";
const MUTATION_EVIDENCE = {
    requestId: REQUEST_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
};

function assertAdminError(
    action: () => unknown,
    expectedCode: string,
    expectedStatus?: number,
): void {
    assert.throws(action, (error: unknown) => {
        assert.ok(error instanceof AdminApiError);
        assert.equal(error.code, expectedCode);
        if (expectedStatus !== undefined) assert.equal(error.status, expectedStatus);
        return true;
    });
}

test("parses account list pagination, filters and deterministic sorting", () => {
    const parsed = parseAccountListQuery(new URLSearchParams({
        page: "3",
        perPage: "40",
        search: "  Ａlice   Parent ",
        status: "active,suspended,active",
        role: "parent,system_admin",
        createdFrom: "2026-01-01",
        createdTo: "2026-01-31",
        sort: "displayName",
        direction: "asc",
    }));

    assert.deepEqual(parsed, {
        page: 3,
        pageSize: 40,
        offset: 80,
        limit: 40,
        search: "Alice Parent",
        statuses: ["active", "suspended"],
        roles: ["parent", "system_admin"],
        created: { from: "2026-01-01", to: "2026-01-31" },
        orderBy: [
            { field: "displayName", direction: "asc" },
            { field: "id", direction: "asc" },
        ],
    });
});

test("uses bounded list defaults and a stable id tiebreaker", () => {
    const parsed = parseAccountListQuery({});
    assert.equal(parsed.page, 1);
    assert.equal(parsed.pageSize, ADMIN_DEFAULT_PAGE_SIZE);
    assert.deepEqual(parsed.orderBy, [
        { field: "createdAt", direction: "desc" },
        { field: "id", direction: "desc" },
    ]);

    const idSort = parseQuestionListQuery({ sort: "id", direction: "asc" });
    assert.deepEqual(idSort.orderBy, [{ field: "id", direction: "asc" }]);

    const pageSizeAlias = parseAccountListQuery({ pageSize: "15" });
    assert.equal(pageSizeAlias.pageSize, 15);
});

test("rejects pagination overflow, ambiguous values and non-allowlisted sorts", () => {
    for (const query of [
        { page: "0" },
        { page: String(ADMIN_MAX_PAGE + 1) },
        { page: "1.5" },
        { pageSize: "0" },
        { pageSize: String(ADMIN_MAX_PAGE_SIZE + 1) },
        { pageSize: " 25" },
        { perPage: "0" },
        { perPage: String(ADMIN_MAX_PAGE_SIZE + 1) },
        { perPage: "25", pageSize: "25" },
        { sort: "created_at desc; drop table users" },
        { direction: "sideways" },
        { status: "active,unknown" },
        { role: "owner" },
    ]) {
        assertAdminError(() => parseAccountListQuery(query), "INVALID_QUERY", 400);
    }

    assertAdminError(
        () => parseAccountListQuery(new URLSearchParams("page=1&page=2")),
        "INVALID_QUERY",
        400,
    );
});

test("parses question and audit filters without producing SQL fragments", () => {
    const questions = parseQuestionListQuery({
        status: "published,archived",
        origin: "system",
        revisionStatus: "published,superseded",
        reviewStatus: "approved,changes_requested",
        bankId: PLAN_ID,
        subjectId: QUESTION_ID,
        gradeId: REVISION_ID,
        semesterId: DRAFT_ID,
        bookVersionId: REQUEST_ID,
        publisherId: PLAN_ID,
        sourceCategoryId: QUESTION_ID,
        difficultyId: REVISION_ID,
        createdFrom: "2024-02-29",
        sort: "revisionNumber",
    });
    assert.deepEqual(questions.statuses, ["published", "archived"]);
    assert.deepEqual(questions.origins, ["system"]);
    assert.deepEqual(questions.revisionStatuses, ["published", "superseded"]);
    assert.deepEqual(questions.reviewStatuses, ["approved", "changes_requested"]);
    assert.equal(questions.bankId, PLAN_ID);
    assert.equal(questions.publisherId, PLAN_ID);
    assert.deepEqual(questions.orderBy, [
        { field: "revisionNumber", direction: "desc" },
        { field: "id", direction: "desc" },
    ]);

    const audits = parseAuditListQuery({
        action: "account_suspended,account_reactivated",
        targetType: "user,question_revision",
        occurredFrom: "2026-08-01",
        occurredTo: "2026-08-31",
    });
    assert.deepEqual(audits.actions, ["account_suspended", "account_reactivated"]);
    assert.deepEqual(audits.targetTypes, ["user", "question_revision"]);
    assert.deepEqual(audits.occurred, { from: "2026-08-01", to: "2026-08-31" });

    assertAdminError(
        () => parseAuditListQuery({ action: "valid,drop table audit" }),
        "INVALID_QUERY",
    );
    assertAdminError(
        () => parseQuestionListQuery({ revisionStatus: "published;drop table questions" }),
        "INVALID_QUERY",
    );
    assertAdminError(
        () => parseQuestionListQuery({ bankId: "not-a-uuid" }),
        "INVALID_QUERY",
    );
});

test("parses bounded question revision history and selected revision", () => {
    const detail = parseQuestionDetailQuery({
        revision: REVISION_ID.toUpperCase(),
        revisionPage: "3",
        revisionPageSize: "20",
    });
    assert.deepEqual(detail, {
        selectedRevisionId: REVISION_ID,
        revisionPage: 3,
        revisionPageSize: 20,
        revisionOffset: 40,
        revisionLimit: 20,
    });
    assert.equal(parseQuestionDetailQuery({}).revisionPageSize, ADMIN_DEFAULT_REVISION_PAGE_SIZE);
    assertAdminError(
        () => parseQuestionDetailQuery({ revisionPageSize: "26" }),
        "INVALID_QUERY",
    );
    assertAdminError(
        () => parseQuestionDetailQuery(new URLSearchParams("revisionPage=1&revisionPage=2")),
        "INVALID_QUERY",
    );
});

test("validates calendar dates and rejects reversed query ranges", () => {
    assert.equal(parseDateOnly("2024-02-29"), "2024-02-29");
    for (const value of ["2023-02-29", "2026-13-01", "2026-00-10", "2026-01-00", "16/10/2026"]) {
        assertAdminError(() => parseDateOnly(value), "INVALID_INPUT");
    }
    assertAdminError(
        () => parseAccountListQuery({ createdFrom: "2026-10-17", createdTo: "2026-10-16" }),
        "INVALID_QUERY",
    );
});

test("validates canonical UUIDs", () => {
    assert.equal(parseUuid(REQUEST_ID.toUpperCase()), REQUEST_ID);

    for (const value of [null, "1111", `${REQUEST_ID} OR TRUE`]) {
        assertAdminError(() => parseUuid(value), "INVALID_UUID");
    }
});

test("rejects invalid, uppercase and non-v4-v7 mutation evidence", () => {
    const body = {
        expectedCurrentStatus: "active",
        targetStatus: "suspended",
        reason: "人工檢查期間暫停",
    };
    for (const requestId of [
        "not-a-uuid",
        "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
        "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
    ]) {
        assertAdminError(
            () => parseAccountStatusTransitionInput(body, {
                ...MUTATION_EVIDENCE,
                requestId,
            }),
            "INVALID_INPUT",
            422,
        );
    }
    for (const idempotencyKey of [
        "not-a-uuid",
        IDEMPOTENCY_KEY.toUpperCase(),
        "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
    ]) {
        assertAdminError(
            () => parseAccountStatusTransitionInput(body, {
                ...MUTATION_EVIDENCE,
                idempotencyKey,
            }),
            "INVALID_IDEMPOTENCY_KEY",
            422,
        );
    }
});

test("allows only explicit active and suspended account transitions with evidence", () => {
    assert.deepEqual(
        parseAccountStatusTransitionInput({
            expectedCurrentStatus: "active",
            targetStatus: "suspended",
            reason: "  重複登入異常，暫時停用  ",
        }, MUTATION_EVIDENCE),
        {
            expectedCurrentStatus: "active",
            targetStatus: "suspended",
            reason: "重複登入異常,暫時停用",
            requestId: REQUEST_ID,
            idempotencyKey: IDEMPOTENCY_KEY,
        },
    );

    assertAdminError(
        () => parseAccountStatusTransitionInput({
            expectedCurrentStatus: "closed",
            targetStatus: "active",
            reason: "嘗試重新開啟帳號",
        }, MUTATION_EVIDENCE),
        "INVALID_STATUS_TRANSITION",
    );
    assertAdminError(
        () => parseAccountStatusTransitionInput({
            expectedCurrentStatus: "active",
            targetStatus: "active",
            reason: "重複送出相同狀態",
        }, MUTATION_EVIDENCE),
        "INVALID_STATUS_TRANSITION",
        409,
    );
});

test("rejects attempts to submit admin grants, verification or trusted actors", () => {
    const base = {
        expectedCurrentStatus: "active",
        targetStatus: "suspended",
        reason: "人工檢查期間暫停",
    };
    for (const forbidden of [
        { isSystemAdmin: true },
        { role: "system_admin" },
        { verifiedAt: "2026-10-16T00:00:00Z" },
        { actorUserId: REQUEST_ID },
    ]) {
        assertAdminError(
            () => parseAccountStatusTransitionInput(
                { ...base, ...forbidden },
                MUTATION_EVIDENCE,
            ),
            "INVALID_STATUS_TRANSITION",
        );
    }
});

test("every mutation parser rejects request evidence supplied in the body", () => {
    const cases: ReadonlyArray<{
        errorCode: string;
        parse: (extra: Record<string, string>) => unknown;
    }> = [
        {
            errorCode: "INVALID_STATUS_TRANSITION",
            parse: (extra) => parseAccountStatusTransitionInput({
                expectedCurrentStatus: "active",
                targetStatus: "suspended",
                reason: "人工檢查期間暫停",
                ...extra,
            }, MUTATION_EVIDENCE),
        },
        {
            errorCode: "INVALID_SUBSCRIPTION_PLAN",
            parse: (extra) => parseSubscriptionPlanInput({
                code: "family_plus",
                name: "家庭進階方案",
                description: null,
                status: "draft",
                ...extra,
            }, MUTATION_EVIDENCE),
        },
        {
            errorCode: "INVALID_SUBSCRIPTION_PRICE",
            parse: (extra) => parseSubscriptionPriceInput({
                planId: PLAN_ID,
                currency: "TWD",
                amountMinor: 29900,
                billingInterval: "month",
                billingIntervalCount: 1,
                status: "draft",
                effectiveFrom: null,
                effectiveUntil: null,
                ...extra,
            }, MUTATION_EVIDENCE),
        },
        {
            errorCode: "INVALID_FEATURE_LIMIT",
            parse: (extra) => parseSubscriptionFeatureLimitInput({
                planId: PLAN_ID,
                featureKey: "learners_per_account",
                included: true,
                unlimited: false,
                limit: 3,
                ...extra,
            }, MUTATION_EVIDENCE),
        },
        {
            errorCode: "INVALID_QUESTION_REVISION",
            parse: (extra) => parseQuestionDraftInput({
                questionId: QUESTION_ID,
                baseRevisionId: REVISION_ID,
                baseRevisionNumber: 3,
                changeNote: "修正題目內容與答案",
                ...extra,
            }, MUTATION_EVIDENCE),
        },
        {
            errorCode: "INVALID_QUESTION_REVISION",
            parse: (extra) => parseQuestionRevisionMutationInput({
                questionId: QUESTION_ID,
                draftRevisionId: DRAFT_ID,
                expectedCurrentRevisionId: REVISION_ID,
                expectedCurrentRevisionNumber: 3,
                changeNote: "補齊來源與答案說明",
                ...extra,
            }, MUTATION_EVIDENCE),
        },
    ];

    for (const { errorCode, parse } of cases) {
        assertAdminError(
            () => parse({ requestId: REQUEST_ID }),
            errorCode,
        );
        assertAdminError(
            () => parse({ idempotencyKey: IDEMPOTENCY_KEY }),
            errorCode,
        );
    }
});

test("parses catalog-only subscription plans and rejects payment-provider fields", () => {
    assert.deepEqual(
        parseSubscriptionPlanInput({
            code: "family_plus",
            name: " 家庭進階方案 ",
            description: "最多三位學習者",
            status: "draft",
        }, MUTATION_EVIDENCE),
        {
            code: "family_plus",
            name: "家庭進階方案",
            description: "最多三位學習者",
            status: "draft",
            requestId: REQUEST_ID,
            idempotencyKey: IDEMPOTENCY_KEY,
        },
    );

    for (const input of [
        { code: "Family Plus" },
        { code: "family_plus", providerProductId: "prod_live" },
        { code: "family_plus", revenue: 1000 },
    ]) {
        assertAdminError(
            () => parseSubscriptionPlanInput({
                name: "家庭方案",
                description: null,
                status: "draft",
                ...input,
            }, MUTATION_EVIDENCE),
            "INVALID_SUBSCRIPTION_PLAN",
        );
    }
});

test("validates ISO uppercase currencies, integer minor units and price periods", () => {
    assert.deepEqual(
        parseSubscriptionPriceInput({
            planId: PLAN_ID,
            currency: "TWD",
            amountMinor: 29900,
            billingInterval: "month",
            billingIntervalCount: 1,
            status: "draft",
            effectiveFrom: "2026-11-01",
            effectiveUntil: null,
        }, MUTATION_EVIDENCE),
        {
            planId: PLAN_ID,
            currency: "TWD",
            amountMinor: 29900,
            billingInterval: "month",
            billingIntervalCount: 1,
            status: "draft",
            effectiveFrom: "2026-11-01",
            effectiveUntil: null,
            requestId: REQUEST_ID,
            idempotencyKey: IDEMPOTENCY_KEY,
        },
    );

    for (const currency of ["ZWG", "XCG", "VED"]) {
        assert.equal(
            parseSubscriptionPriceInput({
                planId: PLAN_ID,
                currency,
                amountMinor: 100,
                billingInterval: "month",
                billingIntervalCount: 1,
                status: "draft",
                effectiveFrom: null,
                effectiveUntil: null,
            }, MUTATION_EVIDENCE).currency,
            currency,
        );
    }

    const base = {
        planId: PLAN_ID,
        currency: "TWD",
        amountMinor: 0,
        billingInterval: "month",
        billingIntervalCount: 1,
        status: "draft",
        effectiveFrom: null,
        effectiveUntil: null,
    };
    for (const invalid of [
        { currency: "twd" },
        { currency: "ZZZ" },
        { currency: "BGN" },
        { currency: "ZWL" },
        { amountMinor: 99.5 },
        { amountMinor: -1 },
        { billingInterval: "forever" },
        { billingIntervalCount: 0 },
        { billingIntervalCount: 366 },
        { effectiveFrom: "2026-12-01", effectiveUntil: "2026-11-30" },
        { amount: 299.0 },
    ]) {
        assertAdminError(
            () => parseSubscriptionPriceInput(
                { ...base, ...invalid },
                MUTATION_EVIDENCE,
            ),
            "INVALID_SUBSCRIPTION_PRICE",
        );
    }
});

test("requires coherent included, finite and unlimited feature limits", () => {
    assert.deepEqual(
        parseSubscriptionFeatureLimitInput({
            planId: PLAN_ID,
            featureKey: "learners_per_account",
            included: true,
            unlimited: false,
            limit: 3,
        }, MUTATION_EVIDENCE),
        {
            planId: PLAN_ID,
            featureKey: "learners_per_account",
            included: true,
            unlimited: false,
            limit: 3,
            ...MUTATION_EVIDENCE,
        },
    );
    assert.deepEqual(
        parseSubscriptionFeatureLimitInput({
            planId: PLAN_ID,
            featureKey: "practice_sessions",
            included: true,
            unlimited: true,
            limit: null,
        }, MUTATION_EVIDENCE).limit,
        null,
    );

    for (const invalid of [
        { included: false, unlimited: true, limit: null },
        { included: false, unlimited: false, limit: 0 },
        { included: true, unlimited: true, limit: 1 },
        { included: true, unlimited: false, limit: null },
        { included: true, unlimited: false, limit: -1 },
    ]) {
        assertAdminError(
            () => parseSubscriptionFeatureLimitInput({
                planId: PLAN_ID,
                featureKey: "practice_sessions",
                ...invalid,
            }, MUTATION_EVIDENCE),
            "INVALID_FEATURE_LIMIT",
        );
    }
});

test("requires immutable base revision evidence and a meaningful change note", () => {
    assert.deepEqual(
        parseQuestionDraftInput({
            questionId: QUESTION_ID,
            baseRevisionId: REVISION_ID,
            baseRevisionNumber: 3,
            changeNote: "修正標準答案與解析",
        }, MUTATION_EVIDENCE),
        {
            questionId: QUESTION_ID,
            baseRevisionId: REVISION_ID,
            baseRevisionNumber: 3,
            changeNote: "修正標準答案與解析",
            requestId: REQUEST_ID,
            idempotencyKey: IDEMPOTENCY_KEY,
        },
    );

    const mutation = parseQuestionRevisionMutationInput({
        questionId: QUESTION_ID,
        draftRevisionId: DRAFT_ID,
        expectedCurrentRevisionId: REVISION_ID,
        expectedCurrentRevisionNumber: 3,
        changeNote: "補齊來源與答案說明",
    }, MUTATION_EVIDENCE);
    assert.equal(mutation.expectedCurrentRevisionId, REVISION_ID);
    assert.equal(mutation.expectedCurrentRevisionNumber, 3);

    const base = {
        questionId: QUESTION_ID,
        baseRevisionId: REVISION_ID,
        baseRevisionNumber: 3,
        changeNote: "修正題目內容與答案",
    };
    for (const invalid of [
        { baseRevisionNumber: 0 },
        { changeNote: "短" },
        { ownerUserId: REQUEST_ID },
        { createdByUserId: REQUEST_ID },
        { status: "published" },
        { origin: "system" },
    ]) {
        assertAdminError(
            () => parseQuestionDraftInput(
                { ...base, ...invalid },
                MUTATION_EVIDENCE,
            ),
            "INVALID_QUESTION_REVISION",
        );
    }
});

test("serializes only safe API errors and hides unknown failures", () => {
    assert.deepEqual(
        new AdminApiError("FORBIDDEN", "沒有後台權限。", 403, REQUEST_ID).toBody(),
        {
            error: {
                code: "FORBIDDEN",
                message: "沒有後台權限。",
                requestId: REQUEST_ID,
            },
        },
    );
    assert.deepEqual(toAdminApiErrorBody(new Error("password_hash=secret")), {
        error: {
            code: "INTERNAL_ERROR",
            message: "系統暫時無法完成操作，請稍後再試。",
        },
    });
});
