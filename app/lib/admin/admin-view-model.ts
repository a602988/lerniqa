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
    QuestionRevisionSummaryDto,
    QuestionRowDto,
    QuestionsViewProps,
    ReportsViewProps,
    ReportSeriesDto,
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
    AccountListQuery,
    AdminSort,
    AuditListQuery,
    QuestionDetailQuery,
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

    return {
        ...common,
        origin: "system",
        accessPolicy: {
            mode: "read-only",
            reason: "版本編修與發布寫入服務尚未完成整合；目前不會直接覆寫題目。",
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
    errorMessage,
}: {
    query: QuestionListQuery;
    page: AdminQuestionPage;
    detail: AdminQuestionDetail | null;
    filterOptions?: AdminQuestionFilterOptions;
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
        detail: !errorMessage && detail ? mapQuestionDetail(detail, base) : null,
        detailCloseHref: toHref("/admin/questions", closeParams),
        hasActiveFilters: hasQuestionFilters(query),
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
    suspended: "停用",
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
            "automatic-answer-completeness",
            "自動答案完整性",
            quality.automaticAnswerCompleteness,
            "quality",
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
                title: "非 score 學習活動",
                description: "期間內已提交的非 score 作答。",
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
            title: "非 score 學習活動",
            description: "活躍學習者依期間內已提交作答的不同 learner_id 計算；共享學習者不重複。",
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
                    "score-activity",
                    "Score 模式活動",
                    report.practice.scoreActivity,
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
            description: "題目、版本、審核、匯入與來源皆使用真實資料；0009 自動答案完整性未整合前不推測。",
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
