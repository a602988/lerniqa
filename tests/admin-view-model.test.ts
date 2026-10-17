import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    adminViewErrorMessage,
    buildAccountsViewModel,
    buildAuditViewModel,
    buildDashboardViewModel,
    buildQuestionsViewModel,
    buildQuestionReviewQueueViewModel,
    buildReportsViewModel,
    formatAdminDateTime,
    mapAccountDetail,
    mapQuestionDetail,
    parseAdminReportRange,
    readAdminDetailId,
    resolveAdminReportQuery,
} from "../app/lib/admin/admin-view-model.ts";
import type { AdminAccountDetail } from "../app/lib/admin/account-repository.ts";
import type { AdminAuditListItem } from "../app/lib/admin/audit-repository.ts";
import type {
    AdminQuestionDetail,
    AdminQuestionListItem,
    AdminQuestionReviewQueuePage,
} from "../app/lib/admin/question-repository.ts";
import { AdminApiError } from "../app/lib/admin/admin-types.ts";
import type {
    AccountListQuery,
    AuditListQuery,
    QuestionListQuery,
    QuestionReviewQueueQuery,
} from "../app/lib/admin/admin-types.ts";

const accountQuery: AccountListQuery = {
    page: 2,
    pageSize: 25,
    offset: 25,
    limit: 25,
    search: "王 小明",
    statuses: ["active"],
    accountRoles: ["learner"],
    roles: ["system_admin"],
    verificationStates: ["not_applicable"],
    created: { from: "2026-10-01", to: "2026-10-15" },
    orderBy: [
        { field: "email", direction: "asc" },
        { field: "id", direction: "asc" },
    ],
};

const accountDetail: AdminAccountDetail = {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "王小明",
    email: null,
    emailVerificationState: "not_applicable",
    status: "active",
    accountRole: "learner",
    roles: ["learner", "system_admin"],
    activeLearnerCount: 1,
    activeSessionCount: 1,
    createdAt: "2026-10-15T16:30:00.000Z",
    updatedAt: "2026-10-15T17:00:00.000Z",
    closedAt: null,
    lastSessionSeenAt: "2026-10-15T17:00:00.000Z",
    identities: [
        {
            id: "identity-1",
            provider: "google",
            email: null,
            verifiedAt: null,
            createdAt: "2026-10-15T16:30:00.000Z",
            revokedAt: null,
        },
        {
            id: "identity-2",
            provider: "email",
            email: "old@example.test",
            verifiedAt: "2026-10-10T02:00:00.000Z",
            createdAt: "2026-10-01T00:00:00.000Z",
            revokedAt: "2026-10-14T03:00:00.000Z",
        },
    ],
    roleGrants: [
        {
            id: "role-1",
            role: "system_admin",
            grantedAt: "2026-10-15T16:40:00.000Z",
            revokedAt: null,
            active: true,
        },
    ],
    learnerAccess: [
        {
            id: "access-1",
            learnerId: "learner-1",
            learnerDisplayName: "學習者 A",
            learnerStatus: "active",
            accessRole: "learner",
            gradeCode: "G7",
            gradeName: "七年級",
            semesterCode: null,
            semesterName: null,
            acceptedAt: "2026-10-15T16:45:00.000Z",
            revokedAt: null,
            canViewResults: true,
            canCreatePlans: false,
            canReviewAnswers: true,
            canManageSettings: false,
        },
        {
            id: "access-2",
            learnerId: "learner-2",
            learnerDisplayName: "學習者 B",
            learnerStatus: "archived",
            accessRole: "parent",
            gradeCode: null,
            gradeName: null,
            semesterCode: null,
            semesterName: null,
            acceptedAt: null,
            revokedAt: null,
            canViewResults: true,
            canCreatePlans: true,
            canReviewAnswers: false,
            canManageSettings: true,
        },
        {
            id: "access-3",
            learnerId: "learner-3",
            learnerDisplayName: "學習者 C",
            learnerStatus: "active",
            accessRole: "tutor",
            gradeCode: "G8",
            gradeName: "八年級",
            semesterCode: null,
            semesterName: null,
            acceptedAt: "2026-10-10T00:00:00.000Z",
            revokedAt: "2026-10-12T00:00:00.000Z",
            canViewResults: true,
            canCreatePlans: true,
            canReviewAnswers: true,
            canManageSettings: false,
        },
    ],
};

const auditItem: AdminAuditListItem = {
    id: "77777777-7777-4777-8777-777777777777",
    actor: {
        type: "user",
        userId: "88888888-8888-4888-8888-888888888888",
        displayName: "管理員甲",
    },
    action: "account_suspended",
    targetType: "user",
    targetId: "11111111-1111-4111-8111-111111111111",
    before: null,
    after: null,
    requestId: "request-1",
    occurredAt: "2026-10-15T16:30:00.000Z",
};

const questionQuery: QuestionListQuery = {
    page: 1,
    pageSize: 25,
    offset: 0,
    limit: 25,
    search: "分數",
    statuses: ["published"],
    origins: ["system"],
    revisionStatuses: ["published"],
    reviewStatuses: ["approved"],
    bankId: "33333333-3333-4333-8333-333333333333",
    subjectId: "44444444-4444-4444-8444-444444444444",
    created: {},
    orderBy: [
        { field: "revisionNumber", direction: "desc" },
        { field: "id", direction: "desc" },
    ],
};

const questionDetail: AdminQuestionDetail = {
    id: "22222222-2222-4222-8222-222222222222",
    origin: "system",
    status: "published",
    createdMethod: "import",
    currentRevisionId: "revision-2",
    currentRevisionNumber: 2,
    currentRevisionCreatedByUserId: "creator-1",
    owner: null,
    createdBy: { id: "creator-1", displayName: "匯入管理員" },
    createdAt: "2026-10-15T00:00:00.000Z",
    archivedAt: null,
    readOnly: false,
    readOnlyReason: null,
    identifiers: [
        {
            id: "identifier-1",
            type: "publisher",
            value: "CH4-279",
            publisherName: "出版社",
            bookVersionName: "版本 A",
            sourceDocumentId: "document-1",
        },
    ],
    selectedRevisionId: null,
    displayRevision: {
            id: "revision-2",
            number: 2,
            status: "published",
            originalQuestionTypeLabel: "選擇題",
            searchText: "題幹搜尋文字",
            changeNote: "修正答案說明",
            questionType: { id: "type-1", code: "single", name: "單選題" },
            subject: { id: "subject-1", code: "chinese", name: "國文" },
            grade: { id: "grade-1", code: "G7", name: "七年級" },
            semester: null,
            bookVersion: { id: "book-1", name: "版本 A" },
            examLevel: null,
            difficulty: null,
            sourceCategory: null,
            createdBy: { type: "user", userId: "creator-1", displayName: "編修者" },
            createdAt: "2026-10-15T01:00:00.000Z",
            publishedAt: "2026-10-15T02:00:00.000Z",
            parts: [
                {
                    id: "part-1",
                    parentPartId: null,
                    stableKey: "main",
                    position: 1,
                    answerMode: "single",
                    gradingPolicy: "exact",
                    independentlyGradable: true,
                    options: [{ id: "option-a", key: "A", position: 1 }],
                    answers: [{ id: "answer-a", answerKey: "A", acceptedValue: null, position: 1 }],
                },
            ],
            contentBlocks: [
                {
                    id: "block-1",
                    questionPartId: null,
                    questionOptionId: null,
                    parentBlockId: null,
                    placement: "prompt",
                    contentType: "text",
                    position: 1,
                    textContent: "真實題幹",
                    assetId: "55555555-5555-4555-8555-555555555555",
                    altText: null,
                },
            ],
            sources: [
                {
                    id: "source-1",
                    documentId: "document-1",
                    inputType: "pdf",
                    originalFileName: "source.pdf",
                    documentTitle: "第四課題庫",
                    documentStatus: "ready",
                    sourcePage: 3,
                    sourceQuestionNumber: "12",
                    cropAssetId: "66666666-6666-4666-8666-666666666666",
                    primary: true,
                },
            ],
            reviews: [
                {
                    id: "review-1",
                    reviewerType: "user",
                    reviewerUserId: "reviewer-1",
                    reviewerDisplayName: "審核者",
                    decision: "approved",
                    reason: null,
                    fromStatus: "draft",
                    toStatus: "published",
                    createdAt: "2026-10-15T01:30:00.000Z",
                },
            ],
            classifications: {
                units: [{ id: "unit-1", code: "U4", name: "第四課", secret: "drop" }],
                topics: [],
                knowledgePoints: [],
                curriculumCodes: [],
                filterValues: [{ fieldKey: "lesson", normalizedValue: "4", sql: "drop" }],
            },
    },
    revisionHistory: {
        items: [
            {
                id: "revision-2",
                number: 2,
                status: "published",
                originalQuestionTypeLabel: "選擇題",
                searchText: "題幹搜尋文字",
                changeNote: "修正答案說明",
                questionType: { id: "type-1", code: "single", name: "單選題" },
                subject: { id: "subject-1", code: "chinese", name: "國文" },
                grade: { id: "grade-1", code: "G7", name: "七年級" },
                semester: null,
                bookVersion: { id: "book-1", name: "版本 A" },
                examLevel: null,
                difficulty: null,
                sourceCategory: null,
                createdBy: { type: "user", userId: "creator-1", displayName: "編修者" },
                createdAt: "2026-10-15T01:00:00.000Z",
                publishedAt: "2026-10-15T02:00:00.000Z",
            },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
    },
};

describe("admin view model", () => {
    it("formats all timestamps in the declared Taipei timezone", () => {
        assert.equal(formatAdminDateTime("2026-10-15T16:30:00.000Z"), "2026/10/16 00:30");
    });

    it("maps users.account_role directly and preserves a missing value", () => {
        const detail = mapAccountDetail(accountDetail);
        assert.equal(detail.accountRole, "learner");
        assert.equal(detail.emailVerificationState, "not_applicable");
        assert.equal(
            mapAccountDetail({ ...accountDetail, accountRole: null }).accountRole,
            null,
        );
        assert.deepEqual(detail.identities[0]?.verificationState, "not_applicable");
        assert.equal(detail.identities[0]?.lifecycleState, "active");
        assert.equal(detail.identities[0]?.providerLabel, "Google");
        assert.deepEqual(detail.identities[1], {
            id: "identity-2",
            providerLabel: "電子郵件",
            identifier: "old@example.test",
            lifecycleState: "revoked",
            verificationState: "verified",
            verifiedAt: "2026/10/10 10:00",
            revokedAt: "2026/10/14 11:00",
        });
        assert.deepEqual(detail.learnerAccess[0]?.permissions, {
            canViewResults: true,
            canCreatePlans: false,
            canReviewAnswers: true,
            canManageSettings: false,
        });
        assert.equal(detail.learnerAccess[0]?.accessState, "accepted");
        assert.equal(detail.learnerAccess[0]?.learnerStatus, "active");
        assert.equal(detail.learnerAccess[0]?.effective, true);
        assert.equal(detail.learnerAccess[1]?.accessState, "pending");
        assert.equal(detail.learnerAccess[1]?.learnerStatus, "archived");
        assert.equal(detail.learnerAccess[1]?.effective, false);
        assert.equal(detail.learnerAccess[2]?.accessState, "revoked");
        assert.equal(detail.learnerAccess[2]?.effective, false);
    });

    it("preserves account filters, sorting and pagination in detail URLs", () => {
        const view = buildAccountsViewModel({
            query: accountQuery,
            page: {
                items: [accountDetail],
                page: 2,
                pageSize: 25,
                total: 31,
            },
            detail: accountDetail,
        });
        const href = new URL(view.rows[0]!.detailHref, "https://example.test");
        assert.equal(href.searchParams.get("search"), "王 小明");
        assert.equal(href.searchParams.get("status"), "active");
        assert.equal(href.searchParams.get("accountRole"), "learner");
        assert.equal(href.searchParams.get("role"), "system_admin");
        assert.equal(href.searchParams.get("verification"), "not_applicable");
        assert.equal(href.searchParams.get("createdFrom"), "2026-10-01");
        assert.equal(href.searchParams.get("page"), "2");
        assert.equal(href.searchParams.get("perPage"), "25");
        assert.equal(href.searchParams.get("sort"), "email");
        assert.equal(href.searchParams.get("direction"), "asc");
        assert.equal(href.searchParams.get("account"), accountDetail.id);
        assert.deepEqual(view.filters.dates, [
            {
                name: "createdFrom",
                label: "註冊起日",
                value: "2026-10-01",
                max: "2026-10-15",
            },
            {
                name: "createdTo",
                label: "註冊迄日",
                value: "2026-10-15",
                min: "2026-10-01",
            },
        ]);
        assert.equal("createdFrom" in (view.filters.hiddenFields ?? {}), false);
        assert.equal("createdTo" in (view.filters.hiddenFields ?? {}), false);
        const statusFilter = view.filters.selects?.find(
            (filter) => filter.name === "status",
        );
        assert.equal(
            statusFilter?.options.find((option) => option.value === "suspended")?.label,
            "已停權",
        );
    });

    it("treats date-only audit queries as filtered and uses shared localized labels", () => {
        const query: AuditListQuery = {
            page: 1,
            pageSize: 25,
            offset: 0,
            limit: 25,
            search: undefined,
            actions: [],
            targetTypes: [],
            occurred: { from: "2026-10-01", to: "2026-10-15" },
            orderBy: [{ field: "occurredAt", direction: "desc" }],
        };
        const view = buildAuditViewModel({
            query,
            page: { items: [auditItem], page: 1, pageSize: 25, total: 1 },
        });

        assert.equal(view.hasActiveFilters, true);
        assert.deepEqual(view.filters.dates, [
            {
                name: "occurredFrom",
                label: "發生起日",
                value: "2026-10-01",
                max: "2026-10-15",
            },
            {
                name: "occurredTo",
                label: "發生迄日",
                value: "2026-10-15",
                min: "2026-10-01",
            },
        ]);
        assert.equal("occurredFrom" in (view.filters.hiddenFields ?? {}), false);
        assert.equal("occurredTo" in (view.filters.hiddenFields ?? {}), false);
        assert.equal(view.rows[0]?.actionLabel, "帳號已停權");
        assert.equal(view.rows[0]?.targetTypeLabel, "帳號");
    });

    it("routes period metrics to reports and shares audit labels with recent activity", () => {
        const view = buildDashboardViewModel({
            accountTotal: 12,
            questionTotal: 279,
            recentAudit: [auditItem],
        });

        assert.equal(view.metrics[2]?.value.state, "report_only");
        assert.match(view.metrics[2]?.value.reason ?? "", /查看報表/u);
        assert.equal(view.metrics[3]?.value.state, "report_only");
        assert.equal(view.activity[0]?.title, "帳號已停權");
        assert.match(view.activity[0]?.description ?? "", /^帳號 · /u);
        assert.equal(view.activity[0]?.occurredAtIso, auditItem.occurredAt);
        assert.ok(view.quickLinks?.some((link) => link.href === "/admin/reports"));
    });

    it("maps every question evidence collection and strips unknown classification fields", () => {
        const detail = mapQuestionDetail(questionDetail, undefined, "reviewer-2");
        const revision = detail.displayRevision!;
        assert.equal(revision.parts[0]?.answers[0]?.answerKey, "A");
        assert.equal(revision.contentBlocks[0]?.textContent, "真實題幹");
        assert.equal(
            revision.contentBlocks[0]?.assetUrl,
            "/api/v1/admin/assets/55555555-5555-4555-8555-555555555555",
        );
        assert.equal(revision.sources[0]?.documentTitle, "第四課題庫");
        assert.equal(
            revision.sources[0]?.cropAssetUrl,
            "/api/v1/admin/assets/66666666-6666-4666-8666-666666666666",
        );
        assert.equal(revision.reviews[0]?.decision, "approved");
        assert.equal(revision.classifications.units[0]?.name, "第四課");
        assert.equal("secret" in revision.classifications.units[0]!, false);
        assert.equal("sql" in revision.classifications.filterValues[0]!, false);
        assert.deepEqual(detail.accessPolicy, {
            mode: "editable",
            label: "建立修正版",
            href: "#question-version-workflow",
            reason: "編修會複製目前發布版本成新草稿，不會覆寫歷史作答引用的內容。",
            canReviewDraft: false,
            canPublishDraft: false,
        });
        const historyHref = new URL(
            detail.revisionHistory.items[0]!.detailHref,
            "https://example.test",
        );
        assert.equal(historyHref.searchParams.get("question"), questionDetail.id);
        assert.equal(historyHref.searchParams.get("revision"), "revision-2");
    });

    it("keeps account, archived and non-current question revisions out of mutation UI", () => {
        const account = mapQuestionDetail({
            ...questionDetail,
            origin: "account",
            readOnly: true,
            readOnlyReason: "帳號題目不可跨帳號改寫。",
        }, undefined, "reviewer-2");
        assert.deepEqual(account.accessPolicy, {
            mode: "read-only",
            reason: "帳號題目不可跨帳號改寫。",
        });

        const archived = mapQuestionDetail({
            ...questionDetail,
            status: "archived",
        }, undefined, "reviewer-2");
        assert.equal(archived.accessPolicy.mode, "read-only");

        const historical = mapQuestionDetail({
            ...questionDetail,
            displayRevision: {
                ...questionDetail.displayRevision!,
                id: "revision-1",
                number: 1,
                status: "superseded",
            },
        }, undefined, "reviewer-2");
        assert.equal(historical.accessPolicy.mode, "read-only");
    });

    it("requires a different administrator before exposing draft review actions", () => {
        const draftQuestion = {
            ...questionDetail,
            selectedRevisionId: "revision-3",
            displayRevision: {
                ...questionDetail.displayRevision!,
                id: "revision-3",
                number: 3,
                status: "draft" as const,
                createdBy: {
                    type: "user",
                    userId: "draft-author",
                    displayName: "草稿建立者",
                },
            },
        };
        const authorView = mapQuestionDetail(draftQuestion, undefined, "draft-author");
        assert.equal(authorView.accessPolicy.mode, "editable");
        if (authorView.accessPolicy.mode === "editable") {
            assert.equal(authorView.accessPolicy.canReviewDraft, false);
            assert.equal(authorView.accessPolicy.canPublishDraft, false);
            assert.match(authorView.accessPolicy.reviewBlockedReason ?? "", /不可審核/u);
            assert.match(authorView.accessPolicy.publishBlockedReason ?? "", /不可發布/u);
        }

        const reviewerView = mapQuestionDetail(draftQuestion, undefined, "reviewer-2");
        assert.equal(reviewerView.accessPolicy.mode, "editable");
        if (reviewerView.accessPolicy.mode === "editable") {
            assert.equal(reviewerView.accessPolicy.canReviewDraft, true);
            assert.equal(reviewerView.accessPolicy.canPublishDraft, true);
        }

        const currentAuthorView = mapQuestionDetail(
            draftQuestion,
            undefined,
            questionDetail.currentRevisionCreatedByUserId,
        );
        assert.equal(currentAuthorView.accessPolicy.mode, "editable");
        if (currentAuthorView.accessPolicy.mode === "editable") {
            assert.equal(currentAuthorView.accessPolicy.canReviewDraft, true);
            assert.equal(currentAuthorView.accessPolicy.canPublishDraft, false);
            assert.match(
                currentAuthorView.accessPolicy.publishBlockedReason ?? "",
                /目前發布版本由你建立/u,
            );
        }
    });

    it("keeps question list filters in drawer and sorting links", () => {
        const item: AdminQuestionListItem = {
            id: questionDetail.id,
            origin: "system",
            status: "published",
            createdMethod: "import",
            owner: null,
            currentRevision: {
                id: "revision-2",
                number: 2,
                status: "published",
                promptPreview: "真實題幹",
                questionType: { code: "single", name: "單選題" },
                subject: null,
                grade: null,
                difficulty: null,
                publishedAt: "2026-10-15T02:00:00.000Z",
            },
            revisionCount: 2,
            sourceCount: 1,
            banks: [
                {
                    id: "33333333-3333-4333-8333-333333333333",
                    name: "系統題庫",
                    origin: "system",
                    status: "active",
                },
            ],
            createdAt: "2026-10-15T00:00:00.000Z",
            readOnly: false,
            readOnlyReason: null,
        };
        const view = buildQuestionsViewModel({
            query: questionQuery,
            page: { items: [item], page: 1, pageSize: 25, total: 1 },
            detail: questionDetail,
        });
        const href = new URL(view.rows[0]!.detailHref, "https://example.test");
        assert.equal(href.searchParams.get("search"), "分數");
        assert.equal(href.searchParams.get("status"), "published");
        assert.equal(href.searchParams.get("origin"), "system");
        assert.equal(href.searchParams.get("revisionStatus"), "published");
        assert.equal(href.searchParams.get("reviewStatus"), "approved");
        assert.equal(href.searchParams.get("bankId"), questionQuery.bankId);
        assert.equal(href.searchParams.get("subjectId"), questionQuery.subjectId);
        assert.equal(href.searchParams.get("sort"), "revisionNumber");
        assert.equal(href.searchParams.get("question"), questionDetail.id);
        assert.equal(view.hasActiveFilters, true);
        assert.equal(view.reviewQueueHref, "/admin/questions/reviews");
        assert.ok(view.filters.selects?.some((filter) => filter.name === "difficultyId"));
        const revisionHref = new URL(
            view.detail!.revisionHistory.items[0]!.detailHref,
            "https://example.test",
        );
        assert.equal(revisionHref.searchParams.get("search"), "分數");
        assert.equal(revisionHref.searchParams.get("bankId"), questionQuery.bankId);
        assert.equal(revisionHref.searchParams.get("revision"), "revision-2");
    });

    it("maps the pending review queue to the selected draft without losing filters", () => {
        const queueQuery: QuestionReviewQueueQuery = {
            page: 2,
            pageSize: 10,
            offset: 10,
            limit: 10,
            search: "第四課",
            states: ["changes_requested"],
        };
        const queuePage: AdminQuestionReviewQueuePage = {
            page: 2,
            pageSize: 10,
            total: 12,
            items: [{
                questionId: questionDetail.id,
                questionStatus: "published",
                currentRevisionId: "revision-2",
                currentRevisionNumber: 2,
                draftRevisionId: "revision-3",
                draftRevisionNumber: 3,
                promptPreview: "第四課待審題目",
                changeNote: "修正參考答案",
                state: "changes_requested",
                latestReviewReason: "答案仍需校正",
                latestReviewAt: "2026-10-16T01:00:00.000Z",
                createdBy: {
                    type: "user",
                    userId: "draft-author",
                    displayName: "草稿建立者",
                },
                createdAt: "2026-10-16T00:00:00.000Z",
            }],
        };
        const view = buildQuestionReviewQueueViewModel({
            query: queueQuery,
            page: queuePage,
        });
        assert.equal(view.rows[0]?.reviewStateLabel, "已要求修改");
        const detailHref = new URL(
            view.rows[0]!.detailHref,
            "https://example.test",
        );
        assert.equal(detailHref.pathname, "/admin/questions");
        assert.equal(detailHref.searchParams.get("question"), questionDetail.id);
        assert.equal(detailHref.searchParams.get("revision"), "revision-3");
        assert.equal(view.filters.action, "/admin/questions/reviews");
        assert.equal(view.filters.search?.value, "第四課");
        assert.equal(view.filters.selects?.[0]?.value, "changes_requested");
        assert.equal(view.pagination.currentPage, 2);
        assert.equal(view.pagination.totalItems, 12);
        assert.equal(view.hasActiveFilters, true);
    });

    it("keeps a missing current revision null and marks a truly empty library", () => {
        const emptyQuery: QuestionListQuery = {
            ...questionQuery,
            search: undefined,
            statuses: [],
            origins: [],
            revisionStatuses: [],
            reviewStatuses: [],
            bankId: undefined,
            subjectId: undefined,
        };
        const item: AdminQuestionListItem = {
            id: questionDetail.id,
            origin: "system",
            status: "draft",
            createdMethod: "manual",
            owner: null,
            currentRevision: null,
            revisionCount: 0,
            sourceCount: 0,
            banks: [],
            createdAt: "2026-10-15T00:00:00.000Z",
            readOnly: false,
            readOnlyReason: null,
        };
        const withRow = buildQuestionsViewModel({
            query: emptyQuery,
            page: { items: [item], page: 1, pageSize: 25, total: 1 },
            detail: null,
        });
        assert.equal(withRow.rows[0]?.revisionNumber, null);
        assert.equal(withRow.rows[0]?.prompt, "尚無目前版本內容");
        const empty = buildQuestionsViewModel({
            query: emptyQuery,
            page: { items: [], page: 1, pageSize: 25, total: 0 },
            detail: null,
        });
        assert.equal(empty.hasActiveFilters, false);
    });

    it("keeps a failed report read explicit without fabricated values", () => {
        const query = resolveAdminReportQuery(
            "30d",
            new Date("2026-10-16T08:00:00.000Z"),
        );
        const report = buildReportsViewModel({
            range: "30d",
            query,
            report: null,
            errorMessage: "目前無法讀取管理資料，請稍後再試。",
        });
        assert.equal(report.state.kind, "error");
        assert.equal(report.registrationTrend.rows[0]?.value.state, "no_data");
        assert.equal(report.registrationTrend.rows[0]?.barPercent, null);
        assert.equal(report.generatedAt, null);
        assert.deepEqual(report.activity.metrics, []);
        assert.deepEqual(report.completion.metrics, []);
        assert.deepEqual(report.questionQuality.metrics, []);
    });

    it("rejects repeated detail and unsupported report range query values", () => {
        assert.throws(
            () => readAdminDetailId({ account: ["a", "b"] }, "account"),
            (error) => error instanceof AdminApiError && error.code === "INVALID_QUERY",
        );
        assert.throws(
            () => parseAdminReportRange({ range: "365d" }),
            (error) => error instanceof AdminApiError && error.code === "INVALID_QUERY",
        );
    });

    it("does not expose unexpected error messages", () => {
        assert.equal(
            adminViewErrorMessage(new Error("postgresql://secret@host/database")),
            "目前無法讀取管理資料，請稍後再試。",
        );
    });
});
