export type ViewLoadState =
    | { kind: "ready" }
    | { kind: "loading"; message?: string }
    | {
          kind: "error";
          message: string;
          retryHref?: string;
          retryLabel?: string;
      };

export type ViewDisplayValue = string | number | null;
type ViewUnavailableMetricState =
    | "no_data"
    | "not_collected"
    | "suppressed"
    | "policy_required"
    | "integration_pending"
    | "report_only";

export type ViewMetricValueDto =
    | { state: "available"; value: string | number }
    | {
          [State in ViewUnavailableMetricState]: {
              state: State;
              value: null;
              reason?: string;
          };
      }[ViewUnavailableMetricState];
export type ViewSortDirection = "asc" | "desc" | null;

export interface ViewSortLinkDto {
    key: string;
    label: string;
    href: string;
    direction: ViewSortDirection;
}

export interface ViewFilterOptionDto {
    label: string;
    value: string;
    disabled?: boolean;
}

export interface ViewFilterSelectDto {
    name: string;
    label: string;
    value: string;
    options: readonly ViewFilterOptionDto[];
}

export interface ViewFilterDateDto {
    name: string;
    label: string;
    value: string;
    min?: string;
    max?: string;
}

export interface ViewFilterDto {
    action: string;
    search?: {
        name: string;
        label: string;
        placeholder: string;
        value: string;
    };
    selects?: readonly ViewFilterSelectDto[];
    dates?: readonly ViewFilterDateDto[];
    hiddenFields?: Readonly<Record<string, string>>;
    resetHref?: string;
    submitLabel?: string;
}

export interface ViewPaginationDto {
    currentPage: number;
    pageSize: number;
    totalItems: number;
    pageSizeOptions?: number[];
}

export interface ViewMetricDto {
    key: string;
    label: string;
    value: ViewMetricValueDto;
    detail?: string | null;
    icon?: "accounts" | "questions" | "activity" | "completion" | "quality" | "plans";
}

export interface ViewNoticeDto {
    key: string;
    title?: string;
    message: string;
    tone?: "info" | "success" | "warning" | "danger" | "muted";
}

export interface ViewLinkDto {
    href: string;
    label: string;
    description?: string | null;
}

export interface DashboardActivityDto {
    id: string;
    title: string;
    description?: string | null;
    occurredAt: string;
    occurredAtIso: string;
    href?: string;
}

export interface DashboardViewProps {
    state: ViewLoadState;
    metrics: readonly ViewMetricDto[];
    notices?: readonly ViewNoticeDto[];
    activity: readonly DashboardActivityDto[];
    quickLinks?: readonly ViewLinkDto[];
}

export interface AccountRowDto {
    id: string;
    displayName: string;
    primaryEmail: string | null;
    emailVerificationState: "verified" | "unverified" | "not_applicable";
    status: string;
    accountRole: string | null;
    activeRoles: readonly string[];
    learnerCount: number;
    createdAt: string;
    detailHref: string;
}

export interface AccountIdentityDto {
    id: string;
    providerLabel: string;
    identifier: string;
    lifecycleState: "active" | "revoked";
    verificationState: "verified" | "unverified" | "not_applicable";
    verifiedAt: string | null;
    revokedAt: string | null;
}

export interface AccountRoleGrantDto {
    id: string;
    role: string;
    grantedAt: string;
    revokedAt: string | null;
}

export interface AccountLearnerAccessDto {
    id: string;
    learnerName: string;
    gradeLabel: string | null;
    semesterLabel: string | null;
    accessRole: string;
    learnerStatus: "active" | "archived";
    accessState: "accepted" | "pending" | "revoked";
    effective: boolean;
    acceptedAt: string | null;
    permissions: {
        canViewResults: boolean;
        canCreatePlans: boolean;
        canReviewAnswers: boolean;
        canManageSettings: boolean;
    };
    revokedAt: string | null;
}

export type ViewActionPolicyDto =
    | {
          mode: "locked";
          label: string;
          reason: string;
      }
    | {
          mode: "available";
          label: string;
          reason: string;
          href: string;
      };

export interface AccountDetailDto {
    id: string;
    displayName: string;
    primaryEmail: string | null;
    emailVerificationState: "verified" | "unverified" | "not_applicable";
    status: string;
    accountRole: string | null;
    createdAt: string;
    updatedAt: string;
    identities: readonly AccountIdentityDto[];
    roles: readonly AccountRoleGrantDto[];
    learnerAccess: readonly AccountLearnerAccessDto[];
    statusPolicy: Extract<ViewActionPolicyDto, { mode: "locked" }>;
    rolePolicy: Extract<ViewActionPolicyDto, { mode: "locked" }>;
}

export interface AccountsViewProps {
    state: ViewLoadState;
    filters: ViewFilterDto;
    sorts: readonly ViewSortLinkDto[];
    rows: readonly AccountRowDto[];
    pagination: ViewPaginationDto;
    detail: AccountDetailDto | null;
    detailCloseHref: string;
}

export type QuestionOrigin = "system" | "account";

export interface QuestionRowDto {
    id: string;
    prompt: string;
    origin: QuestionOrigin;
    status: string;
    revisionNumber: number | null;
    sourceLabel: string | null;
    banks: readonly {
        id: string;
        name: string;
        origin: QuestionOrigin;
        status: string;
    }[];
    createdAt: string;
    detailHref: string;
}

export interface QuestionCatalogRefDto {
    id: string;
    code: string;
    name: string;
}

export interface QuestionActorDto {
    type: string;
    userId: string | null;
    displayName: string | null;
}

export interface QuestionOptionDto {
    id: string;
    key: string;
    position: number;
}

export interface QuestionAnswerDto {
    id: string;
    answerKey: string | null;
    acceptedValue: string | null;
    position: number;
}

export interface QuestionPartDto {
    id: string;
    parentPartId: string | null;
    stableKey: string;
    position: number;
    answerMode: string;
    gradingPolicy: string;
    independentlyGradable: boolean;
    options: readonly QuestionOptionDto[];
    answers: readonly QuestionAnswerDto[];
}

export interface QuestionContentBlockDto {
    id: string;
    questionPartId: string | null;
    questionOptionId: string | null;
    parentBlockId: string | null;
    placement: string;
    contentType: string;
    position: number;
    textContent: string | null;
    assetId: string | null;
    assetUrl: string | null;
    altText: string | null;
}

export interface QuestionSourceDto {
    id: string;
    documentId: string;
    inputType: string;
    originalFileName: string | null;
    documentTitle: string | null;
    documentStatus: string;
    sourcePage: number | null;
    sourceQuestionNumber: string | null;
    cropAssetId: string | null;
    cropAssetUrl: string | null;
    primary: boolean;
}

export interface QuestionReviewDto {
    id: string;
    reviewerType: string;
    reviewerUserId: string | null;
    reviewerDisplayName: string | null;
    decision: string;
    reason: string | null;
    fromStatus: string;
    toStatus: string;
    createdAt: string;
}

/**
 * The repository deliberately strips `question_revision_id` and returns only
 * classification display data. Views still read an allowlist of known keys so
 * newly added database columns are not exposed automatically.
 */
export type QuestionClassificationDto = Readonly<Record<string, unknown>>;

export interface QuestionClassificationsDto {
    units: readonly QuestionClassificationDto[];
    topics: readonly QuestionClassificationDto[];
    knowledgePoints: readonly QuestionClassificationDto[];
    curriculumCodes: readonly QuestionClassificationDto[];
    filterValues: readonly QuestionClassificationDto[];
}

export interface QuestionRevisionSummaryDto {
    id: string;
    number: number;
    status: string;
    originalQuestionTypeLabel: string | null;
    searchText: string;
    questionType: QuestionCatalogRefDto;
    subject: QuestionCatalogRefDto | null;
    grade: QuestionCatalogRefDto | null;
    semester: QuestionCatalogRefDto | null;
    bookVersion: { id: string; name: string } | null;
    examLevel: QuestionCatalogRefDto | null;
    difficulty: QuestionCatalogRefDto | null;
    sourceCategory: QuestionCatalogRefDto | null;
    createdAt: string;
    publishedAt: string | null;
    createdBy: QuestionActorDto;
    changeNote: string | null;
}

export interface QuestionRevisionDto extends QuestionRevisionSummaryDto {
    parts: readonly QuestionPartDto[];
    contentBlocks: readonly QuestionContentBlockDto[];
    sources: readonly QuestionSourceDto[];
    reviews: readonly QuestionReviewDto[];
    classifications: QuestionClassificationsDto;
}

interface QuestionDetailBaseDto {
    id: string;
    status: string;
    createdMethod: string;
    currentRevisionId: string | null;
    currentRevisionNumber: number | null;
    owner: { id: string; displayName: string } | null;
    createdBy: { id: string; displayName: string } | null;
    createdAt: string;
    archivedAt: string | null;
    identifiers: readonly {
        id: string;
        type: string;
        value: string;
        publisherName: string | null;
        bookVersionName: string | null;
        sourceDocumentId: string | null;
    }[];
    selectedRevisionId: string | null;
    displayRevision: QuestionRevisionDto | null;
    revisionHistory: {
        items: readonly (QuestionRevisionSummaryDto & { detailHref: string })[];
        total: number;
        page: number;
        pageSize: number;
        previousHref: string | null;
        nextHref: string | null;
    };
}

export type QuestionDetailDto =
    | (QuestionDetailBaseDto & {
          origin: "account";
          accessPolicy: {
              mode: "read-only";
              reason: string;
          };
      })
    | (QuestionDetailBaseDto & {
          origin: "system";
          accessPolicy:
              | { mode: "read-only"; reason: string }
              | {
                    mode: "editable";
                    label: string;
                    href: string;
                    reason?: string;
                    canReviewDraft: boolean;
                    reviewBlockedReason?: string;
                    canPublishDraft: boolean;
                    publishBlockedReason?: string;
                };
      });

export interface QuestionsViewProps {
    state: ViewLoadState;
    filters: ViewFilterDto;
    sorts: readonly ViewSortLinkDto[];
    rows: readonly QuestionRowDto[];
    pagination: ViewPaginationDto;
    detail: QuestionDetailDto | null;
    detailCloseHref: string;
    hasActiveFilters: boolean;
    reviewQueueHref?: string;
}

export interface QuestionReviewQueueRowDto {
    questionId: string;
    draftRevisionId: string;
    draftRevisionNumber: number;
    currentRevisionNumber: number;
    prompt: string;
    changeNote: string | null;
    reviewState: "unreviewed" | "changes_requested";
    reviewStateLabel: string;
    latestReviewReason: string | null;
    latestReviewAt: string | null;
    createdBy: string;
    createdAt: string;
    detailHref: string;
}

export interface QuestionReviewQueueViewProps {
    state: ViewLoadState;
    filters: ViewFilterDto;
    rows: readonly QuestionReviewQueueRowDto[];
    pagination: ViewPaginationDto;
    hasActiveFilters: boolean;
    backHref: string;
}

export interface SubscriptionPlanRowDto {
    id: string;
    code: string;
    name: string;
    description: string | null;
    status: string;
    priceSummary: string | null;
    billingSummary: string | null;
    featureSummary: string | null;
    updatedAt: string;
    detailHref?: string;
}

export interface SubscriptionPriceDto {
    id: string;
    currency: string;
    amountMinor: number;
    billingInterval: string;
    billingIntervalCount: number;
    status: string;
    effectiveFrom: string | null;
    effectiveUntil: string | null;
    lockVersion: number;
    updatedAt: string;
}

export interface SubscriptionFeatureLimitDto {
    id: string;
    featureDefinitionId: string;
    featureKey: string;
    displayName: string;
    valueType: "boolean" | "integer";
    unit: string | null;
    featureStatus: string;
    included: boolean;
    unlimited: boolean;
    limit: number | null;
    lockVersion: number;
    updatedAt: string;
}

export interface SubscriptionFeatureDefinitionDto {
    id: string;
    featureKey: string;
    displayName: string;
    description: string | null;
    valueType: "boolean" | "integer";
    unit: string | null;
    status: string;
    lockVersion: number;
}

export interface SubscriptionPlanDetailDto {
    id: string;
    code: string;
    name: string;
    description: string | null;
    status: string;
    lockVersion: number;
    createdAt: string;
    updatedAt: string;
    prices: readonly SubscriptionPriceDto[];
    featureLimits: readonly SubscriptionFeatureLimitDto[];
}

export interface SubscriptionPlansViewProps {
    state: ViewLoadState;
    catalogState: "schema_pending" | "ready";
    filters?: ViewFilterDto;
    sorts?: readonly ViewSortLinkDto[];
    rows: readonly SubscriptionPlanRowDto[];
    pagination?: ViewPaginationDto;
    catalogPolicy: ViewActionPolicyDto;
    detail?: SubscriptionPlanDetailDto | null;
    detailCloseHref?: string;
    featureDefinitions?: readonly SubscriptionFeatureDefinitionDto[];
}

export type ReportSeriesRowDto = {
    key: string;
    label: string;
} & (
    | {
          value: Extract<ViewMetricValueDto, { state: "available" }>;
          /** Precomputed presentation ratio from 0 to 100. */
          barPercent: number;
      }
    | {
          value: Exclude<ViewMetricValueDto, { state: "available" }>;
          barPercent: null;
      }
);

export interface ReportSeriesDto {
    key: string;
    title: string;
    description: string;
    summary?: ViewMetricDto;
    rows: readonly ReportSeriesRowDto[];
}

export interface ReportMetricGroupDto {
    key: string;
    title: string;
    description: string;
    metrics: readonly ViewMetricDto[];
}

export interface ReportsViewProps {
    state: ViewLoadState;
    filters: ViewFilterDto;
    periodLabel: string;
    timeZone: "Asia/Taipei";
    startLocalDate: string;
    endLocalDate: string;
    generatedAt: string | null;
    granularityLabel: string;
    privacyPolicyNotice?: ViewNoticeDto;
    registrationTrend: ReportSeriesDto;
    accountStatusDistribution: ReportSeriesDto;
    activeRoleDistribution: ReportSeriesDto;
    gradeDistribution: ReportSeriesDto;
    region: Extract<ViewMetricValueDto, { state: "not_collected" }>;
    activity: ReportMetricGroupDto;
    completion: ReportMetricGroupDto;
    questionQuality: ReportMetricGroupDto;
}

export interface AuditRowDto {
    id: string;
    occurredAt: string;
    actorLabel: string;
    actionLabel: string;
    targetTypeLabel: string;
    targetLabel: string | null;
    requestId: string | null;
    detailHref?: string;
}

export interface AuditViewProps {
    state: ViewLoadState;
    filters: ViewFilterDto;
    sorts: readonly ViewSortLinkDto[];
    rows: readonly AuditRowDto[];
    pagination: ViewPaginationDto;
    hasActiveFilters: boolean;
}
