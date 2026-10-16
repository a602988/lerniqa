import {
    ACCOUNT_MANAGEABLE_STATUSES,
    GRANTED_ROLES,
    ACCOUNT_STATUSES,
    AdminApiError,
    type AccountListQuery,
    type AccountManageableStatus,
    type GrantedRole,
    type AccountSortField,
    type AccountStatus,
    type AccountStatusTransitionInput,
    type AdminDateFilter,
    type AdminPagination,
    type AdminSort,
    type AuditListQuery,
    type AuditSortField,
    QUESTION_ORIGINS,
    QUESTION_STATUSES,
    type QuestionDraftInput,
    type QuestionListQuery,
    type QuestionOrigin,
    type QuestionRevisionMutationInput,
    type QuestionSortField,
    type QuestionStatus,
    SUBSCRIPTION_BILLING_INTERVALS,
    SUBSCRIPTION_PLAN_STATUSES,
    SUBSCRIPTION_PRICE_STATUSES,
    type SortDirection,
    type SubscriptionBillingInterval,
    type SubscriptionFeatureLimitInput,
    type SubscriptionPlanInput,
    type SubscriptionPlanStatus,
    type SubscriptionPriceInput,
    type SubscriptionPriceStatus,
} from "./admin-types.ts";

export const ADMIN_DEFAULT_PAGE_SIZE = 25;
export const ADMIN_MAX_PAGE = 10_000;
export const ADMIN_MAX_PAGE_SIZE = 100;

type QueryRecord = Record<string, string | string[] | null | undefined>;
export type AdminQueryInput = URLSearchParams | QueryRecord;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MACHINE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/u;

// ISO 4217 List One unique alphabetic codes whose CcyNm is not marked IsFund.
// Snapshot: 2026-09-17. This intentionally includes current List One special,
// metal and testing codes; it is not a legal-tender list.
// Source: https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml
export const ISO_4217_CURRENCIES = [
    "AED", "AFN", "ALL", "AMD", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD", "BDT",
    "BHD", "BIF", "BMD", "BND", "BOB", "BRL", "BSD", "BTN", "BWP", "BYN", "BZD", "CAD",
    "CDF", "CHF", "CLP", "CNY", "COP", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP",
    "DZD", "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD",
    "GNF", "GTQ", "GYD", "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR", "IQD", "IRR",
    "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KPW", "KRW", "KWD", "KYD",
    "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD", "MAD", "MDL", "MGA", "MKD", "MMK",
    "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO",
    "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR",
    "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE",
    "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL", "THB", "TJS", "TMT", "TND", "TOP",
    "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD", "UYU", "UZS", "VED", "VES", "VND",
    "VUV", "WST", "XAF", "XAG", "XAU", "XBA", "XBB", "XBC", "XBD", "XCD", "XCG", "XDR",
    "XOF", "XPD", "XPF", "XPT", "XSU", "XTS", "XUA", "XXX", "YER", "ZAR", "ZMW", "ZWG",
] as const;

const ISO_4217_CURRENCY_SET = new Set<string>(ISO_4217_CURRENCIES);

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(
    value: Record<string, unknown>,
    allowed: readonly string[],
    code: ConstructorParameters<typeof AdminApiError>[0],
): void {
    const allowedSet = new Set(allowed);
    if (Object.keys(value).some((key) => !allowedSet.has(key))) {
        throw new AdminApiError(code, "請求含有不支援或不可由前端指定的欄位。", 400);
    }
}

function queryValue(query: AdminQueryInput, key: string): string | undefined {
    if (query instanceof URLSearchParams) {
        const values = query.getAll(key);
        if (values.length > 1) {
            throw new AdminApiError("INVALID_QUERY", `查詢參數 ${key} 不可重複。`, 400);
        }
        return values[0];
    }
    const value = query[key];
    if (Array.isArray(value)) {
        if (value.length > 1) {
            throw new AdminApiError("INVALID_QUERY", `查詢參數 ${key} 不可重複。`, 400);
        }
        return value[0];
    }
    return value ?? undefined;
}

function parseBoundedInteger(
    value: unknown,
    label: string,
    minimum: number,
    maximum: number,
    errorCode: ConstructorParameters<typeof AdminApiError>[0] = "INVALID_INPUT",
): number {
    const parsed = typeof value === "number"
        ? value
        : typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value)
            ? Number(value)
            : Number.NaN;
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new AdminApiError(errorCode, `${label}必須是 ${minimum} 到 ${maximum} 的整數。`, 400);
    }
    return parsed;
}

function parsePagination(query: AdminQueryInput): AdminPagination {
    const pageValue = queryValue(query, "page");
    const perPageValue = queryValue(query, "perPage");
    const pageSizeAliasValue = queryValue(query, "pageSize");
    if (perPageValue !== undefined && pageSizeAliasValue !== undefined) {
        throw new AdminApiError(
            "INVALID_QUERY",
            "每頁筆數不可同時使用 perPage 與 pageSize。",
            400,
        );
    }
    const pageSizeValue = perPageValue ?? pageSizeAliasValue;
    const page = pageValue === undefined
        ? 1
        : parseBoundedInteger(pageValue, "頁碼", 1, ADMIN_MAX_PAGE, "INVALID_QUERY");
    const pageSize = pageSizeValue === undefined
        ? ADMIN_DEFAULT_PAGE_SIZE
        : parseBoundedInteger(pageSizeValue, "每頁筆數", 1, ADMIN_MAX_PAGE_SIZE, "INVALID_QUERY");
    return {
        page,
        pageSize,
        offset: (page - 1) * pageSize,
        limit: pageSize,
    };
}

function parseSearch(query: AdminQueryInput): string | undefined {
    const value = queryValue(query, "search");
    if (value === undefined) return undefined;
    const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (!normalized) return undefined;
    if (normalized.length > 160 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        throw new AdminApiError("INVALID_QUERY", "搜尋文字不可超過 160 個字元。", 400);
    }
    return normalized;
}

function parseEnumList<T extends string>(
    value: string | undefined,
    allowed: readonly T[],
    label: string,
): T[] {
    if (value === undefined || value.trim() === "") return [];
    const allowedSet = new Set<string>(allowed);
    const result: T[] = [];
    for (const item of value.split(",")) {
        const candidate = item.trim();
        if (!candidate || !allowedSet.has(candidate)) {
            throw new AdminApiError("INVALID_QUERY", `${label}篩選條件不正確。`, 400);
        }
        if (!result.includes(candidate as T)) result.push(candidate as T);
    }
    return result;
}

function parseSafeTokenList(value: string | undefined, label: string): string[] {
    if (value === undefined || value.trim() === "") return [];
    const result: string[] = [];
    for (const item of value.split(",")) {
        const candidate = item.trim();
        if (!candidate || candidate.length > 80 || !MACHINE_KEY_PATTERN.test(candidate)) {
            throw new AdminApiError("INVALID_QUERY", `${label}篩選條件不正確。`, 400);
        }
        if (!result.includes(candidate)) result.push(candidate);
    }
    return result;
}

export function parseDateOnly(value: unknown, label = "日期"): string {
    if (typeof value !== "string") {
        throw new AdminApiError("INVALID_INPUT", `${label}格式不正確。`, 400);
    }
    const match = DATE_PATTERN.exec(value);
    if (!match) throw new AdminApiError("INVALID_INPUT", `${label}格式必須是 YYYY-MM-DD。`, 400);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) {
        throw new AdminApiError("INVALID_INPUT", `${label}不是有效日期。`, 400);
    }
    return value;
}

function parseDateFilter(query: AdminQueryInput, fromKey: string, toKey: string): AdminDateFilter {
    const fromValue = queryValue(query, fromKey);
    const toValue = queryValue(query, toKey);
    const from = fromValue === undefined || fromValue === "" ? undefined : parseDateOnly(fromValue, "起始日期");
    const to = toValue === undefined || toValue === "" ? undefined : parseDateOnly(toValue, "結束日期");
    if (from && to && from > to) {
        throw new AdminApiError("INVALID_QUERY", "起始日期不可晚於結束日期。", 400);
    }
    return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

function parseDirection(query: AdminQueryInput): SortDirection {
    const direction = queryValue(query, "direction") ?? "desc";
    if (direction !== "asc" && direction !== "desc") {
        throw new AdminApiError("INVALID_QUERY", "排序方向只接受 asc 或 desc。", 400);
    }
    return direction;
}

function parseOrderBy<Field extends string>(
    query: AdminQueryInput,
    allowed: readonly Field[],
    defaultField: Field,
): AdminSort<Field>[] {
    const requested = queryValue(query, "sort") ?? defaultField;
    if (!allowed.includes(requested as Field)) {
        throw new AdminApiError("INVALID_QUERY", "排序欄位不在允許清單中。", 400);
    }
    const field = requested as Field;
    const direction = parseDirection(query);
    const primary: AdminSort<Field> = { field, direction };
    if (field === "id") return [primary];
    return [primary, { field: "id" as Field, direction }];
}

export function parseAccountListQuery(query: AdminQueryInput): AccountListQuery {
    return {
        ...parsePagination(query),
        search: parseSearch(query),
        statuses: parseEnumList<AccountStatus>(queryValue(query, "status"), ACCOUNT_STATUSES, "帳號狀態"),
        roles: parseEnumList<GrantedRole>(queryValue(query, "role"), GRANTED_ROLES, "帳號角色"),
        created: parseDateFilter(query, "createdFrom", "createdTo"),
        orderBy: parseOrderBy<AccountSortField>(
            query,
            ["createdAt", "displayName", "email", "status", "updatedAt", "id"],
            "createdAt",
        ),
    };
}

export function parseQuestionListQuery(query: AdminQueryInput): QuestionListQuery {
    return {
        ...parsePagination(query),
        search: parseSearch(query),
        statuses: parseEnumList<QuestionStatus>(queryValue(query, "status"), QUESTION_STATUSES, "題目狀態"),
        origins: parseEnumList<QuestionOrigin>(queryValue(query, "origin"), QUESTION_ORIGINS, "題目來源"),
        created: parseDateFilter(query, "createdFrom", "createdTo"),
        orderBy: parseOrderBy<QuestionSortField>(
            query,
            ["createdAt", "origin", "revisionNumber", "status", "id"],
            "createdAt",
        ),
    };
}

export function parseAuditListQuery(query: AdminQueryInput): AuditListQuery {
    return {
        ...parsePagination(query),
        search: parseSearch(query),
        actions: parseSafeTokenList(queryValue(query, "action"), "稽核動作"),
        targetTypes: parseSafeTokenList(queryValue(query, "targetType"), "稽核目標"),
        occurred: parseDateFilter(query, "occurredFrom", "occurredTo"),
        orderBy: parseOrderBy<AuditSortField>(
            query,
            ["occurredAt", "action", "targetType", "id"],
            "occurredAt",
        ),
    };
}

export function parseUuid(value: unknown, label = "識別碼"): string {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        throw new AdminApiError("INVALID_UUID", `${label}格式不正確。`, 400);
    }
    return value.toLowerCase();
}

export function parseIdempotencyKey(value: unknown): string {
    if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
        throw new AdminApiError(
            "INVALID_IDEMPOTENCY_KEY",
            "重複提交識別碼必須是 16 到 128 個安全字元。",
            400,
        );
    }
    return value;
}

function parseRequiredText(
    value: unknown,
    label: string,
    minimum: number,
    maximum: number,
    errorCode: ConstructorParameters<typeof AdminApiError>[0],
): string {
    if (typeof value !== "string") {
        throw new AdminApiError(errorCode, `${label}格式不正確。`, 400);
    }
    const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (
        normalized.length < minimum
        || normalized.length > maximum
        || /[\u0000-\u001f\u007f]/u.test(normalized)
    ) {
        throw new AdminApiError(errorCode, `${label}必須是 ${minimum} 到 ${maximum} 個字元。`, 400);
    }
    return normalized;
}

function parseOptionalText(
    value: unknown,
    label: string,
    maximum: number,
    errorCode: ConstructorParameters<typeof AdminApiError>[0],
): string | null {
    if (value === undefined || value === null || value === "") return null;
    return parseRequiredText(value, label, 1, maximum, errorCode);
}

function parseEnum<T extends string>(
    value: unknown,
    allowed: readonly T[],
    label: string,
    errorCode: ConstructorParameters<typeof AdminApiError>[0],
): T {
    if (typeof value !== "string" || !allowed.includes(value as T)) {
        throw new AdminApiError(errorCode, `${label}不正確。`, 400);
    }
    return value as T;
}

function parseRequestEvidence(value: Record<string, unknown>): { requestId: string; idempotencyKey: string } {
    return {
        requestId: parseUuid(value.requestId, "requestId"),
        idempotencyKey: parseIdempotencyKey(value.idempotencyKey),
    };
}

export function parseAccountStatusTransitionInput(value: unknown): AccountStatusTransitionInput {
    if (!isRecord(value)) {
        throw new AdminApiError("INVALID_STATUS_TRANSITION", "帳號狀態異動資料格式不正確。", 400);
    }
    assertExactKeys(
        value,
        ["expectedCurrentStatus", "targetStatus", "reason", "requestId", "idempotencyKey"],
        "INVALID_STATUS_TRANSITION",
    );
    const expectedCurrentStatus = parseEnum<AccountManageableStatus>(
        value.expectedCurrentStatus,
        ACCOUNT_MANAGEABLE_STATUSES,
        "目前帳號狀態",
        "INVALID_STATUS_TRANSITION",
    );
    const targetStatus = parseEnum<AccountManageableStatus>(
        value.targetStatus,
        ACCOUNT_MANAGEABLE_STATUSES,
        "目標帳號狀態",
        "INVALID_STATUS_TRANSITION",
    );
    if (expectedCurrentStatus === targetStatus) {
        throw new AdminApiError("INVALID_STATUS_TRANSITION", "帳號狀態沒有變更。", 409);
    }
    return {
        expectedCurrentStatus,
        targetStatus,
        reason: parseRequiredText(value.reason, "異動原因", 5, 500, "INVALID_STATUS_TRANSITION"),
        ...parseRequestEvidence(value),
    };
}

function parseMachineKey(
    value: unknown,
    label: string,
    maximum: number,
    errorCode: ConstructorParameters<typeof AdminApiError>[0],
): string {
    if (typeof value !== "string" || value.length > maximum || !MACHINE_KEY_PATTERN.test(value)) {
        throw new AdminApiError(errorCode, `${label}只接受小寫英數、連字號與底線。`, 400);
    }
    return value;
}

export function parseSubscriptionPlanInput(value: unknown): SubscriptionPlanInput {
    if (!isRecord(value)) {
        throw new AdminApiError("INVALID_SUBSCRIPTION_PLAN", "方案資料格式不正確。", 400);
    }
    assertExactKeys(
        value,
        ["code", "name", "description", "status", "requestId", "idempotencyKey"],
        "INVALID_SUBSCRIPTION_PLAN",
    );
    return {
        code: parseMachineKey(value.code, "方案代碼", 40, "INVALID_SUBSCRIPTION_PLAN"),
        name: parseRequiredText(value.name, "方案名稱", 1, 80, "INVALID_SUBSCRIPTION_PLAN"),
        description: parseOptionalText(value.description, "方案說明", 500, "INVALID_SUBSCRIPTION_PLAN"),
        status: parseEnum<SubscriptionPlanStatus>(
            value.status,
            SUBSCRIPTION_PLAN_STATUSES,
            "方案狀態",
            "INVALID_SUBSCRIPTION_PLAN",
        ),
        ...parseRequestEvidence(value),
    };
}

function parseNullableDate(value: unknown, label: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    return parseDateOnly(value, label);
}

export function parseSubscriptionPriceInput(value: unknown): SubscriptionPriceInput {
    if (!isRecord(value)) {
        throw new AdminApiError("INVALID_SUBSCRIPTION_PRICE", "價格資料格式不正確。", 400);
    }
    assertExactKeys(
        value,
        [
            "planId", "currency", "amountMinor", "billingInterval", "billingIntervalCount",
            "status", "effectiveFrom", "effectiveUntil", "requestId", "idempotencyKey",
        ],
        "INVALID_SUBSCRIPTION_PRICE",
    );
    if (
        typeof value.currency !== "string"
        || value.currency !== value.currency.toUpperCase()
        || !ISO_4217_CURRENCY_SET.has(value.currency)
    ) {
        throw new AdminApiError(
            "INVALID_SUBSCRIPTION_PRICE",
            "幣別必須是大寫的有效 ISO 4217 代碼。",
            400,
        );
    }
    const effectiveFrom = parseNullableDate(value.effectiveFrom, "價格生效日");
    const effectiveUntil = parseNullableDate(value.effectiveUntil, "價格結束日");
    if (effectiveFrom && effectiveUntil && effectiveFrom > effectiveUntil) {
        throw new AdminApiError("INVALID_SUBSCRIPTION_PRICE", "價格生效日不可晚於結束日。", 400);
    }
    return {
        planId: parseUuid(value.planId, "方案識別碼"),
        currency: value.currency,
        amountMinor: parseBoundedInteger(
            value.amountMinor,
            "最小貨幣單位金額",
            0,
            999_999_999,
            "INVALID_SUBSCRIPTION_PRICE",
        ),
        billingInterval: parseEnum<SubscriptionBillingInterval>(
            value.billingInterval,
            SUBSCRIPTION_BILLING_INTERVALS,
            "計費週期",
            "INVALID_SUBSCRIPTION_PRICE",
        ),
        billingIntervalCount: parseBoundedInteger(
            value.billingIntervalCount,
            "計費週期數",
            1,
            365,
            "INVALID_SUBSCRIPTION_PRICE",
        ),
        status: parseEnum<SubscriptionPriceStatus>(
            value.status,
            SUBSCRIPTION_PRICE_STATUSES,
            "價格狀態",
            "INVALID_SUBSCRIPTION_PRICE",
        ),
        effectiveFrom,
        effectiveUntil,
        ...parseRequestEvidence(value),
    };
}

export function parseSubscriptionFeatureLimitInput(value: unknown): SubscriptionFeatureLimitInput {
    if (!isRecord(value)) {
        throw new AdminApiError("INVALID_FEATURE_LIMIT", "功能限制資料格式不正確。", 400);
    }
    assertExactKeys(
        value,
        ["planId", "featureKey", "included", "unlimited", "limit", "requestId", "idempotencyKey"],
        "INVALID_FEATURE_LIMIT",
    );
    if (typeof value.included !== "boolean" || typeof value.unlimited !== "boolean") {
        throw new AdminApiError("INVALID_FEATURE_LIMIT", "功能啟用與無上限旗標必須是布林值。", 400);
    }
    let limit: number | null = null;
    if (value.limit !== undefined && value.limit !== null) {
        limit = parseBoundedInteger(
            value.limit,
            "功能上限",
            0,
            999_999_999,
            "INVALID_FEATURE_LIMIT",
        );
    }
    if (!value.included && (value.unlimited || limit !== null)) {
        throw new AdminApiError("INVALID_FEATURE_LIMIT", "未包含的功能不可設定用量。", 400);
    }
    if (value.included && value.unlimited && limit !== null) {
        throw new AdminApiError("INVALID_FEATURE_LIMIT", "無上限功能不可同時設定數量上限。", 400);
    }
    if (value.included && !value.unlimited && limit === null) {
        throw new AdminApiError("INVALID_FEATURE_LIMIT", "有限功能必須提供數量上限。", 400);
    }
    return {
        planId: parseUuid(value.planId, "方案識別碼"),
        featureKey: parseMachineKey(value.featureKey, "功能代碼", 80, "INVALID_FEATURE_LIMIT"),
        included: value.included,
        unlimited: value.unlimited,
        limit,
        ...parseRequestEvidence(value),
    };
}

function parseQuestionChangeNote(value: unknown): string {
    return parseRequiredText(value, "修改原因", 5, 500, "INVALID_QUESTION_REVISION");
}

export function parseQuestionDraftInput(value: unknown): QuestionDraftInput {
    if (!isRecord(value)) {
        throw new AdminApiError("INVALID_QUESTION_REVISION", "題目版本資料格式不正確。", 400);
    }
    assertExactKeys(
        value,
        ["questionId", "baseRevisionId", "baseRevisionNumber", "changeNote", "requestId", "idempotencyKey"],
        "INVALID_QUESTION_REVISION",
    );
    return {
        questionId: parseUuid(value.questionId, "題目識別碼"),
        baseRevisionId: parseUuid(value.baseRevisionId, "基準版本識別碼"),
        baseRevisionNumber: parseBoundedInteger(
            value.baseRevisionNumber,
            "基準版本號",
            1,
            2_147_483_647,
            "INVALID_QUESTION_REVISION",
        ),
        changeNote: parseQuestionChangeNote(value.changeNote),
        ...parseRequestEvidence(value),
    };
}

export function parseQuestionRevisionMutationInput(value: unknown): QuestionRevisionMutationInput {
    if (!isRecord(value)) {
        throw new AdminApiError("INVALID_QUESTION_REVISION", "題目版本異動資料格式不正確。", 400);
    }
    assertExactKeys(
        value,
        [
            "questionId", "draftRevisionId", "expectedCurrentRevisionId", "expectedCurrentRevisionNumber",
            "changeNote", "requestId", "idempotencyKey",
        ],
        "INVALID_QUESTION_REVISION",
    );
    return {
        questionId: parseUuid(value.questionId, "題目識別碼"),
        draftRevisionId: parseUuid(value.draftRevisionId, "草稿版本識別碼"),
        expectedCurrentRevisionId: parseUuid(value.expectedCurrentRevisionId, "預期目前版本識別碼"),
        expectedCurrentRevisionNumber: parseBoundedInteger(
            value.expectedCurrentRevisionNumber,
            "預期目前版本號",
            1,
            2_147_483_647,
            "INVALID_QUESTION_REVISION",
        ),
        changeNote: parseQuestionChangeNote(value.changeNote),
        ...parseRequestEvidence(value),
    };
}
