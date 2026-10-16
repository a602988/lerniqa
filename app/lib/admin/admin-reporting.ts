export const ADMIN_REPORT_TIME_ZONE = "Asia/Taipei" as const;

export const REPORT_MISSING_VALUE_LABEL = "未填" as const;
export const REPORT_NO_DATA_LABEL = "無資料" as const;
export const REPORT_PRIVACY_SUPPRESSED_LABEL = "未達顯示門檻" as const;

export type ReportBucketGranularity = "day" | "week" | "month";

export interface TaipeiReportDateRange {
    /** 使用者選取的第一個臺北日期。 */
    startLocalDate: string;
    /** 使用者選取的最後一個臺北日期；查詢時仍包含這一天。 */
    endLocalDate: string;
    /** SQL 查詢應使用的 UTC 起點，搭配 `>=`。 */
    startInclusive: Date;
    /** SQL 查詢應使用的 UTC 終點，搭配 `<`。 */
    endExclusive: Date;
}

export interface TaipeiReportBucket {
    granularity: ReportBucketGranularity;
    /** 穩定的分組鍵；日、週使用起始日，月使用 YYYY-MM。 */
    key: string;
    /** 這個桶在臺北時區的第一天。 */
    startLocalDate: string;
    /** 這個桶下一個週期的第一天；查詢時不包含。 */
    endExclusiveLocalDate: string;
}

export interface ReportMetricPrivacy {
    distinctLearnerCount: number;
    minimumDistinctLearners: number;
}

export interface ReportMetricFormatOptions {
    privacy?: ReportMetricPrivacy;
    maximumFractionDigits?: number;
}

interface LocalDateParts {
    year: number;
    month: number;
    day: number;
}

const TAIPEI_UTC_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1_000;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const EXPLICIT_OFFSET_TIMESTAMP_PATTERN = /T.*(?:Z|[+-]\d{2}:\d{2})$/iu;

const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ADMIN_REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

function isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
    if (month === 2) {
        return isLeapYear(year) ? 29 : 28;
    }

    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseLocalDate(value: string): LocalDateParts {
    const match = LOCAL_DATE_PATTERN.exec(value);
    if (!match) {
        throw new RangeError("日期必須使用 YYYY-MM-DD 格式。");
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (
        year < 1
        || year > 9_999
        || month < 1
        || month > 12
        || day < 1
        || day > daysInMonth(year, month)
    ) {
        throw new RangeError("日期不是有效的公曆日期。");
    }

    return { year, month, day };
}

function formatLocalDate(parts: LocalDateParts): string {
    if (
        !Number.isSafeInteger(parts.year)
        || !Number.isSafeInteger(parts.month)
        || !Number.isSafeInteger(parts.day)
        || parts.year < 1
        || parts.year > 9_999
        || parts.month < 1
        || parts.month > 12
        || parts.day < 1
        || parts.day > daysInMonth(parts.year, parts.month)
    ) {
        throw new RangeError("日期超出可支援的年份範圍。");
    }

    return [
        String(parts.year).padStart(4, "0"),
        String(parts.month).padStart(2, "0"),
        String(parts.day).padStart(2, "0"),
    ].join("-");
}

/** 建立只供公曆日期運算使用的 UTC 午夜，不把它當成實際事件時間。 */
function localDateOrdinalTimestamp(localDate: string): number {
    const parts = parseLocalDate(localDate);
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
    return date.getTime();
}

function addLocalDays(localDate: string, amount: number): string {
    if (!Number.isSafeInteger(amount)) {
        throw new RangeError("日期位移必須是安全整數。");
    }

    const date = new Date(localDateOrdinalTimestamp(localDate));
    date.setUTCDate(date.getUTCDate() + amount);
    return formatLocalDate({
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
    });
}

function addLocalMonthsFromFirstDay(localDate: string, amount: number): string {
    if (!Number.isSafeInteger(amount)) {
        throw new RangeError("月份位移必須是安全整數。");
    }

    const parts = parseLocalDate(localDate);
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(parts.year, parts.month - 1 + amount, 1);
    return formatLocalDate({
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: 1,
    });
}

function taipeiMidnight(localDate: string): Date {
    return new Date(localDateOrdinalTimestamp(localDate) - TAIPEI_UTC_OFFSET_MILLISECONDS);
}

function parseInstant(value: Date | string): Date {
    if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) {
            throw new RangeError("時間不是有效的日期。");
        }

        return new Date(value.getTime());
    }

    if (typeof value !== "string" || !EXPLICIT_OFFSET_TIMESTAMP_PATTERN.test(value)) {
        throw new RangeError("時間字串必須包含明確的 UTC 或時區位移。");
    }

    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
        throw new RangeError("時間字串不是有效的時間。");
    }

    return parsed;
}

function taipeiLocalDateForInstant(value: Date | string): string {
    const parts = taipeiDateFormatter.formatToParts(parseInstant(value));
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const day = Number(parts.find((part) => part.type === "day")?.value);

    return formatLocalDate({ year, month, day });
}

function assertNonNegativeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} 必須是大於或等於 0 的安全整數。`);
    }
}

/**
 * 將使用者選取的臺北日期範圍轉為 SQL 可直接使用的 UTC 半開區間。
 * UI 的結束日是包含式；資料庫條件應使用 `occurred_at >= startInclusive`
 * 與 `occurred_at < endExclusive`，避免依伺服器所在時區換日。
 */
export function createTaipeiDateRange(startLocalDate: string, endLocalDate: string): TaipeiReportDateRange {
    parseLocalDate(startLocalDate);
    parseLocalDate(endLocalDate);

    if (startLocalDate > endLocalDate) {
        throw new RangeError("日期範圍的結束日不可早於開始日。");
    }

    const endExclusiveLocalDate = addLocalDays(endLocalDate, 1);
    return {
        startLocalDate,
        endLocalDate,
        startInclusive: taipeiMidnight(startLocalDate),
        endExclusive: taipeiMidnight(endExclusiveLocalDate),
    };
}

/** 依 Asia/Taipei 將一個含時區的時間分到日、週或月；週一是每週第一天。 */
export function getTaipeiReportBucket(
    value: Date | string,
    granularity: ReportBucketGranularity,
): TaipeiReportBucket {
    const localDate = taipeiLocalDateForInstant(value);
    let startLocalDate: string;
    let endExclusiveLocalDate: string;

    switch (granularity) {
        case "day":
            startLocalDate = localDate;
            endExclusiveLocalDate = addLocalDays(localDate, 1);
            break;
        case "week": {
            const dayOfWeek = new Date(localDateOrdinalTimestamp(localDate)).getUTCDay();
            const daysSinceMonday = (dayOfWeek + 6) % 7;
            startLocalDate = addLocalDays(localDate, -daysSinceMonday);
            endExclusiveLocalDate = addLocalDays(startLocalDate, 7);
            break;
        }
        case "month": {
            const parts = parseLocalDate(localDate);
            startLocalDate = formatLocalDate({ year: parts.year, month: parts.month, day: 1 });
            endExclusiveLocalDate = addLocalMonthsFromFirstDay(startLocalDate, 1);
            break;
        }
        default:
            throw new RangeError("不支援的報表分組週期。");
    }

    return {
        granularity,
        key: granularity === "month" ? startLocalDate.slice(0, 7) : startLocalDate,
        startLocalDate,
        endExclusiveLocalDate,
    };
}

/** 將缺少或只有空白的分類值顯示成「未填」，但保留合法的 0。 */
export function formatReportDimensionValue(value: string | number | null | undefined): string {
    if (value === null || value === undefined) {
        return REPORT_MISSING_VALUE_LABEL;
    }

    if (typeof value === "string") {
        const normalized = value.trim();
        return normalized.length === 0 ? REPORT_MISSING_VALUE_LABEL : normalized;
    }

    if (!Number.isFinite(value)) {
        throw new RangeError("報表分類數值必須是有限數字。");
    }

    return String(value);
}

/** 空查詢顯示「無資料」；有資料（即使值為 0）則不顯示空狀態。 */
export function getEmptyReportLabel(rows: readonly unknown[]): typeof REPORT_NO_DATA_LABEL | null {
    return rows.length === 0 ? REPORT_NO_DATA_LABEL : null;
}

/** 分母為 0 時沒有可定義的比例；合法的 0／正值維持數值型別。 */
export function calculateReportRatio(numerator: number, denominator: number): number | null {
    if (
        !Number.isFinite(numerator)
        || !Number.isFinite(denominator)
        || numerator < 0
        || denominator < 0
        || numerator > denominator
    ) {
        throw new RangeError("比例必須使用有效的非負數，且分子不可大於分母。");
    }

    return denominator === 0 ? null : numerator / denominator;
}

/**
 * 隱私門檻先於數值格式化判斷，避免透過「0」或「無資料」反推小樣本。
 * 達到門檻時回傳 null，代表可繼續顯示實際聚合值。
 */
export function getPrivacySuppressionLabel(
    distinctLearnerCount: number,
    minimumDistinctLearners: number,
): typeof REPORT_PRIVACY_SUPPRESSED_LABEL | null {
    assertNonNegativeInteger(distinctLearnerCount, "不重複學習者數");
    if (!Number.isSafeInteger(minimumDistinctLearners) || minimumDistinctLearners < 2) {
        throw new RangeError("統計隱私門檻必須是大於 1 的安全整數。");
    }

    return distinctLearnerCount < minimumDistinctLearners
        ? REPORT_PRIVACY_SUPPRESSED_LABEL
        : null;
}

/** 將報表指標按隱私、無資料、實際數值的優先序轉為顯示文字。 */
export function formatReportMetricValue(
    value: number | null | undefined,
    options: ReportMetricFormatOptions = {},
): string {
    if (options.privacy) {
        const suppressionLabel = getPrivacySuppressionLabel(
            options.privacy.distinctLearnerCount,
            options.privacy.minimumDistinctLearners,
        );
        if (suppressionLabel) {
            return suppressionLabel;
        }
    }

    if (value === null || value === undefined) {
        return REPORT_NO_DATA_LABEL;
    }

    if (!Number.isFinite(value)) {
        throw new RangeError("報表指標必須是有限數字。");
    }

    const maximumFractionDigits = options.maximumFractionDigits ?? 2;
    if (!Number.isSafeInteger(maximumFractionDigits) || maximumFractionDigits < 0 || maximumFractionDigits > 20) {
        throw new RangeError("小數位數必須是 0 到 20 的安全整數。");
    }

    return new Intl.NumberFormat("zh-TW", {
        maximumFractionDigits,
    }).format(value);
}
