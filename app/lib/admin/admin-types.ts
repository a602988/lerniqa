export const ACCOUNT_STATUSES = ["active", "suspended", "closed"] as const;
export const ACCOUNT_MANAGEABLE_STATUSES = ["active", "suspended"] as const;
export const ACCOUNT_IDENTITY_ROLES = ["parent", "learner", "tutor"] as const;
export const ACCOUNT_VERIFICATION_STATES = [
    "verified",
    "unverified",
    "not_applicable",
] as const;
export const GRANTED_ROLES = [
    ...ACCOUNT_IDENTITY_ROLES,
    "system_admin",
] as const;
export const QUESTION_STATUSES = ["draft", "published", "archived"] as const;
export const QUESTION_ORIGINS = ["system", "account"] as const;
export const QUESTION_REVISION_STATUSES = [
    "draft",
    "published",
    "superseded",
    "rejected",
] as const;
export const QUESTION_REVIEW_STATUSES = [
    "approved",
    "rejected",
    "changes_requested",
] as const;
export const QUESTION_REVIEW_QUEUE_STATES = [
    "unreviewed",
    "changes_requested",
] as const;
export const SUBSCRIPTION_PLAN_STATUSES = ["draft", "active", "retired"] as const;
export const SUBSCRIPTION_PRICE_STATUSES = ["draft", "active", "retired"] as const;
export const SUBSCRIPTION_BILLING_INTERVALS = ["day", "week", "month", "year"] as const;
export const SUBSCRIPTION_FEATURE_STATUSES = ["draft", "active", "retired"] as const;
export const SUBSCRIPTION_FEATURE_VALUE_TYPES = ["boolean", "integer"] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export type AccountManageableStatus = (typeof ACCOUNT_MANAGEABLE_STATUSES)[number];
/** The ordinary account classification stored by the account-role contract. */
export type AccountIdentityRole = (typeof ACCOUNT_IDENTITY_ROLES)[number];
export type AccountVerificationState = (typeof ACCOUNT_VERIFICATION_STATES)[number];
/** An append-only role grant; only this domain may contain system_admin. */
export type GrantedRole = (typeof GRANTED_ROLES)[number];
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];
export type QuestionOrigin = (typeof QUESTION_ORIGINS)[number];
export type QuestionRevisionStatus = (typeof QUESTION_REVISION_STATUSES)[number];
export type QuestionReviewStatus = (typeof QUESTION_REVIEW_STATUSES)[number];
export type QuestionReviewQueueState = (typeof QUESTION_REVIEW_QUEUE_STATES)[number];
export type SubscriptionPlanStatus = (typeof SUBSCRIPTION_PLAN_STATUSES)[number];
export type SubscriptionPriceStatus = (typeof SUBSCRIPTION_PRICE_STATUSES)[number];
export type SubscriptionBillingInterval = (typeof SUBSCRIPTION_BILLING_INTERVALS)[number];
export type SubscriptionFeatureStatus = (typeof SUBSCRIPTION_FEATURE_STATUSES)[number];
export type SubscriptionFeatureValueType = (typeof SUBSCRIPTION_FEATURE_VALUE_TYPES)[number];
export type SortDirection = "asc" | "desc";

export interface AdminSort<Field extends string> {
    field: Field;
    direction: SortDirection;
}

export interface AdminPagination {
    page: number;
    pageSize: number;
    offset: number;
    limit: number;
}

export interface AdminDateFilter {
    from?: string;
    to?: string;
}

export type AccountSortField =
    | "createdAt"
    | "displayName"
    | "email"
    | "status"
    | "accountRole"
    | "updatedAt"
    | "id";

export interface AccountListQuery extends AdminPagination {
    search?: string;
    statuses: AccountStatus[];
    accountRoles: AccountIdentityRole[];
    roles: GrantedRole[];
    verificationStates: AccountVerificationState[];
    created: AdminDateFilter;
    orderBy: AdminSort<AccountSortField>[];
}

export type QuestionSortField = "createdAt" | "origin" | "revisionNumber" | "status" | "id";

export interface QuestionListQuery extends AdminPagination {
    search?: string;
    statuses: QuestionStatus[];
    origins: QuestionOrigin[];
    revisionStatuses: QuestionRevisionStatus[];
    reviewStatuses: QuestionReviewStatus[];
    bankId?: string;
    subjectId?: string;
    gradeId?: string;
    semesterId?: string;
    bookVersionId?: string;
    publisherId?: string;
    sourceCategoryId?: string;
    difficultyId?: string;
    created: AdminDateFilter;
    orderBy: AdminSort<QuestionSortField>[];
}

export interface QuestionDetailQuery {
    selectedRevisionId?: string;
    revisionPage: number;
    revisionPageSize: number;
    revisionOffset: number;
    revisionLimit: number;
}

export interface QuestionReviewQueueQuery extends AdminPagination {
    search?: string;
    states: QuestionReviewQueueState[];
}

export type AuditSortField = "occurredAt" | "action" | "targetType" | "id";

export interface AuditListQuery extends AdminPagination {
    search?: string;
    actions: string[];
    targetTypes: string[];
    occurred: AdminDateFilter;
    orderBy: AdminSort<AuditSortField>[];
}

export type SubscriptionPlanSortField = "code" | "name" | "status" | "updatedAt" | "id";

export interface SubscriptionPlanListQuery extends AdminPagination {
    search?: string;
    statuses: SubscriptionPlanStatus[];
    orderBy: AdminSort<SubscriptionPlanSortField>[];
}

/** Trusted request evidence resolved from mutation headers on the server. */
export interface AdminMutationEvidence {
    requestId: string;
    idempotencyKey: string;
}

export interface AccountStatusTransitionInput extends AdminMutationEvidence {
    expectedCurrentStatus: AccountManageableStatus;
    targetStatus: AccountManageableStatus;
    reason: string;
}

export interface SubscriptionPlanInput extends AdminMutationEvidence {
    code: string;
    name: string;
    description: string | null;
    status: SubscriptionPlanStatus;
}

export interface SubscriptionPriceInput extends AdminMutationEvidence {
    planId: string;
    currency: string;
    amountMinor: number;
    billingInterval: SubscriptionBillingInterval;
    billingIntervalCount: number;
    status: SubscriptionPriceStatus;
    effectiveFrom: string | null;
    effectiveUntil: string | null;
}

export interface SubscriptionFeatureLimitInput extends AdminMutationEvidence {
    planId: string;
    featureKey: string;
    included: boolean;
    unlimited: boolean;
    limit: number | null;
}

export interface SubscriptionPlanUpdateInput extends AdminMutationEvidence {
    planId: string;
    expectedLockVersion: number;
    name: string;
    description: string | null;
}

export interface SubscriptionPlanStatusInput extends AdminMutationEvidence {
    planId: string;
    expectedLockVersion: number;
    targetStatus: Exclude<SubscriptionPlanStatus, "draft">;
}

export interface SubscriptionPriceStatusInput extends AdminMutationEvidence {
    planId: string;
    priceId: string;
    expectedLockVersion: number;
    targetStatus: Exclude<SubscriptionPriceStatus, "draft">;
}

export interface SubscriptionPriceUpdateInput extends AdminMutationEvidence {
    planId: string;
    priceId: string;
    expectedLockVersion: number;
    currency: string;
    amountMinor: number;
    billingInterval: SubscriptionBillingInterval;
    billingIntervalCount: number;
    effectiveFrom: string | null;
    effectiveUntil: string | null;
}

export interface SubscriptionFeatureDefinitionInput extends AdminMutationEvidence {
    featureKey: string;
    displayName: string;
    description: string | null;
    valueType: SubscriptionFeatureValueType;
    unit: string | null;
}

export interface SubscriptionFeatureDefinitionStatusInput extends AdminMutationEvidence {
    featureDefinitionId: string;
    expectedLockVersion: number;
    targetStatus: Exclude<SubscriptionFeatureStatus, "draft">;
}

export interface SubscriptionFeatureDefinitionUpdateInput extends AdminMutationEvidence {
    featureDefinitionId: string;
    expectedLockVersion: number;
    displayName: string;
    description: string | null;
    valueType: SubscriptionFeatureValueType;
    unit: string | null;
}

export interface SubscriptionFeatureLimitWriteInput extends AdminMutationEvidence {
    planId: string;
    featureDefinitionId: string;
    expectedLockVersion: number | null;
    included: boolean;
    unlimited: boolean;
    limit: number | null;
}

export interface QuestionDraftInput extends AdminMutationEvidence {
    questionId: string;
    baseRevisionId: string;
    baseRevisionNumber: number;
    changeNote: string;
}

export interface QuestionRevisionMutationInput extends AdminMutationEvidence {
    questionId: string;
    draftRevisionId: string;
    expectedCurrentRevisionId: string;
    expectedCurrentRevisionNumber: number;
    changeNote: string;
}

export type AdminApiErrorCode =
    | "INVALID_INPUT"
    | "INVALID_QUERY"
    | "INVALID_UUID"
    | "INVALID_IDEMPOTENCY_KEY"
    | "INVALID_STATUS_TRANSITION"
    | "INVALID_SUBSCRIPTION_PLAN"
    | "INVALID_SUBSCRIPTION_PRICE"
    | "INVALID_FEATURE_LIMIT"
    | "INVALID_QUESTION_REVISION"
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT"
    | "STALE_VERSION"
    | "RATE_LIMITED"
    | "INTERNAL_ERROR";

export interface AdminApiErrorBody {
    error: {
        code: AdminApiErrorCode;
        message: string;
        requestId?: string;
    };
}

/**
 * A deliberately small, client-safe error. Database errors, stack traces and
 * submitted payloads must never be copied into `message` or the response body.
 */
export class AdminApiError extends Error {
    readonly code: AdminApiErrorCode;
    readonly status: number;
    readonly requestId?: string;

    constructor(
        code: AdminApiErrorCode,
        message: string,
        status = 400,
        requestId?: string,
    ) {
        super(message);
        this.name = "AdminApiError";
        this.code = code;
        this.status = status;
        this.requestId = requestId;
    }

    toBody(): AdminApiErrorBody {
        return {
            error: {
                code: this.code,
                message: this.message,
                ...(this.requestId ? { requestId: this.requestId } : {}),
            },
        };
    }
}

export function toAdminApiErrorBody(error: unknown): AdminApiErrorBody {
    if (error instanceof AdminApiError) return error.toBody();
    return {
        error: {
            code: "INTERNAL_ERROR",
            message: "系統暫時無法完成操作，請稍後再試。",
        },
    };
}
