import type {
    AccountDetailDto,
    AccountRowDto,
    AccountsViewProps,
    AuditRowDto,
    AuditViewProps,
    DashboardActivityDto,
    DashboardViewProps,
    QuestionClassificationDto,
    QuestionDetailDto,
    QuestionReviewQueueViewProps,
    QuestionRevisionDto,
    QuestionRevisionSummaryDto,
    QuestionRowDto,
    QuestionsViewProps,
    ReportsViewProps,
    ReportSeriesDto,
    SubscriptionFeatureDefinitionDto,
    SubscriptionPlanDetailDto,
    SubscriptionPlansViewProps,
    ViewFilterOptionDto,
    ViewMetricDto,
    ViewMetricValueDto,
    ViewSortLinkDto,
} from "@/app/components/admin/views";

import type {
    AdminAccountDetail,
    AdminAccountPage,
} from "./account-repository.ts";
import type {
    AdminAuditListItem,
    AdminAuditPage,
} from "./audit-repository.ts";
import type {
    AdminQuestionDetail,
    AdminQuestionFilterOptions,
    AdminQuestionPage,
    AdminQuestionReviewQueuePage,
    AdminQuestionRevision,
    AdminQuestionRevisionSummary,
} from "./question-repository.ts";
import type {
    AdminReportDatasetState,
    AdminReportDistribution,
    AdminReportMetric,
    AdminReportQuery,
    AdminReportSnapshot,
} from "./report-repository.ts";
import type {
    AdminSubscriptionFeatureDefinition,
    AdminSubscriptionPlan,
    AdminSubscriptionPlanPage,
} from "./subscription-repository.ts";
import type {
    AccountListQuery,
    AdminSort,
    AuditListQuery,
    QuestionDetailQuery,
    QuestionListQuery,
    QuestionReviewQueueQuery,
    SubscriptionPlanListQuery,
} from "./admin-types.ts";
import { AdminApiError } from "./admin-types.ts";

export const ADMIN_VIEW_TIME_ZONE = "Asia/Taipei" as const;

export type AdminPageSearchParams = Record<
    string,
    string | string[] | undefined
>;

type SortDefinition<Field extends string> = {
    key: Field;
    label: string;
};

const ACCOUNT_STATUS_OPTIONS: readonly ViewFilterOptionDto[] = [
    { value: "", label: "全部狀態" },
    { value: "active", label: "啟用" },
    { value: "suspended", label: "已停權" },
    { value: "closed", label: "已關閉" },
];

const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
    account_status_changed: "變更帳號狀態",
    account_suspended: "帳號已停權",
    account_reactivated: "帳號已恢復",
    admin_role_granted: "授予管理員角色",
    admin_role_revoked: "撤銷管理員角色",
    system_question_revision_draft_created: "建立題目修正版草稿",
    system_question_revision_status_changed: "變更題目版本狀態",
    system_question_revision_reviewed: "審核題目版本",
    data_erasure_completed: "完成資料刪除",
    analytics_privacy_policy_changed: "變更統計隱私政策",
    subscription_plan_created: "建立訂閱方案",
    subscription_plan_updated: "更新訂閱方案",
    subscription_plan_activated: "啟用訂閱方案",
    subscription_plan_retired: "停用訂閱方案",
    subscription_price_created: "建立方案價格",
    subscription_price_updated: "更新方案價格",
    subscription_price_activated: "啟用方案價格",
    subscription_price_retired: "停用方案價格",
    subscription_feature_definition_created: "建立方案功能",
    subscription_feature_definition_updated: "更新方案功能",
    subscription_feature_definition_activated: "啟用方案功能",
    subscription_feature_definition_retired: "停用方案功能",
    subscription_feature_limit_set: "設定方案功能限制",
    subscription_feature_limit_updated: "更新方案功能限制",
};

const AUDIT_TARGET_TYPE_LABELS: Readonly<Record<string, string>> = {
    user: "帳號",
    user_role: "帳號角色",
    question: "題目",
    question_revision: "題目版本",
    data_subject: "資料主體",
    analytics_privacy_policy: "統計隱私政策",
    subscription_plan: "訂閱方案",
    subscription_plan_price: "方案價格",
    subscription_feature_definition: "方案功能",
    subscription_plan_feature_limit: "方案功能限制",
};

function auditActionLabel(action: string): string {
    return AUDIT_ACTION_LABELS[action] ?? action;
}

function auditTargetTypeLabel(targetType: string): string {
    return AUDIT_TARGET_TYPE_LABELS[targetType] ?? targetType;
}

const ACCOUNT_ROLE_OPTIONS: readonly ViewFilterOptionDto[] = [
    { value: "", label: "全部有效角色" },
    { value: "parent", label: "家長" },
    { value: "learner", label: "學習者" },
    { value: "tutor", label: "導師" },
    { value: "system_admin", label: "系統管理員" },
];

const ACCOUNT_IDENTITY_ROLE_OPTIONS: readonly ViewFilterOptionDto[] = [
    { value: "", label: "全部帳號身份" },
    { value: "parent", label: "家長" },
    { value: "learner", label: "學習者" },
    { value: "tutor", label: "導師" },
];

const ACCOUNT_VERIFICATION_OPTIONS: readonly ViewFilterOptionDto[] = [
    { value: "", label: "全部驗證狀態" },
    { value: "verified", label: "信箱已驗證" },
    { value: "unverified", label: "信箱未驗證" },
    { value: "not_applicable", label: "無有效信箱身份" },
];

const ACCOUNT_IDENTITY_PROVIDER_LABELS: Readonly<Record<string, string>> = {
    email: "電子郵件",
    google: "Google",
    line: "LINE",
    facebook: "Facebook",
};

const QUESTION_STATUS_OPTIONS: readonly ViewFilterOptionDto[] = [
    { value: "", label: "全部狀態" },
    { value: "draft", label: "草稿" },
    { value: "published", label: "已發布" },
    { value: "archived", label: "已封存" },
];

const QUESTION_ORIGIN_OPTIONS: readonly ViewFilterOptionDto[] = [
    { value: "", label: "全部來源範圍" },
    { value: "system", label: "系統題目" },
    { value: "account", label: "帳號題目" },
];

const QUESTION_REVISION_STATUS_OPTIONS: readonly ViewFilterOptionDto[] = [
    { value: "", label: "全部版本狀態" },
    { value: "draft", label: "草稿" },
    { value: "published", label: "已發布" },
    { value: "superseded", label: "已取代" },
    { value: "rejected", label: "已退回" },
];

const QUESTION_REVIEW_STATUS_OPTIONS: readonly ViewFilterOptionDto[] = [
    { value: "", label: "全部審核結果" },
    { value: "approved", label: "已核准" },
    { value: "rejected", label: "已退回" },
    { value: "changes_requested", label: "要求修改" },
];

const QUESTION_REVIEW_QUEUE_STATE_OPTIONS: readonly ViewFilterOptionDto[] = [
    { value: "", label: "全部待審狀態" },
    { value: "unreviewed", label: "尚未審核" },
    { value: "changes_requested", label: "已要求修改" },
];

const REPORT_RANGE_OPTIONS: readonly ViewFilterOptionDto[] = [
    { value: "7d", label: "最近 7 日" },
    { value: "30d", label: "最近 30 日" },
    { value: "90d", label: "最近 90 日" },
];

export type AdminReportRange = "7d" | "30d" | "90d";

function singleQueryValue(
    searchParams: AdminPageSearchParams,
    key: string,
): string | undefined {
    const value = searchParams[key];
    if (Array.isArray(value)) {
        if (value.length > 1) {
            throw new AdminApiError(
                "INVALID_QUERY",
                `查詢參數 ${key} 不可重複。`,
                400,
            );
        }
        return value[0];
    }
    return value;
}
export function readAdminDetailId(
    searchParams: AdminPageSearchParams,
    key: "account" | "question" | "plan",
): string | undefined {
    return singleQueryValue(searchParams, key);
}

export function parseAdminReportRange(
    searchParams: AdminPageSearchParams,
): AdminReportRange {
    const value = singleQueryValue(searchParams, "range") ?? "30d";
    if (value !== "7d" && value !== "30d" && value !== "90d") {
        throw new AdminApiError(
            "INVALID_QUERY",
            "報表期間只接受最近 7、30 或 90 日。",
            400,
        );
    }
    return value;
}

function toHref(pathname: string, params: URLSearchParams): string {
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
}

function accountQueryParams(query: AccountListQuery): URLSearchParams {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.statuses.length > 0) params.set("status", query.statuses.join(","));
    if (query.accountRoles.length > 0) {
        params.set("accountRole", query.accountRoles.join(","));
    }
    if (query.roles.length > 0) params.set("role", query.roles.join(","));
    if (query.verificationStates.length > 0) {
        params.set("verification", query.verificationStates.join(","));
    }
    if (query.created.from) params.set("createdFrom", query.created.from);
    if (query.created.to) params.set("createdTo", query.created.to);
    params.set("page", String(query.page));
    params.set("perPage", String(query.pageSize));
    const primarySort = query.orderBy[0];
    if (primarySort) {
        params.set("sort", primarySort.field);
        params.set("direction", primarySort.direction);
    }
    return params;
}

function questionQueryParams(query: QuestionListQuery): URLSearchParams {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.statuses.length > 0) params.set("status", query.statuses.join(","));
    if (query.origins.length > 0) params.set("origin", query.origins.join(","));
    if (query.revisionStatuses.length > 0) {
        params.set("revisionStatus", query.revisionStatuses.join(","));
    }
    if (query.reviewStatuses.length > 0) {
        params.set("reviewStatus", query.reviewStatuses.join(","));
    }
    const catalogFilters = {
        bankId: query.bankId,
        subjectId: query.subjectId,
        gradeId: query.gradeId,
        semesterId: query.semesterId,
        bookVersionId: query.bookVersionId,
        publisherId: query.publisherId,
        sourceCategoryId: query.sourceCategoryId,
        difficultyId: query.difficultyId,
    };
    for (const [key, value] of Object.entries(catalogFilters)) {
        if (value) params.set(key, value);
    }
    if (query.created.from) params.set("createdFrom", query.created.from);
    if (query.created.to) params.set("createdTo", query.created.to);
    params.set("page", String(query.page));
    params.set("perPage", String(query.pageSize));
    const primarySort = query.orderBy[0];
    if (primarySort) {
        params.set("sort", primarySort.field);
        params.set("direction", primarySort.direction);
    }
    return params;
}

function questionReviewQueueQueryParams(
    query: QuestionReviewQueueQuery,
): URLSearchParams {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.states.length > 0) {
        params.set("reviewState", query.states.join(","));
    }
    params.set("page", String(query.page));
    params.set("perPage", String(query.pageSize));
    return params;
}

function auditQueryParams(query: AuditListQuery): URLSearchParams {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.actions.length > 0) params.set("action", query.actions.join(","));
    if (query.targetTypes.length > 0) {
        params.set("targetType", query.targetTypes.join(","));
    }
    if (query.occurred.from) params.set("occurredFrom", query.occurred.from);
    if (query.occurred.to) params.set("occurredTo", query.occurred.to);
    params.set("page", String(query.page));
    params.set("perPage", String(query.pageSize));
    const primarySort = query.orderBy[0];
    if (primarySort) {
        params.set("sort", primarySort.field);
        params.set("direction", primarySort.direction);
    }
    return params;
}

function sortLinks<Field extends string>(
    pathname: string,
    base: URLSearchParams,
    current: readonly AdminSort<Field>[],
    definitions: readonly SortDefinition<Field>[],
): ViewSortLinkDto[] {
    const active = current[0];
    return definitions.map((definition) => {
        const selected = active?.field === definition.key;
        const nextDirection = selected && active.direction === "asc" ? "desc" : "asc";
        const params = new URLSearchParams(base);
        params.set("page", "1");
        params.set("sort", definition.key);
        params.set("direction", nextDirection);
        return {
            key: definition.key,
            label: definition.label,
            href: toHref(pathname, params),
            direction: selected ? active.direction : null,
        };
    });
}

function withCurrentMultiValue(
    options: readonly ViewFilterOptionDto[],
    values: readonly string[],
): ViewFilterOptionDto[] {
    const current = values.join(",");
    if (!current || options.some((option) => option.value === current)) {
        return [...options];
    }
    return [
        ...options,
        {
            value: current,
            label: `目前多重條件（${values.length}）`,
        },
    ];
}

export function formatAdminDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "無資料";
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: ADMIN_VIEW_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const valueOf = (type: Intl.DateTimeFormatPartTypes): string =>
        parts.find((part) => part.type === type)?.value ?? "--";
    return `${valueOf("year")}/${valueOf("month")}/${valueOf("day")} ${valueOf("hour")}:${valueOf("minute")}`;
}

function mapAccountRow(
    account: AdminAccountPage["items"][number],
    base: URLSearchParams,
): AccountRowDto {
    const detailParams = new URLSearchParams(base);
    detailParams.set("account", account.id);
    return {
        id: account.id,
        displayName: account.displayName,
        primaryEmail: account.email,
        emailVerificationState: account.emailVerificationState,
        status: account.status,
        accountRole: account.accountRole,
        activeRoles: account.roles,
        learnerCount: account.activeLearnerCount,
        createdAt: formatAdminDateTime(account.createdAt),
        detailHref: toHref("/admin/accounts", detailParams),
    };
}

function identityVerificationState(
    identity: AdminAccountDetail["identities"][number],
): "verified" | "unverified" | "not_applicable" {
    if (identity.provider !== "email" || identity.email === null) {
        return "not_applicable";
    }
    return identity.verifiedAt ? "verified" : "unverified";
}

export function mapAccountDetail(account: AdminAccountDetail): AccountDetailDto {
    return {
        id: account.id,
        displayName: account.displayName,
        primaryEmail: account.email,
        emailVerificationState: account.emailVerificationState,
        status: account.status,
        accountRole: account.accountRole,
        createdAt: formatAdminDateTime(account.createdAt),
        updatedAt: formatAdminDateTime(account.updatedAt),
        identities: account.identities.map((identity) => {
            const verificationState = identityVerificationState(identity);
            const revokedAt = identity.revokedAt
                ? formatAdminDateTime(identity.revokedAt)
                : null;
            return {
                id: identity.id,
                providerLabel: ACCOUNT_IDENTITY_PROVIDER_LABELS[identity.provider]
                    ?? identity.provider,
                identifier: identity.email ?? "未填",
                lifecycleState: revokedAt ? "revoked" : "active",
                verificationState,
                verifiedAt: verificationState === "verified" && identity.verifiedAt
                    ? formatAdminDateTime(identity.verifiedAt)
                    : null,
                revokedAt,
            };
        }),
        roles: account.roleGrants.map((grant) => ({
            id: grant.id,
            role: grant.role,
            grantedAt: formatAdminDateTime(grant.grantedAt),
            revokedAt: grant.revokedAt
                ? formatAdminDateTime(grant.revokedAt)
                : null,
        })),
        learnerAccess: account.learnerAccess.map((access) => {
            const acceptedAt = access.acceptedAt
                ? formatAdminDateTime(access.acceptedAt)
                : null;
            const revokedAt = access.revokedAt
                ? formatAdminDateTime(access.revokedAt)
                : null;
            const accessState = revokedAt
                ? "revoked" as const
                : acceptedAt
                  ? "accepted" as const
                  : "pending" as const;
            return {
                id: access.id,
                learnerName: access.learnerDisplayName,
                gradeLabel: access.gradeName ?? access.gradeCode,
                semesterLabel: access.semesterName ?? access.semesterCode,
                accessRole: access.accessRole,
                learnerStatus: access.learnerStatus,
                accessState,
                effective: accessState === "accepted" && access.learnerStatus === "active",
                acceptedAt,
                permissions: {
                    canViewResults: access.canViewResults,
                    canCreatePlans: access.canCreatePlans,
                    canReviewAnswers: access.canReviewAnswers,
                    canManageSettings: access.canManageSettings,
                },
                revokedAt,
            };
        }),
        statusPolicy: {
            mode: "locked",
            label: "需要當次確認",
            reason: "此頁只提供帳號狀態檢視。",
        },
        rolePolicy: {
            mode: "locked",
            label: "不可由此頁變更",
            reason: "角色與系統管理員授權屬安全異動，不會由帳號詳情直接升權或撤權。",
        },
    };
}

export function buildAccountsViewModel({
    query,
    page,
    detail,
    errorMessage,
}: {
    query: AccountListQuery;
    page: AdminAccountPage;
    detail: AdminAccountDetail | null;
    errorMessage?: string;
}): AccountsViewProps {
    const base = accountQueryParams(query);
    const closeParams = new URLSearchParams(base);
    closeParams.delete("account");
    const primarySort = query.orderBy[0];

    return {
        state: errorMessage
            ? { kind: "error", message: errorMessage, retryHref: toHref("/admin/accounts", base) }
            : { kind: "ready" },
        filters: {
            action: "/admin/accounts",
            search: {
                name: "search",
                label: "搜尋帳號",
                placeholder: "姓名、信箱或帳號 ID",
                value: query.search ?? "",
            },
            selects: [
                {
                    name: "status",
                    label: "狀態",
                    value: query.statuses.join(","),
                    options: withCurrentMultiValue(
                        ACCOUNT_STATUS_OPTIONS,
                        query.statuses,
                    ),
                },
                {
                    name: "accountRole",
                    label: "帳號身份",
                    value: query.accountRoles.join(","),
                    options: withCurrentMultiValue(
                        ACCOUNT_IDENTITY_ROLE_OPTIONS,
                        query.accountRoles,
                    ),
                },
                {
                    name: "role",
                    label: "有效角色",
                    value: query.roles.join(","),
                    options: withCurrentMultiValue(ACCOUNT_ROLE_OPTIONS, query.roles),
                },
                {
                    name: "verification",
                    label: "信箱驗證",
                    value: query.verificationStates.join(","),
                    options: withCurrentMultiValue(
                        ACCOUNT_VERIFICATION_OPTIONS,
                        query.verificationStates,
                    ),
                },
            ],
            dates: [
                {
                    name: "createdFrom",
                    label: "註冊起日",
                    value: query.created.from ?? "",
                    max: query.created.to,
                },
                {
                    name: "createdTo",
                    label: "註冊迄日",
                    value: query.created.to ?? "",
                    min: query.created.from,
                },
            ],
            hiddenFields: {
                perPage: String(query.pageSize),
                sort: primarySort?.field ?? "createdAt",
                direction: primarySort?.direction ?? "desc",
            },
            resetHref: "/admin/accounts",
        },
        sorts: sortLinks(
            "/admin/accounts",
            base,
            query.orderBy,
            [
                { key: "displayName", label: "帳號" },
                { key: "email", label: "主要信箱" },
                { key: "status", label: "狀態" },
                { key: "accountRole", label: "帳號身份" },
                { key: "createdAt", label: "註冊時間" },
            ],
        ),
        rows: errorMessage ? [] : page.items.map((item) => mapAccountRow(item, base)),
        pagination: {
            currentPage: page.page,
            pageSize: page.pageSize,
            totalItems: errorMessage ? 0 : page.total,
            pageSizeOptions: [10, 25, 50, 100],
        },
        detail: !errorMessage && detail ? mapAccountDetail(detail) : null,
        detailCloseHref: toHref("/admin/accounts", closeParams),
    };
}

function auditActorLabel(item: AdminAuditListItem): string {
    if (item.actor.displayName) return item.actor.displayName;
    return item.actor.userId
        ? `${item.actor.type}（${item.actor.userId}）`
        : item.actor.type;
}

function mapAuditRow(item: AdminAuditListItem): AuditRowDto {
    return {
        id: item.id,
        occurredAt: formatAdminDateTime(item.occurredAt),
        actorLabel: auditActorLabel(item),
        actionLabel: auditActionLabel(item.action),
        targetTypeLabel: auditTargetTypeLabel(item.targetType),
        targetLabel: item.targetId,
        requestId: item.requestId,
    };
}

export function buildAuditViewModel({
    query,
    page,
    errorMessage,
}: {
    query: AuditListQuery;
    page: AdminAuditPage;
    errorMessage?: string;
}): AuditViewProps {
    const base = auditQueryParams(query);
    const primarySort = query.orderBy[0];
    return {
        state: errorMessage
            ? { kind: "error", message: errorMessage, retryHref: toHref("/admin/audit", base) }
            : { kind: "ready" },
        filters: {
            action: "/admin/audit",
            search: {
                name: "search",
                label: "搜尋稽核紀錄",
                placeholder: "操作、目標、Request ID 或操作者",
                value: query.search ?? "",
            },
            dates: [
                {
                    name: "occurredFrom",
                    label: "發生起日",
                    value: query.occurred.from ?? "",
                    max: query.occurred.to,
                },
                {
                    name: "occurredTo",
                    label: "發生迄日",
                    value: query.occurred.to ?? "",
                    min: query.occurred.from,
                },
            ],
            hiddenFields: {
                ...(query.actions.length > 0 ? { action: query.actions.join(",") } : {}),
                ...(query.targetTypes.length > 0
                    ? { targetType: query.targetTypes.join(",") }
                    : {}),
                perPage: String(query.pageSize),
                sort: primarySort?.field ?? "occurredAt",
                direction: primarySort?.direction ?? "desc",
            },
            resetHref: "/admin/audit",
        },
        sorts: sortLinks(
            "/admin/audit",
            base,
            query.orderBy,
            [
                { key: "occurredAt", label: "發生時間" },
                { key: "action", label: "操作" },
                { key: "targetType", label: "目標類型" },
            ],
        ),
        rows: errorMessage ? [] : page.items.map(mapAuditRow),
        pagination: {
            currentPage: page.page,
            pageSize: page.pageSize,
            totalItems: errorMessage ? 0 : page.total,
            pageSizeOptions: [10, 25, 50, 100],
        },
        hasActiveFilters: Boolean(
            query.search
            || query.actions.length > 0
            || query.targetTypes.length > 0
            || query.occurred.from
            || query.occurred.to
        ),
    };
}

function mapQuestionRow(
    question: AdminQuestionPage["items"][number],
    base: URLSearchParams,
): QuestionRowDto {
    const detailParams = new URLSearchParams(base);
    detailParams.set("question", question.id);
    return {
        id: question.id,
        prompt: question.currentRevision?.promptPreview ?? "尚無目前版本內容",
        origin: question.origin,
        status: question.status,
        revisionNumber: question.currentRevision?.number ?? null,
        sourceLabel: question.sourceCount > 0
            ? `${question.sourceCount} 筆來源`
            : null,
        banks: question.banks.map((bank) => ({ ...bank })),
        createdAt: formatAdminDateTime(question.createdAt),
        detailHref: toHref("/admin/questions", detailParams),
    };
}

function safeClassificationValue(value: unknown): unknown {
    if (
        value === null
        || typeof value === "string"
        || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value))
    ) {
        return value;
    }
    return undefined;
}

function pickClassification(
    row: Readonly<Record<string, unknown>>,
    keys: readonly string[],
): QuestionClassificationDto {
    const safe: Record<string, unknown> = {};
    for (const key of keys) {
        const value = safeClassificationValue(row[key]);
        if (value !== undefined) safe[key] = value;
    }
    return safe;
}

const CATALOG_CLASSIFICATION_FIELDS = [
    "id",
    "code",
    "name",
    "assignmentType",
    "primary",
    "valueSource",
    "confidence",
] as const;

const FILTER_CLASSIFICATION_FIELDS = [
    "id",
    "fieldId",
    "fieldKey",
    "fieldName",
    "optionId",
    "optionValue",
    "optionLabel",
    "rawLabel",
    "rawValue",
    "normalizedValue",
    "valueSource",
    "confidence",
] as const;

function mapQuestionRevisionSummary(
    revision: AdminQuestionRevisionSummary,
): QuestionRevisionSummaryDto {
    return {
        id: revision.id,
        number: revision.number,
        status: revision.status,
        originalQuestionTypeLabel: revision.originalQuestionTypeLabel,
        searchText: revision.searchText,
        questionType: revision.questionType,
        subject: revision.subject,
        grade: revision.grade,
        semester: revision.semester,
        bookVersion: revision.bookVersion,
        examLevel: revision.examLevel,
        difficulty: revision.difficulty,
        sourceCategory: revision.sourceCategory,
        createdAt: formatAdminDateTime(revision.createdAt),
        publishedAt: revision.publishedAt
            ? formatAdminDateTime(revision.publishedAt)
            : null,
        createdBy: revision.createdBy,
        changeNote: revision.changeNote,
    };
}

function adminAssetUrl(assetId: string | null): string | null {
    return assetId === null ? null : `/api/v1/admin/assets/${assetId}`;
}

function mapQuestionRevision(
    revision: AdminQuestionRevision,
): QuestionRevisionDto {
    return {
        ...mapQuestionRevisionSummary(revision),
        parts: revision.parts.map((part) => ({
            id: part.id,
            parentPartId: part.parentPartId,
            stableKey: part.stableKey,
            position: part.position,
            answerMode: part.answerMode,
            gradingPolicy: part.gradingPolicy,
            independentlyGradable: part.independentlyGradable,
            options: part.options.map((option) => ({ ...option })),
            answers: part.answers.map((answer) => ({ ...answer })),
        })),
        contentBlocks: revision.contentBlocks.map((block) => ({
            ...block,
            assetUrl: adminAssetUrl(block.assetId),
        })),
        sources: revision.sources.map((source) => ({
            ...source,
            cropAssetUrl: adminAssetUrl(source.cropAssetId),
        })),
        reviews: revision.reviews.map((review) => ({
            ...review,
            createdAt: formatAdminDateTime(review.createdAt),
        })),
        classifications: {
            units: revision.classifications.units.map((row) =>
                pickClassification(row, CATALOG_CLASSIFICATION_FIELDS)),
            topics: revision.classifications.topics.map((row) =>
                pickClassification(row, CATALOG_CLASSIFICATION_FIELDS)),
            knowledgePoints: revision.classifications.knowledgePoints.map((row) =>
                pickClassification(row, CATALOG_CLASSIFICATION_FIELDS)),
            curriculumCodes: revision.classifications.curriculumCodes.map((row) =>
                pickClassification(row, CATALOG_CLASSIFICATION_FIELDS)),
            filterValues: revision.classifications.filterValues.map((row) =>
                pickClassification(row, FILTER_CLASSIFICATION_FIELDS)),
        },
    };
}

export function mapQuestionDetail(
    question: AdminQuestionDetail,
    listParams: URLSearchParams = new URLSearchParams(),
    actorUserId: string | null = null,
): QuestionDetailDto {
    const historyHref = (revisionId: string, revisionPage: number): string => {
        const params = new URLSearchParams(listParams);
        params.set("question", question.id);
        params.set("revision", revisionId);
        params.set("revisionPage", String(revisionPage));
        params.set("revisionPageSize", String(question.revisionHistory.pageSize));
        return toHref("/admin/questions", params);
    };
    const pageHref = (revisionPage: number): string => {
        const params = new URLSearchParams(listParams);
        params.set("question", question.id);
        if (question.selectedRevisionId) {
            params.set("revision", question.selectedRevisionId);
        }
        params.set("revisionPage", String(revisionPage));
        params.set("revisionPageSize", String(question.revisionHistory.pageSize));
        return toHref("/admin/questions", params);
    };
    const lastPage = Math.max(
        1,
        Math.ceil(question.revisionHistory.total / question.revisionHistory.pageSize),
    );
    const common = {
        id: question.id,
        status: question.status,
        createdMethod: question.createdMethod,
        currentRevisionId: question.currentRevisionId,
        currentRevisionNumber: question.currentRevisionNumber,
        owner: question.owner,
        createdBy: question.createdBy,
        createdAt: formatAdminDateTime(question.createdAt),
        archivedAt: question.archivedAt
            ? formatAdminDateTime(question.archivedAt)
            : null,
        identifiers: question.identifiers.map((identifier) => ({ ...identifier })),
        selectedRevisionId: question.selectedRevisionId,
        displayRevision: question.displayRevision
            ? mapQuestionRevision(question.displayRevision)
            : null,
        revisionHistory: {
            items: question.revisionHistory.items.map((revision) => ({
                ...mapQuestionRevisionSummary(revision),
                detailHref: historyHref(revision.id, question.revisionHistory.page),
            })),
            total: question.revisionHistory.total,
            page: question.revisionHistory.page,
            pageSize: question.revisionHistory.pageSize,
            previousHref: question.revisionHistory.page > 1
                ? pageHref(question.revisionHistory.page - 1)
                : null,
            nextHref: question.revisionHistory.page < lastPage
                ? pageHref(question.revisionHistory.page + 1)
                : null,
        },
    };

    if (question.origin === "account") {
        return {
            ...common,
            origin: "account",
            accessPolicy: {
                mode: "read-only",
                reason: question.readOnlyReason
                    ?? "帳號自有題目僅供檢視，不跨帳號改寫。",
            },
        };
    }

    if (question.status === "archived") {
        return {
            ...common,
            origin: "system",
            accessPolicy: {
                mode: "read-only",
                reason: "已封存題目保留歷史版本，不可建立、審核或發布新版本。",
            },
        };
    }

    const revision = question.displayRevision;
    if (
        revision === null
        || question.currentRevisionId === null
        || question.currentRevisionNumber === null
    ) {
        return {
            ...common,
            origin: "system",
            accessPolicy: {
                mode: "read-only",
                reason: "題目缺少可作為版本基準的目前發布版本。",
            },
        };
    }

    const isCurrentPublished = revision.status === "published"
        && revision.id === question.currentRevisionId;
    const isDraft = revision.status === "draft";
    if (!isCurrentPublished && !isDraft) {
        return {
            ...common,
            origin: "system",
            accessPolicy: {
                mode: "read-only",
                reason: "歷史、已取代或已退回版本僅供查閱；請回到目前發布版本建立新草稿。",
            },
        };
    }

    const isDraftAuthor = actorUserId === null
        || revision.createdBy.userId === actorUserId;
    const isCurrentRevisionAuthor = actorUserId === null
        || question.currentRevisionCreatedByUserId === actorUserId;
    const canReviewDraft = isDraft && !isDraftAuthor;
    const canPublishDraft = canReviewDraft && !isCurrentRevisionAuthor;

    return {
        ...common,
        origin: "system",
        accessPolicy: {
            mode: "editable",
            label: isDraft ? "前往草稿審核" : "建立修正版",
            href: "#question-version-workflow",
            reason: isDraft
                ? "審核或發布會保留目前發布版本，並以交易建立完整稽核紀錄。"
                : "編修會複製目前發布版本成新草稿，不會覆寫歷史作答引用的內容。",
            canReviewDraft,
            ...(!canReviewDraft && isDraft
                ? {
                    reviewBlockedReason: actorUserId === null
                        ? "無法確認目前管理員身分，請重新載入後再試。"
                        : "草稿建立者不可審核自己的版本，請由另一位管理員處理。",
                }
                : {}),
            canPublishDraft,
            ...(!canPublishDraft && isDraft
                ? {
                    publishBlockedReason: actorUserId === null
                        ? "無法確認目前管理員身分，請重新載入後再試。"
                        : isDraftAuthor
                            ? "草稿建立者不可發布自己的版本，請由另一位管理員處理。"
                            : "目前發布版本由你建立；必須由未建立草稿或目前版本的另一位管理員發布。",
                }
                : {}),
        },
    };
}

const EMPTY_QUESTION_FILTER_OPTIONS: AdminQuestionFilterOptions = {
    banks: [],
    subjects: [],
    grades: [],
    semesters: [],
    bookVersions: [],
    publishers: [],
    sourceCategories: [],
    difficulties: [],
};

function catalogFilterOptions(
    emptyLabel: string,
    options: readonly { id: string; label: string }[],
    selectedId?: string,
): ViewFilterOptionDto[] {
    const mapped = [
        { value: "", label: emptyLabel },
        ...options.map((option) => ({ value: option.id, label: option.label })),
    ];
    if (!selectedId || mapped.some((option) => option.value === selectedId)) return mapped;
    return [
        ...mapped,
        { value: selectedId, label: `目前選取（${selectedId}）` },
    ];
}

function hasQuestionFilters(query: QuestionListQuery): boolean {
    return Boolean(
        query.search
        || query.statuses.length > 0
        || query.origins.length > 0
        || query.revisionStatuses.length > 0
        || query.reviewStatuses.length > 0
        || query.bankId
        || query.subjectId
        || query.gradeId
        || query.semesterId
        || query.bookVersionId
        || query.publisherId
        || query.sourceCategoryId
        || query.difficultyId
        || query.created.from
        || query.created.to,
    );
}

export function buildQuestionsViewModel({
    query,
    page,
    detail,
    filterOptions = EMPTY_QUESTION_FILTER_OPTIONS,
    actorUserId = null,
    errorMessage,
}: {
    query: QuestionListQuery;
    page: AdminQuestionPage;
    detail: AdminQuestionDetail | null;
    filterOptions?: AdminQuestionFilterOptions;
    actorUserId?: string | null;
    errorMessage?: string;
}): QuestionsViewProps {
    const base = questionQueryParams(query);
    const closeParams = new URLSearchParams(base);
    closeParams.delete("question");
    const primarySort = query.orderBy[0];
    return {
        state: errorMessage
            ? { kind: "error", message: errorMessage, retryHref: toHref("/admin/questions", base) }
            : { kind: "ready" },
        filters: {
            action: "/admin/questions",
            search: {
                name: "search",
                label: "搜尋題庫",
                placeholder: "題目內容、來源識別或題目 ID",
                value: query.search ?? "",
            },
            selects: [
                {
                    name: "origin",
                    label: "來源範圍",
                    value: query.origins.join(","),
                    options: withCurrentMultiValue(
                        QUESTION_ORIGIN_OPTIONS,
                        query.origins,
                    ),
                },
                {
                    name: "status",
                    label: "狀態",
                    value: query.statuses.join(","),
                    options: withCurrentMultiValue(
                        QUESTION_STATUS_OPTIONS,
                        query.statuses,
                    ),
                },
                {
                    name: "revisionStatus",
                    label: "目前版本狀態",
                    value: query.revisionStatuses.join(","),
                    options: withCurrentMultiValue(
                        QUESTION_REVISION_STATUS_OPTIONS,
                        query.revisionStatuses,
                    ),
                },
                {
                    name: "reviewStatus",
                    label: "目前版本審核結果",
                    value: query.reviewStatuses.join(","),
                    options: withCurrentMultiValue(
                        QUESTION_REVIEW_STATUS_OPTIONS,
                        query.reviewStatuses,
                    ),
                },
                {
                    name: "bankId",
                    label: "所屬題庫",
                    value: query.bankId ?? "",
                    options: catalogFilterOptions(
                        "全部題庫",
                        filterOptions.banks,
                        query.bankId,
                    ),
                },
                {
                    name: "subjectId",
                    label: "科目",
                    value: query.subjectId ?? "",
                    options: catalogFilterOptions(
                        "全部科目",
                        filterOptions.subjects,
                        query.subjectId,
                    ),
                },
                {
                    name: "gradeId",
                    label: "年級",
                    value: query.gradeId ?? "",
                    options: catalogFilterOptions(
                        "全部年級",
                        filterOptions.grades,
                        query.gradeId,
                    ),
                },
                {
                    name: "semesterId",
                    label: "學期",
                    value: query.semesterId ?? "",
                    options: catalogFilterOptions(
                        "全部學期",
                        filterOptions.semesters,
                        query.semesterId,
                    ),
                },
                {
                    name: "bookVersionId",
                    label: "教材版本",
                    value: query.bookVersionId ?? "",
                    options: catalogFilterOptions(
                        "全部教材版本",
                        filterOptions.bookVersions,
                        query.bookVersionId,
                    ),
                },
                {
                    name: "publisherId",
                    label: "出版社",
                    value: query.publisherId ?? "",
                    options: catalogFilterOptions(
                        "全部出版社",
                        filterOptions.publishers,
                        query.publisherId,
                    ),
                },
                {
                    name: "sourceCategoryId",
                    label: "來源類型",
                    value: query.sourceCategoryId ?? "",
                    options: catalogFilterOptions(
                        "全部來源類型",
                        filterOptions.sourceCategories,
                        query.sourceCategoryId,
                    ),
                },
                {
                    name: "difficultyId",
                    label: "難度",
                    value: query.difficultyId ?? "",
                    options: catalogFilterOptions(
                        "全部難度",
                        filterOptions.difficulties,
                        query.difficultyId,
                    ),
                },
            ],
            hiddenFields: {
                ...(query.created.from ? { createdFrom: query.created.from } : {}),
                ...(query.created.to ? { createdTo: query.created.to } : {}),
                perPage: String(query.pageSize),
                sort: primarySort?.field ?? "createdAt",
                direction: primarySort?.direction ?? "desc",
            },
            resetHref: "/admin/questions",
        },
        sorts: sortLinks(
            "/admin/questions",
            base,
            query.orderBy,
            [
                { key: "origin", label: "來源範圍" },
                { key: "status", label: "題目狀態" },
                { key: "revisionNumber", label: "目前版本" },
                { key: "createdAt", label: "建立時間" },
            ],
        ),
        rows: errorMessage ? [] : page.items.map((item) => mapQuestionRow(item, base)),
        pagination: {
            currentPage: page.page,
            pageSize: page.pageSize,
            totalItems: errorMessage ? 0 : page.total,
            pageSizeOptions: [10, 25, 50, 100],
        },
        detail: !errorMessage && detail
            ? mapQuestionDetail(detail, base, actorUserId)
            : null,
        detailCloseHref: toHref("/admin/questions", closeParams),
        hasActiveFilters: hasQuestionFilters(query),
        reviewQueueHref: "/admin/questions/reviews",
    };
}

export function buildQuestionReviewQueueViewModel({
    query,
    page,
    errorMessage,
}: {
    query: QuestionReviewQueueQuery;
    page: AdminQuestionReviewQueuePage;
    errorMessage?: string;
}): QuestionReviewQueueViewProps {
    const base = questionReviewQueueQueryParams(query);
    return {
        state: errorMessage
            ? {
                kind: "error",
                message: errorMessage,
                retryHref: toHref("/admin/questions/reviews", base),
            }
            : { kind: "ready" },
        filters: {
            action: "/admin/questions/reviews",
            search: {
                name: "search",
                label: "搜尋待審題目",
                placeholder: "題目內容、修改原因、題目或草稿 ID",
                value: query.search ?? "",
            },
            selects: [{
                name: "reviewState",
                label: "待審狀態",
                value: query.states.join(","),
                options: withCurrentMultiValue(
                    QUESTION_REVIEW_QUEUE_STATE_OPTIONS,
                    query.states,
                ),
            }],
            hiddenFields: { perPage: String(query.pageSize) },
            resetHref: "/admin/questions/reviews",
        },
        rows: errorMessage
            ? []
            : page.items.map((item) => {
                const params = new URLSearchParams();
                params.set("question", item.questionId);
                params.set("revision", item.draftRevisionId);
                const createdBy = item.createdBy.displayName?.trim()
                    || (item.createdBy.type === "system_job" ? "系統工作" : "未填");
                return {
                    questionId: item.questionId,
                    draftRevisionId: item.draftRevisionId,
                    draftRevisionNumber: item.draftRevisionNumber,
                    currentRevisionNumber: item.currentRevisionNumber,
                    prompt: item.promptPreview ?? "未填題幹",
                    changeNote: item.changeNote,
                    reviewState: item.state,
                    reviewStateLabel: item.state === "unreviewed"
                        ? "尚未審核"
                        : "已要求修改",
                    latestReviewReason: item.latestReviewReason,
                    latestReviewAt: item.latestReviewAt
                        ? formatAdminDateTime(item.latestReviewAt)
                        : null,
                    createdBy,
                    createdAt: formatAdminDateTime(item.createdAt),
                    detailHref: toHref("/admin/questions", params),
                };
            }),
        pagination: {
            currentPage: page.page,
            pageSize: page.pageSize,
            totalItems: errorMessage ? 0 : page.total,
            pageSizeOptions: [10, 25, 50, 100],
        },
        hasActiveFilters: Boolean(query.search || query.states.length > 0),
        backHref: "/admin/questions",
    };
}

function auditActivity(item: AdminAuditListItem): DashboardActivityDto {
    return {
        id: item.id,
        title: auditActionLabel(item.action),
        description: `${auditTargetTypeLabel(item.targetType)}${item.targetId ? ` · ${item.targetId}` : ""}`,
        occurredAt: formatAdminDateTime(item.occurredAt),
        occurredAtIso: item.occurredAt,
        href: "/admin/audit",
    };
}

export function buildDashboardViewModel({
    accountTotal,
    questionTotal,
    recentAudit,
    errorMessage,
}: {
    accountTotal: number | null;
    questionTotal: number | null;
    recentAudit: readonly AdminAuditListItem[];
    errorMessage?: string;
}): DashboardViewProps {
    const metrics: ViewMetricDto[] = [
        {
            key: "accounts",
            label: "註冊帳號",
            value: accountTotal === null
                ? { state: "no_data", value: null }
                : { state: "available", value: accountTotal },
            detail: "每個 users 帳號只計一次",
            icon: "accounts",
        },
        {
            key: "questions",
            label: "題庫題目",
            value: questionTotal === null
                ? { state: "no_data", value: null }
                : { state: "available", value: questionTotal },
            detail: "依 questions 主表動態計數",
            icon: "questions",
        },
        {
            key: "active-learners",
            label: "期間活躍學習者",
            value: {
                state: "report_only",
                value: null,
                reason: "總覽不預設統計期間；請前往「查看報表」選擇期間。",
            },
            icon: "activity",
        },
        {
            key: "completion",
            label: "期間練習完成",
            value: {
                state: "report_only",
                value: null,
                reason: "總覽不預設統計期間；請前往「查看報表」選擇期間。",
            },
            icon: "completion",
        },
    ];

    return {
        state: errorMessage ? { kind: "error", message: errorMessage, retryHref: "/admin" } : { kind: "ready" },
        metrics,
        notices: [],
        activity: errorMessage ? [] : recentAudit.map(auditActivity),
        quickLinks: [
            { href: "/admin/accounts", label: "查詢帳號", description: "檢視帳號、身份與學習者存取。" },
            { href: "/admin/questions", label: "檢視題庫", description: "篩選題目並查看版本、答案與來源。" },
            { href: "/admin/reports", label: "查看報表", description: "查看學習與題庫統計。" },
        ],
    };
}

const SUBSCRIPTION_PLAN_STATUS_OPTIONS: readonly ViewFilterOptionDto[] = [
    { value: "", label: "全部狀態" },
    { value: "draft", label: "草稿" },
    { value: "active", label: "啟用" },
    { value: "retired", label: "已停用" },
];

function subscriptionPlanQueryParams(query: SubscriptionPlanListQuery): URLSearchParams {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.statuses.length > 0) params.set("status", query.statuses.join(","));
    params.set("page", String(query.page));
    params.set("perPage", String(query.pageSize));
    const primarySort = query.orderBy[0];
    if (primarySort) {
        params.set("sort", primarySort.field);
        params.set("direction", primarySort.direction);
    }
    return params;
}

const BILLING_INTERVAL_LABELS: Record<string, string> = {
    day: "日",
    week: "週",
    month: "月",
    year: "年",
};

function subscriptionPriceSummary(plan: AdminSubscriptionPlan): string | null {
    const current = plan.prices.filter((price) => price.status !== "retired");
    if (current.length === 0) return null;
    return current.slice(0, 2).map((price) =>
        `${price.currency} ${price.amountMinor}（minor unit）`,
    ).join("、") + (current.length > 2 ? ` 等 ${current.length} 筆` : "");
}

function subscriptionBillingSummary(plan: AdminSubscriptionPlan): string | null {
    const current = plan.prices.filter((price) => price.status !== "retired");
    if (current.length === 0) return null;
    const unique = [...new Set(current.map((price) =>
        `每 ${price.billingIntervalCount} ${BILLING_INTERVAL_LABELS[price.billingInterval] ?? price.billingInterval}`,
    ))];
    return unique.join("、");
}

function subscriptionFeatureSummary(plan: AdminSubscriptionPlan): string | null {
    if (plan.featureLimits.length === 0) return null;
    const included = plan.featureLimits.filter((limit) => limit.included).length;
    return `${included} 項包含／${plan.featureLimits.length} 項已設定`;
}

function mapSubscriptionPlanDetail(plan: AdminSubscriptionPlan): SubscriptionPlanDetailDto {
    return {
        id: plan.id,
        code: plan.code,
        name: plan.name,
        description: plan.description,
        status: plan.status,
        lockVersion: plan.lockVersion,
        createdAt: formatAdminDateTime(plan.createdAt),
        updatedAt: formatAdminDateTime(plan.updatedAt),
        prices: plan.prices.map((price) => ({
            id: price.id,
            currency: price.currency,
            amountMinor: price.amountMinor,
            billingInterval: price.billingInterval,
            billingIntervalCount: price.billingIntervalCount,
            status: price.status,
            effectiveFrom: price.effectiveFrom,
            effectiveUntil: price.effectiveUntil,
            lockVersion: price.lockVersion,
            updatedAt: formatAdminDateTime(price.updatedAt),
        })),
        featureLimits: plan.featureLimits.map((limit) => ({
            id: limit.id,
            featureDefinitionId: limit.featureDefinitionId,
            featureKey: limit.featureKey,
            displayName: limit.displayName,
            valueType: limit.valueType,
            unit: limit.unit,
            featureStatus: limit.featureStatus,
            included: limit.included,
            unlimited: limit.unlimited,
            limit: limit.limit,
            lockVersion: limit.lockVersion,
            updatedAt: formatAdminDateTime(limit.updatedAt),
        })),
    };
}

function mapSubscriptionFeatureDefinition(
    definition: AdminSubscriptionFeatureDefinition,
): SubscriptionFeatureDefinitionDto {
    return {
        id: definition.id,
        featureKey: definition.featureKey,
        displayName: definition.displayName,
        description: definition.description,
        valueType: definition.valueType,
        unit: definition.unit,
        status: definition.status,
        lockVersion: definition.lockVersion,
    };
}

export function buildSubscriptionPlansViewModel({
    query,
    page,
    detail,
    featureDefinitions,
    errorMessage,
}: {
    query: SubscriptionPlanListQuery;
    page: AdminSubscriptionPlanPage;
    detail: AdminSubscriptionPlan | null;
    featureDefinitions: readonly AdminSubscriptionFeatureDefinition[];
    errorMessage?: string;
}): SubscriptionPlansViewProps {
    const base = subscriptionPlanQueryParams(query);
    const closeParams = new URLSearchParams(base);
    closeParams.delete("plan");
    const primarySort = query.orderBy[0];
    return {
        state: errorMessage
            ? {
                  kind: "error",
                  message: errorMessage,
                  retryHref: toHref("/admin/subscription-plans", base),
              }
            : { kind: "ready" },
        catalogState: "ready",
        filters: {
            action: "/admin/subscription-plans",
            search: {
                name: "search",
                label: "搜尋方案",
                placeholder: "方案代碼或名稱",
                value: query.search ?? "",
            },
            selects: [{
                name: "status",
                label: "狀態",
                value: query.statuses.join(","),
                options: withCurrentMultiValue(
                    SUBSCRIPTION_PLAN_STATUS_OPTIONS,
                    query.statuses,
                ),
            }],
            hiddenFields: {
                perPage: String(query.pageSize),
                sort: primarySort?.field ?? "updatedAt",
                direction: primarySort?.direction ?? "desc",
            },
            resetHref: "/admin/subscription-plans",
        },
        sorts: sortLinks(
            "/admin/subscription-plans",
            base,
            query.orderBy,
            [
                { key: "code", label: "代碼" },
                { key: "name", label: "方案" },
                { key: "status", label: "狀態" },
                { key: "updatedAt", label: "更新時間" },
            ],
        ),
        rows: errorMessage ? [] : page.items.map((plan) => {
            const detailParams = new URLSearchParams(base);
            detailParams.set("plan", plan.id);
            return {
                id: plan.id,
                code: plan.code,
                name: plan.name,
                description: plan.description,
                status: plan.status,
                priceSummary: subscriptionPriceSummary(plan),
                billingSummary: subscriptionBillingSummary(plan),
                featureSummary: subscriptionFeatureSummary(plan),
                updatedAt: formatAdminDateTime(plan.updatedAt),
                detailHref: toHref("/admin/subscription-plans", detailParams),
            };
        }),
        pagination: {
            currentPage: page.page,
            pageSize: page.pageSize,
            totalItems: errorMessage ? 0 : page.total,
            pageSizeOptions: [10, 25, 50, 100],
        },
        catalogPolicy: {
            mode: "available",
            label: "管理方案目錄",
            reason: "只管理 catalog。啟用方案不會啟用付款、訂閱或扣款。",
            href: "#catalog-actions",
        },
        detail: !errorMessage && detail ? mapSubscriptionPlanDetail(detail) : null,
        detailCloseHref: toHref("/admin/subscription-plans", closeParams),
        featureDefinitions: errorMessage
            ? []
            : featureDefinitions.map(mapSubscriptionFeatureDefinition),
    };
}

const REPORT_RANGE_DAYS: Record<AdminReportRange, number> = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
};

const REPORT_RANGE_GRANULARITY: Record<AdminReportRange, AdminReportQuery["granularity"]> = {
    "7d": "day",
    "30d": "day",
    "90d": "week",
};

const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ADMIN_VIEW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

const percentageFormatter = new Intl.NumberFormat("zh-TW", {
    style: "percent",
    maximumFractionDigits: 1,
});

function taipeiLocalDate(value: Date): string {
    if (!Number.isFinite(value.getTime())) {
        throw new RangeError("報表基準時間不是有效日期。");
    }
    const parts = taipeiDateFormatter.formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes): string =>
        parts.find((item) => item.type === type)?.value ?? "";
    const localDate = `${part("year")}-${part("month")}-${part("day")}`;
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(localDate)) {
        throw new RangeError("無法解析臺北當地日期。");
    }
    return localDate;
}

function addCalendarDays(localDate: string, amount: number): string {
    const [year, month, day] = localDate.split("-").map(Number);
    if (
        !Number.isSafeInteger(year)
        || !Number.isSafeInteger(month)
        || !Number.isSafeInteger(day)
        || !Number.isSafeInteger(amount)
    ) {
        throw new RangeError("報表日期格式不正確。");
    }
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year!, month! - 1, day! + amount);
    return [
        String(date.getUTCFullYear()).padStart(4, "0"),
        String(date.getUTCMonth() + 1).padStart(2, "0"),
        String(date.getUTCDate()).padStart(2, "0"),
    ].join("-");
}

/** Converts a relative report range into an inclusive Asia/Taipei date window. */
export function resolveAdminReportQuery(
    range: AdminReportRange,
    now: Date = new Date(),
): AdminReportQuery {
    const endLocalDate = taipeiLocalDate(now);
    return {
        startLocalDate: addCalendarDays(endLocalDate, -(REPORT_RANGE_DAYS[range] - 1)),
        endLocalDate,
        granularity: REPORT_RANGE_GRANULARITY[range],
    };
}

function mapReportMetric(
    metric: AdminReportMetric,
    transform: (value: number) => string | number = (value) => value,
): ViewMetricValueDto {
    if (metric.state === "available") {
        return { state: "available", value: transform(metric.value) };
    }
    return {
        state: metric.state,
        value: null,
        reason: metric.reason,
    };
}

function unavailableDatasetValue(
    state: AdminReportDatasetState,
): Exclude<ViewMetricValueDto, { state: "available" }> {
    switch (state) {
        case "suppressed":
            return { state, value: null, reason: "未達顯示門檻" };
        case "policy_required":
            return {
                state,
                value: null,
                reason: "尚未啟用管理報表的統計隱私政策。",
            };
        case "available":
        case "no_data":
        default:
            return { state: "no_data", value: null, reason: "無資料" };
    }
}

function reportMetric(
    key: string,
    label: string,
    value: AdminReportMetric,
    icon: ViewMetricDto["icon"],
    transform?: (metricValue: number) => string | number,
): ViewMetricDto {
    return {
        key,
        label,
        value: mapReportMetric(value, transform),
        icon,
    };
}

function countSeries(
    key: string,
    title: string,
    description: string,
    state: AdminReportDatasetState | "available" | "no_data",
    rows: readonly { key: string; label: string; count: AdminReportMetric }[],
    summary?: ViewMetricDto,
): ReportSeriesDto {
    const max = rows.reduce(
        (current, row) => row.count.state === "available"
            ? Math.max(current, row.count.value)
            : current,
        0,
    );
    const mappedRows: ReportSeriesDto["rows"] = rows.map((row) => {
        if (row.count.state === "available") {
            return {
                key: row.key,
                label: row.label,
                value: { state: "available", value: row.count.value },
                barPercent: max === 0 ? 0 : (row.count.value / max) * 100,
            };
        }
        return {
            key: row.key,
            label: row.label,
            value: {
                state: row.count.state,
                value: null,
                reason: row.count.reason,
            },
            barPercent: null,
        };
    });
    const fallbackValue = unavailableDatasetValue(state);
    return {
        key,
        title,
        description,
        ...(summary ? { summary } : {}),
        rows: mappedRows.length > 0
            ? mappedRows
            : [{
                key: `${key}-${fallbackValue.state}`,
                label: "期間資料",
                value: fallbackValue,
                barPercent: null,
            }],
    };
}

const ACCOUNT_STATUS_LABELS: Readonly<Record<string, string>> = {
    active: "啟用",
    suspended: "已停權",
    closed: "已關閉",
};

const ROLE_LABELS: Readonly<Record<string, string>> = {
    parent: "家長",
    learner: "學習者",
    tutor: "導師",
    system_admin: "系統管理員",
};

const QUESTION_LABELS: Readonly<Record<string, string>> = {
    system: "系統題目",
    account: "帳號題目",
    draft: "草稿",
    published: "已發布",
    archived: "已封存",
    missing: "尚無目前版本",
    superseded: "已取代",
    rejected: "已退回",
    reviewed: "已審核",
    unreviewed: "未審核",
    approved: "已核准",
    changes_requested: "要求修改",
    recognizing: "辨識中",
    review: "待確認",
    confirmed: "已確認",
    failed: "失敗",
    cancelled: "已取消",
    pending: "待判定",
    uploaded: "已上傳",
    processing: "處理中",
    ready: "可用",
    with_primary_source: "有主要來源",
    without_primary_source: "有來源但未指定主要來源",
    without_source: "無來源",
};

function translatedLabel(value: string, labels: Readonly<Record<string, string>>): string {
    return labels[value] ?? value;
}

function distributionMetrics(
    keyPrefix: string,
    labelPrefix: string,
    distribution: AdminReportDistribution,
    labels: Readonly<Record<string, string>>,
): ViewMetricDto[] {
    if (distribution.rows.length === 0) {
        return [{
            key: `${keyPrefix}-${distribution.state}`,
            label: labelPrefix,
            value: unavailableDatasetValue(distribution.state),
            icon: "quality",
        }];
    }
    return distribution.rows.map((row) => ({
        key: `${keyPrefix}-${row.key}`,
        label: `${labelPrefix}：${translatedLabel(row.label, labels)}`,
        value: mapReportMetric(row.count),
        icon: "quality",
    }));
}

function questionQualityMetrics(
    quality: AdminReportSnapshot["questionQuality"],
): ViewMetricDto[] {
    const metrics: ViewMetricDto[] = [];
    if (quality.originAndStatus.length === 0) {
        metrics.push({
            key: `question-overall-${quality.state}`,
            label: "題目資料",
            value: unavailableDatasetValue(quality.state),
            icon: "questions",
        });
    }
    else {
        metrics.push(...quality.originAndStatus.map((row) => ({
            key: `question-origin-${row.origin}-${row.status}`,
            label: `${translatedLabel(row.origin, QUESTION_LABELS)}／${translatedLabel(row.status, QUESTION_LABELS)}`,
            value: mapReportMetric(row.count),
            icon: "questions" as const,
        })));
    }
    metrics.push(
        ...distributionMetrics("current-revision", "目前版本", quality.currentRevisionStates, QUESTION_LABELS),
        ...distributionMetrics("revision-status", "全部版本", quality.revisionStatuses, QUESTION_LABELS),
        ...distributionMetrics("review-coverage", "審核覆蓋", quality.revisionReviewCoverage, QUESTION_LABELS),
        ...distributionMetrics("review-decision", "最新審核", quality.latestReviewDecisions, QUESTION_LABELS),
        ...distributionMetrics("import-batch", "匯入批次", quality.importBatchStatuses, QUESTION_LABELS),
        ...distributionMetrics("import-item", "匯入項目", quality.importItemReviewStatuses, QUESTION_LABELS),
        ...distributionMetrics("source-document", "來源文件", quality.sourceDocumentStatuses, QUESTION_LABELS),
        ...distributionMetrics("source-coverage", "目前版本來源", quality.currentRevisionSourceCoverage, QUESTION_LABELS),
        reportMetric(
            "automatic-answer-total",
            "自動判分小題",
            quality.automaticAnswerCompleteness.totalParts,
            "quality",
        ),
        reportMetric(
            "automatic-answer-complete",
            "答案完整小題",
            quality.automaticAnswerCompleteness.completeParts,
            "quality",
        ),
        reportMetric(
            "automatic-answer-incomplete",
            "答案不完整小題",
            quality.automaticAnswerCompleteness.incompleteParts,
            "quality",
        ),
        reportMetric(
            "automatic-answer-completeness-rate",
            "自動答案完整率",
            quality.automaticAnswerCompleteness.rate,
            "quality",
            (value) => percentageFormatter.format(value),
        ),
    );
    return metrics;
}

function emptyReportSeries(
    key: string,
    title: string,
    description: string,
): ReportSeriesDto {
    return countSeries(key, title, description, "no_data", []);
}

export interface BuildReportsViewModelInput {
    range: AdminReportRange;
    query: AdminReportQuery;
    report: AdminReportSnapshot | null;
    errorMessage?: string;
}

export function buildReportsViewModel({
    range,
    query,
    report,
    errorMessage,
}: BuildReportsViewModelInput): ReportsViewProps {
    const dayCount = REPORT_RANGE_DAYS[range];
    const filters = {
        action: "/admin/reports",
        selects: [
            {
                name: "range",
                label: "統計期間",
                value: range,
                options: [...REPORT_RANGE_OPTIONS],
            },
        ],
        resetHref: "/admin/reports",
    } satisfies ReportsViewProps["filters"];
    const base = {
        state: errorMessage
            ? { kind: "error" as const, message: errorMessage, retryHref: `/admin/reports?range=${range}` }
            : { kind: "ready" as const },
        filters,
        periodLabel: `最近 ${dayCount} 日`,
        timeZone: ADMIN_VIEW_TIME_ZONE,
        startLocalDate: query.startLocalDate,
        endLocalDate: query.endLocalDate,
        generatedAt: report ? formatAdminDateTime(report.generatedAt) : null,
        granularityLabel: query.granularity === "week" ? "週" : query.granularity === "month" ? "月" : "日",
    };

    if (!report) {
        return {
            ...base,
            registrationTrend: emptyReportSeries(
                "registrations",
                "註冊人數趨勢",
                "帳號依 users.created_at 以臺北時區分組，每個帳號只計一次。",
            ),
            accountStatusDistribution: emptyReportSeries(
                "account-status",
                "目前帳號狀態",
                "依 users.status 顯示查詢當下快照，與歷史註冊趨勢分開。",
            ),
            activeRoleDistribution: emptyReportSeries(
                "active-roles",
                "有效角色分布",
                "只計未撤銷角色；同一帳號可能同時出現在多個類別。",
            ),
            gradeDistribution: emptyReportSeries(
                "grades",
                "學習者年級分布",
                "以正式年級關聯統計；缺值顯示未填。",
            ),
            region: {
                state: "not_collected",
                value: null,
                reason: "現有正式資料契約沒有地區欄位；不以學校名稱推測地區。",
            },
            activity: {
                key: "activity",
                title: "學習活動",
                description: "非 score 作答與 score 的匿名彙總分開計算。",
                metrics: [],
            },
            completion: {
                key: "completion",
                title: "練習完成",
                description: "完成數與啟動 cohort 完成率。",
                metrics: [],
            },
            questionQuality: {
                key: "question-quality",
                title: "題庫品質",
                description: "題目、版本、審核、匯入與來源的真實資料快照。",
                metrics: [],
            },
        };
    }

    const accountStatusRows = report.accounts.statuses.rows.map((row) => ({
        ...row,
        label: translatedLabel(row.key, ACCOUNT_STATUS_LABELS),
    }));
    const activeRoleRows = report.accounts.activeRoles.rows.map((row) => ({
        ...row,
        label: translatedLabel(row.key, ROLE_LABELS),
    }));
    const registrationRows = report.registrations.trend.map((row) => ({
        key: row.bucketKey,
        label: row.bucketKey,
        count: row.count,
    }));

    return {
        ...base,
        privacyPolicyNotice: report.privacyPolicy.state === "configured"
            ? {
                key: "privacy-policy-configured",
                title: "統計隱私政策已套用",
                message: `跨帳號學習者統計至少需要 ${report.privacyPolicy.minimumDistinctLearners} 名不同學習者；政策生效時間：${formatAdminDateTime(report.privacyPolicy.effectiveAt)}。`,
                tone: "muted",
            }
            : {
                key: "privacy-policy-required",
                title: "統計隱私政策尚未設定",
                message: "跨帳號學習者指標保持關閉，不顯示樣本數或以零代替。",
                tone: "warning",
            },
        registrationTrend: countSeries(
            "registrations",
            "註冊人數趨勢",
            "依 users.created_at 計算帳號建立事件；已關閉帳號仍保留在歷史趨勢。",
            report.registrations.state,
            registrationRows,
            reportMetric(
                "registration-total",
                "期間註冊帳號",
                report.registrations.total,
                "accounts",
            ),
        ),
        accountStatusDistribution: countSeries(
            "account-status",
            "目前帳號狀態",
            "依 users.status 顯示查詢當下快照，與歷史註冊趨勢分開。",
            report.accounts.statuses.state,
            accountStatusRows,
        ),
        activeRoleDistribution: countSeries(
            "active-roles",
            "有效角色分布",
            report.accounts.roleCountingNote,
            report.accounts.activeRoles.state,
            activeRoleRows,
        ),
        gradeDistribution: countSeries(
            "grades",
            "學習者年級分布",
            "只統計啟用中的學習者；不在學與未填分開顯示。",
            report.learners.grades.state,
            report.learners.grades.rows,
        ),
        region: {
            state: report.learners.region.state,
            value: null,
            reason: report.learners.region.reason,
        },
        activity: {
            key: "activity",
            title: "學習活動",
            description: "非 score 依不可覆寫作答；score 送出量依 answer-free receipt，結果只依期間完成 session 的 0011 彙總欄位。",
            metrics: [
                reportMetric(
                    "active-learners",
                    "活躍學習者",
                    report.practice.nonScoreActivity.activeLearners,
                    "activity",
                ),
                reportMetric(
                    "non-score-attempts",
                    "已提交作答",
                    report.practice.nonScoreActivity.attempts,
                    "activity",
                ),
                ...report.practice.nonScoreActivity.results.rows.map((row) =>
                    reportMetric(
                        `non-score-${row.key}`,
                        `作答結果：${translatedLabel(row.key, QUESTION_LABELS)}`,
                        row.count,
                        "activity",
                    )),
                reportMetric(
                    "score-active-learners",
                    "Score 活躍學習者",
                    report.practice.scoreActivity.activeLearners,
                    "activity",
                ),
                reportMetric(
                    "score-submitted-items",
                    "Score 期間送出題數",
                    report.practice.scoreActivity.submittedItems,
                    "activity",
                ),
                reportMetric(
                    "score-completed-sessions",
                    "Score 期間完成練習",
                    report.practice.scoreActivity.completedSessions,
                    "completion",
                ),
                reportMetric(
                    "score-total-items",
                    "Score 完成練習總題數",
                    report.practice.scoreActivity.totalItems,
                    "activity",
                ),
                reportMetric(
                    "score-answered-items",
                    "Score 完成練習已送出",
                    report.practice.scoreActivity.answeredItems,
                    "activity",
                ),
                reportMetric(
                    "score-correct-items",
                    "Score 完成練習答對",
                    report.practice.scoreActivity.correctItems,
                    "activity",
                ),
                reportMetric(
                    "score-wrong-items",
                    "Score 完成練習答錯",
                    report.practice.scoreActivity.wrongItems,
                    "activity",
                ),
                reportMetric(
                    "score-pending-items",
                    "Score 完成練習待判定",
                    report.practice.scoreActivity.pendingItems,
                    "activity",
                ),
            ],
        },
        completion: {
            key: "completion",
            title: "練習完成",
            description: "期間完成數依 completed_at；啟動 cohort 以期間內 started_at 為分母，零分母顯示無資料。",
            metrics: [
                reportMetric(
                    "completed-in-period",
                    "期間完成練習",
                    report.practice.completion.completedInPeriod,
                    "completion",
                ),
                reportMetric(
                    "started-cohort-sessions",
                    "期間啟動練習",
                    report.practice.completion.startedCohortSessions,
                    "completion",
                ),
                reportMetric(
                    "completed-started-cohort",
                    "啟動後已完成",
                    report.practice.completion.completedStartedCohortSessions,
                    "completion",
                ),
                reportMetric(
                    "started-cohort-completion-rate",
                    "啟動 cohort 完成率",
                    report.practice.completion.startedCohortCompletionRate,
                    "completion",
                    (value) => percentageFormatter.format(value),
                ),
            ],
        },
        questionQuality: {
            key: "question-quality",
            title: "題庫品質",
            description: "題目、版本、審核、匯入與來源皆使用真實資料；自動答案完整性依 0009 正式檢查函式計算。",
            metrics: questionQualityMetrics(report.questionQuality),
        },
    };
}

/** Client-safe page error text. SQL, input values and stack traces stay server-side. */
export function adminViewErrorMessage(error: unknown): string {
    if (error instanceof AdminApiError && error.status >= 400 && error.status < 500) {
        return error.message;
    }
    return "目前無法讀取管理資料，請稍後再試。";
}
