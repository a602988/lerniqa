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
    QuestionRevisionDto,
    QuestionRowDto,
    QuestionsViewProps,
    ReportsViewProps,
    SubscriptionPlansViewProps,
    ViewFilterOptionDto,
    ViewMetricDto,
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
    AdminQuestionPage,
    AdminQuestionRevision,
} from "./question-repository.ts";
import type {
    AccountListQuery,
    AdminSort,
    AuditListQuery,
    QuestionListQuery,
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
    { value: "suspended", label: "停用" },
    { value: "closed", label: "已關閉" },
];

const ACCOUNT_ROLE_OPTIONS: readonly ViewFilterOptionDto[] = [
    { value: "", label: "全部有效角色" },
    { value: "parent", label: "家長" },
    { value: "learner", label: "學習者" },
    { value: "tutor", label: "導師" },
    { value: "system_admin", label: "系統管理員" },
];

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
    key: "account" | "question",
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
    if (query.roles.length > 0) params.set("role", query.roles.join(","));
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
        status: account.status,
        // `users.account_role` arrives with the committed 0010 contract. Never
        // infer this ordinary account classification from privileged grants.
        accountRole: null,
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
        status: account.status,
        accountRole: null,
        createdAt: formatAdminDateTime(account.createdAt),
        updatedAt: formatAdminDateTime(account.updatedAt),
        identities: account.identities.map((identity) => {
            const verificationState = identityVerificationState(identity);
            return {
                id: identity.id,
                providerLabel: identity.provider === "email"
                    ? "電子郵件"
                    : identity.provider,
                identifier: identity.email ?? "未填",
                verificationState,
                verifiedAt: verificationState === "verified" && identity.verifiedAt
                    ? formatAdminDateTime(identity.verifiedAt)
                    : null,
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
        learnerAccess: account.learnerAccess.map((access) => ({
            id: access.id,
            learnerName: access.learnerDisplayName,
            gradeLabel: access.gradeName ?? access.gradeCode,
            semesterLabel: access.semesterName ?? access.semesterCode,
            accessRole: access.accessRole,
            permissions: {
                canViewResults: access.canViewResults,
                canCreatePlans: access.canCreatePlans,
                canReviewAnswers: access.canReviewAnswers,
                canManageSettings: access.canManageSettings,
            },
            revokedAt: access.revokedAt
                ? formatAdminDateTime(access.revokedAt)
                : null,
        })),
        statusPolicy: {
            mode: "locked",
            label: "需要當次確認",
            reason: "正式帳號狀態異動未在本頁開放；須另行確認目標、原因與影響。",
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
                    name: "role",
                    label: "有效角色",
                    value: query.roles.join(","),
                    options: withCurrentMultiValue(ACCOUNT_ROLE_OPTIONS, query.roles),
                },
            ],
            hiddenFields: {
                ...(query.created.from ? { createdFrom: query.created.from } : {}),
                ...(query.created.to ? { createdTo: query.created.to } : {}),
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
        actionLabel: item.action,
        targetTypeLabel: item.targetType,
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
            hiddenFields: {
                ...(query.actions.length > 0 ? { action: query.actions.join(",") } : {}),
                ...(query.targetTypes.length > 0
                    ? { targetType: query.targetTypes.join(",") }
                    : {}),
                ...(query.occurred.from ? { occurredFrom: query.occurred.from } : {}),
                ...(query.occurred.to ? { occurredTo: query.occurred.to } : {}),
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
        revisionNumber: question.currentRevision?.number ?? 0,
        sourceLabel: question.sourceCount > 0
            ? `${question.sourceCount} 筆來源`
            : null,
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

function mapQuestionRevision(
    revision: AdminQuestionRevision,
): QuestionRevisionDto {
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
        contentBlocks: revision.contentBlocks.map((block) => ({ ...block })),
        sources: revision.sources.map((source) => ({ ...source })),
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

export function mapQuestionDetail(question: AdminQuestionDetail): QuestionDetailDto {
    const common = {
        id: question.id,
        status: question.status,
        createdMethod: question.createdMethod,
        currentRevisionId: question.currentRevisionId,
        owner: question.owner,
        createdBy: question.createdBy,
        createdAt: formatAdminDateTime(question.createdAt),
        archivedAt: question.archivedAt
            ? formatAdminDateTime(question.archivedAt)
            : null,
        identifiers: question.identifiers.map((identifier) => ({ ...identifier })),
        revisions: question.revisions.map(mapQuestionRevision),
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

    return {
        ...common,
        origin: "system",
        accessPolicy: {
            mode: "read-only",
            reason: "版本編修與發布寫入服務尚未完成整合；目前不會直接覆寫題目。",
        },
    };
}

export function buildQuestionsViewModel({
    query,
    page,
    detail,
    errorMessage,
}: {
    query: QuestionListQuery;
    page: AdminQuestionPage;
    detail: AdminQuestionDetail | null;
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
        detail: !errorMessage && detail ? mapQuestionDetail(detail) : null,
        detailCloseHref: toHref("/admin/questions", closeParams),
    };
}

function auditActivity(item: AdminAuditListItem): DashboardActivityDto {
    return {
        id: item.id,
        title: item.action,
        description: `${item.targetType}${item.targetId ? ` · ${item.targetId}` : ""}`,
        occurredAt: formatAdminDateTime(item.occurredAt),
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
                state: "integration_pending",
                value: null,
                reason: "等待 0011 成績彙總契約整合後計算。",
            },
            icon: "activity",
        },
        {
            key: "completion",
            label: "期間練習完成",
            value: {
                state: "integration_pending",
                value: null,
                reason: "等待正式報表 repository 串接。",
            },
            icon: "completion",
        },
    ];

    return {
        state: errorMessage ? { kind: "error", message: errorMessage, retryHref: "/admin" } : { kind: "ready" },
        metrics,
        notices: [
            {
                key: "payments-not-integrated",
                title: "支付尚未串接",
                message: "方案目錄只描述未來設定，不代表可付款、已訂閱或已有收入。",
                tone: "warning",
            },
        ],
        activity: errorMessage ? [] : recentAudit.map(auditActivity),
        quickLinks: [
            { href: "/admin/accounts", label: "查詢帳號", description: "檢視帳號、身份與學習者存取。" },
            { href: "/admin/questions", label: "檢視題庫", description: "篩選題目並查看版本、答案與來源。" },
            { href: "/admin/reports", label: "查看報表", description: "確認已串接與尚未蒐集的統計。" },
        ],
    };
}

export function buildSubscriptionPlansViewModel(): SubscriptionPlansViewProps {
    return {
        state: { kind: "ready" },
        catalogState: "schema_pending",
        rows: [],
        catalogPolicy: {
            mode: "locked",
            label: "等待資料契約整合",
            reason: "0012 方案目錄 migration 與正式服務尚未整合；不建立示意價格或啟用付款。",
        },
    };
}

const pendingMetric = (
    key: string,
    label: string,
    detail: string,
    icon: ViewMetricDto["icon"],
): ViewMetricDto => ({
    key,
    label,
    value: { state: "integration_pending", value: null, reason: detail },
    detail,
    icon,
});

export function buildReportsViewModel(range: AdminReportRange): ReportsViewProps {
    const dayCount = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const pendingReason = "正式報表 repository 尚未整合，不以 fixture 或示意數字代替。";
    return {
        state: { kind: "ready" },
        filters: {
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
        },
        periodLabel: `最近 ${dayCount} 日（資料服務待整合）`,
        timeZone: ADMIN_VIEW_TIME_ZONE,
        registrationTrend: {
            key: "registrations",
            title: "註冊人數趨勢",
            description: "帳號依 users.created_at 以臺北時區分組，每個帳號只計一次。",
            rows: [
                {
                    key: "integration-pending",
                    label: "期間資料",
                    value: {
                        state: "integration_pending",
                        value: null,
                        reason: pendingReason,
                    },
                    barPercent: null,
                },
            ],
        },
        gradeDistribution: {
            key: "grades",
            title: "學習者年級分布",
            description: "以 learners 的正式年級關聯統計；缺值歸為未填。",
            rows: [
                {
                    key: "integration-pending",
                    label: "年級資料",
                    value: {
                        state: "integration_pending",
                        value: null,
                        reason: pendingReason,
                    },
                    barPercent: null,
                },
            ],
        },
        activity: {
            key: "activity",
            title: "學習活動",
            description: "活躍定義將以非成績作答與 answer-free 成績 receipt 統一計算。",
            metrics: [
                pendingMetric("active-learners", "活躍學習者", pendingReason, "activity"),
                pendingMetric("sessions-started", "開始練習", pendingReason, "activity"),
            ],
        },
        completion: {
            key: "completion",
            title: "練習完成",
            description: "完成率分母為期間內開始的練習，零分母顯示無資料。",
            metrics: [
                pendingMetric("sessions-completed", "完成練習", pendingReason, "completion"),
                pendingMetric("completion-rate", "練習完成率", pendingReason, "completion"),
            ],
        },
        questionQuality: {
            key: "question-quality",
            title: "題庫品質",
            description: "只使用可重建的彙總欄位；不從已清除的成績答案明細反推。",
            metrics: [
                pendingMetric("pending-scores", "待判定答案", pendingReason, "quality"),
                pendingMetric("published-questions", "已發布題目", pendingReason, "questions"),
            ],
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
