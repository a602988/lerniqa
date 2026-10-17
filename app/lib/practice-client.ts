import {
    LOCAL_PRACTICE_DEFAULT_FILTERS,
    LOCAL_PRACTICE_MAX_CATALOG_PAGE_SIZE,
    type LocalPracticeAnswerInput,
    type LocalPracticeHandwritingInput,
    type LocalPracticeAttempt,
    type LocalPracticeAttemptSubmission,
    type LocalPracticeHistory,
    type LocalPracticeQuestion,
    type LocalPracticeRecommendationResult,
    type LocalPracticeReferenceAnswer,
    type LocalPracticeSession,
    type LocalPracticeSessionRead,
    type LocalPracticeSessionSettings,
    type LocalPracticeSessionTarget,
} from "./local-practice-types";
import {
    ALL_KNOWLEDGE,
    ALL_UNITS,
    DEFAULT_PLAN,
    DEFAULT_QUESTION_LIMIT_OPTIONS,
    SUBJECTS,
    type CheckMode,
    type Learner,
    type PracticePlan,
    type Question,
    type QuestionCollection,
    type ScheduledPractice,
    type Subject,
} from "./demo-data";
import {
    ALL_QUESTION_FILTERS,
    normalizeQuestionFilters,
    type QuestionFilters,
} from "./question-filters";
import { normalizeSubjectLabel } from "./subject-labels";
import {
    AUTH_SESSION_EXPIRED_EVENT,
    broadcastAuthSessionExpired,
    isAuthSessionExpired,
} from "./auth-session-client";
import type { EducationCatalog } from "./education-catalog-contract";

export interface PracticePreferences {
    plan: PracticePlan | null;
    schedules: ScheduledPractice[];
    collections: QuestionCollection[];
    questionLimitOptions: number[] | null;
    defaultQuestionLimit: number | null;
}

const preferenceKey = (learnerId: string) => `lerniqa-practice-preferences-v2:${learnerId}`;
const legacyPreferenceKey = (learnerId: string) => `lerniqa-practice-preferences-v1:${learnerId}`;
const resumeKey = (learnerId: string) => `lerniqa-practice-resume-v1:${learnerId}`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PLAN_QUESTION_KINDS = new Set(["all", "choice", "boolean", "written", "multi-choice"]);
const CHECK_MODES = new Set<CheckMode>(["complete", "instant", "score"]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): value is string {
    return typeof value === "string" && value.length <= maximum;
}

/** 將目前陣列格式與舊版單選值轉成同一種多選格式。 */
function sanitizeFilterList(
    value: unknown,
    legacyValue: unknown,
    allValue: string,
    maximum = 240,
): string[] | null {
    let items: unknown[];
    if (value === undefined) {
        if (legacyValue === undefined) return [];
        items = [legacyValue];
    }
    else if (Array.isArray(value) && value.length <= 100) items = value;
    else return null;

    if (!items.every((item) => boundedString(item, maximum))) return null;
    if (items.includes(allValue)) return [];
    return [...new Set(items as string[])];
}

function sanitizeQuestionKinds(value: unknown, legacyValue: unknown): PracticePlan["questionKinds"] | null {
    const items = sanitizeFilterList(value, legacyValue, ALL_QUESTION_FILTERS, 40);
    return items?.every((item) => PLAN_QUESTION_KINDS.has(item) && item !== ALL_QUESTION_FILTERS)
        ? items as PracticePlan["questionKinds"]
        : null;
}

function sanitizeQuestionLimitOptions(value: unknown): number[] | null {
    if (!Array.isArray(value) || !value.length || value.length > 20) return null;
    const limits = value.filter((item): item is number => Number.isInteger(item) && Number(item) >= 1 && Number(item) <= 500);
    return limits.length === value.length && new Set(limits).size === limits.length ? [...limits] : null;
}

function sanitizePracticePlan(value: unknown): PracticePlan | null {
    if (!isRecord(value)) return null;
    const scopeFilters = sanitizeFilterList(value.scopeFilters, value.scope, ALL_UNITS);
    const difficultyFilters = sanitizeFilterList(value.difficultyFilters, value.difficulty, ALL_QUESTION_FILTERS, 80);
    const sourceFilters = sanitizeFilterList(value.sourceFilters, undefined, ALL_QUESTION_FILTERS);
    const questionKinds = sanitizeQuestionKinds(value.questionKinds, value.questionKind);

    if (!scopeFilters || !difficultyFilters || !sourceFilters || !questionKinds
        || !boundedString(value.creatorRole, 40)
        || !boundedString(value.subject, 80)
        || !boundedString(value.semester, 80)
        || !boundedString(value.topic, 240)
        || !boundedString(value.creatorFilter, 80)
        || !boundedString(value.collection, 120)
        || !boundedString(value.search, 240)
        || (value.bookVersion !== undefined && !boundedString(value.bookVersion, 100))
        || !Array.isArray(value.examSettings) || !value.examSettings.length || value.examSettings.length > 20
        || !boundedString(value.activeExamId, 80)
        || !CHECK_MODES.has(value.checkMode as CheckMode)
        || !Number.isInteger(value.questionLimit) || Number(value.questionLimit) < 1 || Number(value.questionLimit) > 500
        || (value.prioritizeRelated !== undefined && typeof value.prioritizeRelated !== "boolean")
        || !["chapter", "assessment"].includes(String(value.basis))
        || !isRecord(value.difficultyMix)
        || ![value.difficultyMix.easy, value.difficultyMix.medium, value.difficultyMix.hard]
            .every((item) => typeof item === "number" && item >= 0 && item <= 100)
        || typeof value.difficultyMixEnabled !== "boolean"
        || !boundedString(value.knowledge, 240)
        || !isRecord(value.metadataFilters)) return null;

    const examSettings = value.examSettings.flatMap((candidate) => {
        if (!isRecord(candidate)
            || !boundedString(candidate.id, 80) || !candidate.id
            || !boundedString(candidate.name, 120) || !candidate.name
            || !boundedString(candidate.date, 20)
            || !isRecord(candidate.ranges)) return [];
        const ranges = Object.fromEntries(Object.entries(candidate.ranges).flatMap(([subject, range]) => (
            subject.length <= 80 && isRecord(range) && boundedString(range.start, 240) && boundedString(range.end, 240)
                ? [[subject, { start: range.start, end: range.end }]]
                : []
        )));
        return [{ id: candidate.id, name: candidate.name, date: candidate.date, ranges }];
    });
    if (examSettings.length !== value.examSettings.length
        || !examSettings.some((exam) => exam.id === value.activeExamId)) return null;

    const metadataFilters = Object.fromEntries(Object.entries(value.metadataFilters).flatMap(([key, items]) => (
        /^[a-z][a-z0-9_]{0,79}$/u.test(key)
            && Array.isArray(items) && items.length <= 100
            && items.every((item) => boundedString(item, 240))
            ? [[key, [...items] as string[]]]
            : []
    )));
    if (Object.keys(metadataFilters).length !== Object.keys(value.metadataFilters).length) return null;

    return {
        creatorRole: value.creatorRole,
        subject: value.subject,
        ...(value.bookVersion === undefined ? {} : { bookVersion: value.bookVersion }),
        scopeFilters,
        semester: value.semester,
        topic: value.topic,
        difficultyFilters,
        creatorFilter: value.creatorFilter,
        collection: value.collection,
        search: value.search,
        examSettings,
        activeExamId: value.activeExamId,
        checkMode: value.checkMode as CheckMode,
        questionLimit: Number(value.questionLimit),
        prioritizeRelated: value.prioritizeRelated === true,
        basis: value.basis as PracticePlan["basis"],
        difficultyMix: {
            easy: Number(value.difficultyMix.easy),
            medium: Number(value.difficultyMix.medium),
            hard: Number(value.difficultyMix.hard),
        },
        difficultyMixEnabled: value.difficultyMixEnabled,
        sourceFilters,
        questionKinds,
        knowledge: value.knowledge,
        metadataFilters,
    };
}

function sanitizeSchedules(value: unknown): ScheduledPractice[] | null {
    if (!Array.isArray(value) || value.length > 500) return null;
    const schedules = value.flatMap((candidate) => {
        if (!isRecord(candidate)
            || !boundedString(candidate.id, 120) || !candidate.id
            || !["家長", "學習者", "家教"].includes(String(candidate.creatorRole))
            || !boundedString(candidate.date, 20)
            || (candidate.time !== undefined && !boundedString(candidate.time, 20))
            || !boundedString(candidate.subjectLabel, 160)
            || !boundedString(candidate.scopeLabel, 240)
            || !CHECK_MODES.has(candidate.checkMode as CheckMode)
            || !Array.isArray(candidate.questionIds) || candidate.questionIds.length > 500
            || !candidate.questionIds.every((id) => Number.isSafeInteger(id))
            || !boundedString(candidate.createdAt, 40)) return [];
        let result: ScheduledPractice["result"];
        if (candidate.result !== undefined) {
            if (!isRecord(candidate.result)
                || !boundedString(candidate.result.sessionId, 120)
                || !boundedString(candidate.result.completedAt, 40)
                || !Number.isInteger(candidate.result.totalQuestions)
                || !Number.isInteger(candidate.result.wrongQuestions)
                || typeof candidate.result.accuracy !== "number") return [];
            result = {
                sessionId: candidate.result.sessionId,
                completedAt: candidate.result.completedAt,
                totalQuestions: Number(candidate.result.totalQuestions),
                wrongQuestions: Number(candidate.result.wrongQuestions),
                accuracy: candidate.result.accuracy,
            };
        }
        return [{
            id: candidate.id,
            creatorRole: candidate.creatorRole as ScheduledPractice["creatorRole"],
            date: candidate.date,
            ...(candidate.time === undefined ? {} : { time: candidate.time }),
            subjectLabel: candidate.subjectLabel,
            scopeLabel: candidate.scopeLabel,
            checkMode: candidate.checkMode as CheckMode,
            questionIds: [...candidate.questionIds] as number[],
            createdAt: candidate.createdAt,
            ...(result ? { result } : {}),
        }];
    });
    return schedules.length === value.length ? schedules : null;
}

function sanitizeCollections(value: unknown): QuestionCollection[] | null {
    if (!Array.isArray(value) || value.length > 100) return null;
    const collections = value.flatMap((candidate) => (
        isRecord(candidate)
        && boundedString(candidate.id, 120) && candidate.id
        && boundedString(candidate.name, 120)
        && Array.isArray(candidate.questionIds) && candidate.questionIds.length <= 10_000
        && candidate.questionIds.every((id) => Number.isSafeInteger(id))
        && boundedString(candidate.createdAt, 40)
            ? [{
                id: candidate.id,
                name: candidate.name,
                questionIds: [...candidate.questionIds] as number[],
                createdAt: candidate.createdAt,
            }]
            : []
    ));
    return collections.length === value.length ? collections : null;
}

function sanitizePracticePreferences(value: unknown): PracticePreferences | null {
    if (!isRecord(value)) return null;
    const schedules = sanitizeSchedules(value.schedules);
    const collections = sanitizeCollections(value.collections);
    if (!schedules || !collections) return null;
    const questionLimitOptions = sanitizeQuestionLimitOptions(value.questionLimitOptions);
    const defaultQuestionLimit = Number.isInteger(value.defaultQuestionLimit)
        && Number(value.defaultQuestionLimit) >= 1
        && Number(value.defaultQuestionLimit) <= 500
        && questionLimitOptions?.includes(Number(value.defaultQuestionLimit))
        ? Number(value.defaultQuestionLimit)
        : null;
    return {
        plan: sanitizePracticePlan(value.plan),
        schedules,
        collections,
        questionLimitOptions,
        defaultQuestionLimit,
    };
}

/** UI settings are local to this browser; answers and grading remain in PostgreSQL. */
export function readPracticePreferences(learnerId: string): PracticePreferences | null {
    try {
        const currentKey = preferenceKey(learnerId);
        const currentRaw = window.localStorage.getItem(currentKey);
        const current = sanitizePracticePreferences(JSON.parse(currentRaw ?? "null"));
        if (current) {
            const canonical = JSON.stringify(current);
            if (currentRaw !== canonical) {
                try { window.localStorage.setItem(currentKey, canonical); }
                catch { /* 儲存空間已滿時仍使用已成功讀取的設定。 */ }
            }
            window.localStorage.removeItem(legacyPreferenceKey(learnerId));
            return current;
        }
        const legacy = JSON.parse(window.localStorage.getItem(legacyPreferenceKey(learnerId)) ?? "null") as unknown;
        if (!isRecord(legacy)) return null;
        const legacyLearner = isRecord(legacy.learner) ? legacy.learner : {};
        const migrated = sanitizePracticePreferences({
            plan: legacy.plan,
            schedules: legacy.schedules,
            collections: legacy.collections,
            questionLimitOptions: legacyLearner.questionLimitOptions,
            defaultQuestionLimit: legacyLearner.defaultQuestionLimit,
        });
        if (!migrated) return null;
        window.localStorage.setItem(preferenceKey(learnerId), JSON.stringify(migrated));
        window.localStorage.removeItem(legacyPreferenceKey(learnerId));
        return migrated;
    }
    catch { return null; }
}

export function writePracticePreferences(learnerId: string, value: PracticePreferences): void {
    const sanitized = sanitizePracticePreferences(value);
    if (!sanitized) throw new Error("練習偏好格式不正確。");
    window.localStorage.setItem(preferenceKey(learnerId), JSON.stringify(sanitized));
    window.localStorage.removeItem(legacyPreferenceKey(learnerId));
}

/** Reads the only browser-persisted session state: an opaque server session UUID. */
export function readPracticeSessionHint(learnerId: string): string | null {
    try {
        const value = JSON.parse(window.localStorage.getItem(resumeKey(learnerId)) ?? "null") as unknown;
        if (!value || typeof value !== "object" || Array.isArray(value) || !("sessionId" in value)) return null;
        const sessionId = (value as { sessionId?: unknown }).sessionId;
        return typeof sessionId === "string" && UUID_PATTERN.test(sessionId) ? sessionId : null;
    }
    catch { return null; }
}

export function writePracticeSessionHint(learnerId: string, sessionId: string): boolean {
    if (!UUID_PATTERN.test(sessionId)) throw new Error("練習識別碼格式不正確。");
    try {
        window.localStorage.setItem(resumeKey(learnerId), JSON.stringify({ sessionId }));
        return true;
    }
    catch { return false; }
}

export function clearPracticeSessionHint(learnerId: string): boolean {
    try {
        window.localStorage.removeItem(resumeKey(learnerId));
        return true;
    }
    catch { return false; }
}

export class PracticeApiError extends Error {
    readonly status: number;
    readonly code: string | null;

    constructor(status: number, code: string | null, message: string) {
        super(message);
        this.name = "PracticeApiError";
        this.status = status;
        this.code = code;
    }
}

/** Lets the workspace purge account-scoped state immediately after any API reports an expired login. */
export const PRACTICE_AUTH_EXPIRED_EVENT = AUTH_SESSION_EXPIRED_EVENT;
export const isPracticeSessionExpired = isAuthSessionExpired;

export function isDeterministicPracticeApiError(error: unknown): error is PracticeApiError {
    return error instanceof PracticeApiError && error.status >= 400 && error.status < 500;
}

async function readPracticeApiEnvelope<T>(response: Response, fallbackMessage: string): Promise<T> {
    const payload = await response.json().catch(() => null) as {
        data?: unknown;
        error?: { code?: unknown; message?: unknown };
        meta?: unknown;
    } | null;
    if (!response.ok) {
        const code = typeof payload?.error?.code === "string" ? payload.error.code : null;
        const message = typeof payload?.error?.message === "string" ? payload.error.message : fallbackMessage;
        if (response.status === 401 && typeof window !== "undefined") {
            broadcastAuthSessionExpired();
        }
        throw new PracticeApiError(response.status, code, message);
    }
    if (!payload) throw new PracticeApiError(502, "INVALID_PRACTICE_RESPONSE", fallbackMessage);
    return payload as T;
}

export async function practiceApi<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { cache: "no-store", ...init });
    const payload = await readPracticeApiEnvelope<{ data?: unknown }>(response, "練習服務目前無法完成要求。");
    return payload.data as T;
}

export type PracticeAccountRole = "parent" | "learner" | "tutor";

export interface PracticeAccountLearner {
    id: string;
    displayName: string;
    educationStatus: "enrolled" | "not_enrolled";
    gradeCode: string | null;
    gradeName: string | null;
    semesterCode: string | null;
    semesterName: string | null;
    preferences: {
        questionLimitOptions: number[];
        defaultQuestionLimit: number;
        defaultCheckMode: CheckMode;
    } | null;
    subjectSettings: Array<{
        position: number;
        lockVersion: number;
        subject: { code: string; name: string };
        bookVersion: {
            id: string;
            name: string;
            publisher: { code: string; name: string } | null;
        } | null;
        availableBookVersions: Array<{
            id: string;
            name: string;
            publisher: { code: string; name: string } | null;
        }>;
    }>;
    accessRole: PracticeAccountRole;
    canManageSettings: boolean;
    isSelf: boolean;
}

export interface PracticeAccount {
    displayName: string;
    email: string | null;
    emailVerified: boolean | null;
    accountRole: PracticeAccountRole | null;
    activeRole: PracticeAccountRole;
    roles: PracticeAccountRole[];
    learner: PracticeAccountLearner | null;
    learners: PracticeAccountLearner[];
    expiresAt: string;
}

/** 讀取註冊與學習者設定共用的正式教育目錄。 */
export async function loadEducationCatalog(): Promise<EducationCatalog> {
    const response = await fetch("/api/v1/auth/catalog", { cache: "no-store" });
    const envelope = await readPracticeApiEnvelope<{ data: { catalog: EducationCatalog } }>(
        response,
        "目前無法讀取教育階段與年級。",
    );
    return envelope.data.catalog;
}

/** Builds the UI learner from authorized server profile data and non-identifying browser preferences. */
export function mapPracticeAccountLearner(
    profile: PracticeAccountLearner,
    browserPreferences: PracticePreferences | null,
): Learner {
    const enabledSubjects = [...profile.subjectSettings].sort((left, right) => left.position - right.position).map((setting) => ({
        name: normalizeSubjectLabel(setting.subject.name) as Subject,
        version: setting.bookVersion?.publisher?.name.replace(/版$/u, "")
            ?? setting.bookVersion?.name
            ?? "",
    }));
    const bookVersions = Object.fromEntries(enabledSubjects.map(({ name, version }) => [name, version])) as Record<Subject, string>;
    const customSubjects = enabledSubjects.map(({ name }) => name)
        .filter((subject) => !SUBJECTS.some((systemSubject) => systemSubject === subject));
    const serverOptions = sanitizeQuestionLimitOptions(profile.preferences?.questionLimitOptions)
        ?? [...DEFAULT_QUESTION_LIMIT_OPTIONS];
    const questionLimitOptions = browserPreferences?.questionLimitOptions ?? serverOptions;
    const preferredDefault = browserPreferences?.defaultQuestionLimit
        ?? profile.preferences?.defaultQuestionLimit
        ?? questionLimitOptions[0]
        ?? DEFAULT_PLAN.questionLimit;
    const defaultQuestionLimit = questionLimitOptions.includes(preferredDefault)
        ? preferredDefault
        : questionLimitOptions[0] ?? DEFAULT_PLAN.questionLimit;

    return {
        id: profile.id,
        name: profile.displayName,
        educationStatus: profile.educationStatus,
        grade: profile.gradeName ?? "",
        semester: profile.semesterName ?? "",
        bookVersions,
        customSubjects,
        school: "",
        defaultQuestionLimit,
        questionLimitOptions,
    };
}

function cloneDefaultPlan(): PracticePlan {
    return {
        ...DEFAULT_PLAN,
        examSettings: DEFAULT_PLAN.examSettings.map((exam) => ({
            ...exam,
            ranges: Object.fromEntries(Object.entries(exam.ranges).map(([subject, range]) => [subject, { ...range }])),
        })),
        difficultyMix: { ...DEFAULT_PLAN.difficultyMix },
        scopeFilters: [...DEFAULT_PLAN.scopeFilters],
        difficultyFilters: [...DEFAULT_PLAN.difficultyFilters],
        sourceFilters: [...DEFAULT_PLAN.sourceFilters],
        questionKinds: [...DEFAULT_PLAN.questionKinds],
        metadataFilters: Object.fromEntries(Object.entries(DEFAULT_PLAN.metadataFilters).map(([key, values]) => [key, [...values]])),
    };
}

/** Creates a usable first plan from the actual authorized catalog instead of a hard-coded subject. */
export function createInitialPracticePlan(
    learner: Learner,
    questions: Question[],
    defaultCheckMode?: CheckMode,
): PracticePlan {
    const enabledSubjects = new Set([...Object.keys(learner.bookVersions), ...learner.customSubjects]);
    const firstSubject = questions.find((question) => (
        (learner.educationStatus !== "enrolled" || question.grade === learner.grade)
        && enabledSubjects.has(question.subject)
    ))?.subject;
    const semester = firstSubject && learner.semester && questions.some((question) => (
        (learner.educationStatus !== "enrolled" || question.grade === learner.grade)
        && question.subject === firstSubject
        && question.semester === learner.semester
    ))
        ? learner.semester
        : ALL_QUESTION_FILTERS;
    return {
        ...cloneDefaultPlan(),
        subject: firstSubject ?? "全部",
        ...(firstSubject && learner.bookVersions[firstSubject]
            ? { bookVersion: learner.bookVersions[firstSubject] }
            : { bookVersion: undefined }),
        semester,
        checkMode: defaultCheckMode ?? DEFAULT_PLAN.checkMode,
        questionLimit: learner.defaultQuestionLimit,
    };
}

/** Normalizes a stored plan once against the loaded catalog; later user interactions remain untouched. */
export function normalizeLoadedPracticePlan(
    plan: PracticePlan,
    learner: Learner,
    questions: Question[],
    collections: QuestionCollection[],
): PracticePlan {
    const filters: QuestionFilters = {
        subject: plan.subject as Subject | "全部",
        semester: plan.semester,
        version: plan.subject === "全部"
            ? ALL_QUESTION_FILTERS
            : plan.bookVersion || learner.bookVersions[plan.subject] || ALL_QUESTION_FILTERS,
        // 共用篩選固定走章節／單元路徑；`basis` 只保留舊設定相容用途。
        scope: plan.scopeFilters,
        topic: plan.topic,
        knowledge: plan.knowledge === ALL_KNOWLEDGE ? ALL_QUESTION_FILTERS : plan.knowledge,
        // 百分比分配暫停套用難度篩選，但不能因此清空已儲存的有效選項。
        difficulty: plan.difficultyFilters,
        kind: plan.questionKinds,
        source: plan.sourceFilters,
        creator: plan.creatorFilter,
        metadata: Object.fromEntries(Object.entries(plan.metadataFilters).map(([key, values]) => [
            key,
            values[0] ?? ALL_QUESTION_FILTERS,
        ])),
        collection: plan.collection,
        search: plan.search,
    };
    const normalized = normalizeQuestionFilters(filters, questions, collections);
    return {
        ...plan,
        subject: normalized.subject,
        bookVersion: normalized.subject === "全部" || normalized.version === ALL_QUESTION_FILTERS
            ? undefined
            : normalized.version,
        semester: normalized.semester,
        scopeFilters: normalized.scope,
        topic: normalized.topic,
        knowledge: normalized.knowledge === ALL_QUESTION_FILTERS ? ALL_KNOWLEDGE : normalized.knowledge,
        difficultyFilters: normalized.difficulty,
        questionKinds: normalized.kind,
        sourceFilters: normalized.source,
        creatorFilter: normalized.creator,
        metadataFilters: Object.fromEntries(Object.entries(normalized.metadata).flatMap(([key, value]) => (
            value === ALL_QUESTION_FILTERS ? [] : [[key, [value]]]
        ))),
        collection: normalized.collection,
    };
}

export function shouldAdvanceAfterSubmit(checkMode: CheckMode): boolean {
    return checkMode !== "instant";
}

export function switchPracticeAccountRole(targetRole: PracticeAccountRole, password?: string) {
    return practiceApi<{ account: PracticeAccount }>("/api/v1/auth/role", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetRole, ...(targetRole === "learner" ? {} : { password }) }),
    });
}

export function updatePracticeAccountIdentity(targetRole: PracticeAccountRole, password?: string) {
    return practiceApi<{ account: PracticeAccount }>("/api/v1/auth/identity", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetRole, ...(targetRole === "learner" ? {} : { password }) }),
    });
}

export function createPracticeLearner(input: {
    clientRequestId: string;
    displayName: string;
    educationStatus: PracticeAccountLearner["educationStatus"];
    gradeCode: string | null;
    semesterCode: string | null;
}) {
    return practiceApi<{ account: PracticeAccount }>("/api/v1/auth/learners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
}

export function selectPracticeLearner(learnerId: string) {
    return practiceApi<{ account: PracticeAccount }>("/api/v1/auth/learners", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "select", learnerId }),
    });
}

export function updatePracticeLearner(input: {
    learnerId: string;
    displayName: string;
    educationStatus: PracticeAccountLearner["educationStatus"];
    gradeCode: string | null;
    semesterCode: string | null;
}, action: "update" | "update-current" = "update") {
    return practiceApi<{ account: PracticeAccount }>("/api/v1/auth/learners", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...input }),
    });
}

export function updatePracticeLearnerSubjectSetting(input: {
    learnerId: string;
    subjectCode: string;
    bookVersionId: string | null;
    lockVersion: number;
}) {
    return practiceApi<{ account: PracticeAccount }>("/api/v1/auth/learners/subject-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
}

export async function loadPersistedPractice() {
    const { account } = await practiceApi<{ account: PracticeAccount }>("/api/v1/auth/me");
    if (!account.learner) return {
        account,
        questions: [],
        attempts: [],
        sessions: [],
        wrongReviewQueue: { pendingCount: 0, items: [] },
    };
    const catalogPageSize = LOCAL_PRACTICE_MAX_CATALOG_PAGE_SIZE;
    const filters = new URLSearchParams({ ...LOCAL_PRACTICE_DEFAULT_FILTERS, limit: String(catalogPageSize) });
    const getPage = async (page: number) => {
        const response = await fetch(`/api/v1/local-practice/questions?${filters}&page=${page}`, { cache: "no-store" });
        return readPracticeApiEnvelope<{ data: { questions: LocalPracticeQuestion[] }; meta: { total: number } }>(response, "目前無法讀取題庫。");
    };
    const [first, history] = await Promise.all([
        getPage(1),
        practiceApi<LocalPracticeHistory>("/api/v1/local-practice/history?limit=100"),
    ]);
    const pages = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(first.meta.total / catalogPageSize) - 1) }, (_, index) => getPage(index + 2)));
    // Attempts, score-only summaries, and pending wrong-review sources paginate independently.
    const attempts = [...history.attempts];
    const sessions = [...history.sessions];
    const wrongReviewQueueItems = [...(history.wrongReviewQueue?.items ?? [])];
    const wrongReviewPendingCount = history.wrongReviewQueue?.pendingCount
        ?? wrongReviewQueueItems.length;
    let historyPage = 2;
    let lastPageSize = Math.max(
        history.attempts.length,
        history.sessions.length,
        wrongReviewQueueItems.length,
    );
    while (lastPageSize === 100 && historyPage <= 10_000) {
        const next = await practiceApi<LocalPracticeHistory>(`/api/v1/local-practice/history?limit=100&page=${historyPage++}`);
        attempts.push(...next.attempts);
        sessions.push(...next.sessions);
        wrongReviewQueueItems.push(...(next.wrongReviewQueue?.items ?? []));
        lastPageSize = Math.max(
            next.attempts.length,
            next.sessions.length,
            next.wrongReviewQueue?.items.length ?? 0,
        );
    }
    return {
        account,
        questions: [first, ...pages].flatMap((page) => page.data.questions),
        attempts: [...new Map(attempts.map((attempt) => [attempt.id, attempt])).values()],
        sessions: [...new Map(sessions.map((session) => [session.id, session])).values()],
        wrongReviewQueue: {
            pendingCount: wrongReviewPendingCount,
            items: [...new Map(wrongReviewQueueItems.map((item) => [item.id, item])).values()],
        },
    };
}

export function previewPersistedPracticeRecommendations(input: {
    sourceQueueItemIds: string[];
    limit?: number;
}) {
    return practiceApi<LocalPracticeRecommendationResult>("/api/v1/local-practice/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", ...input }),
    });
}

export function startPersistedPracticeRecommendations(input: {
    sourceQueueItemIds: string[];
    limit?: number;
    checkMode: LocalPracticeSessionSettings["checkMode"];
    sessionId?: string;
}) {
    return practiceApi<LocalPracticeRecommendationResult>("/api/v1/local-practice/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", ...input }),
    });
}

export function startPersistedPractice(
    targets: readonly LocalPracticeSessionTarget[] | readonly string[],
    settings: LocalPracticeSessionSettings = { mode: "practice", checkMode: "instant" },
    sessionId = crypto.randomUUID(),
) {
    const legacyQuestionIds = targets.every((target): target is string => typeof target === "string");
    return practiceApi<{ session: LocalPracticeSession }>("/api/v1/local-practice/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            sessionId,
            ...(legacyQuestionIds ? { questionIds: targets } : { questions: targets }),
            mode: settings.mode,
            checkMode: settings.checkMode,
        }),
    });
}

export function getPersistedPracticeSession(sessionId: string) {
    return practiceApi<LocalPracticeSessionRead>(`/api/v1/local-practice/sessions?id=${encodeURIComponent(sessionId)}`);
}

export function getPersistedQuestionReferenceAnswers(questionId: string, revisionId: string) {
    const query = new URLSearchParams({ revisionId });
    return practiceApi<{
        questionId: string;
        revisionId: string;
        referenceAnswers: LocalPracticeReferenceAnswer[];
    }>(`/api/v1/local-practice/questions/${encodeURIComponent(questionId)}/reference-answer?${query}`);
}

/**
 * 辨識尚未送出的手寫內容，不建立正式作答紀錄。
 * @param handwriting 目前手寫板的 PNG 內容。
 * @param signal 取消尚未完成的預覽請求。
 * @returns 可辨識文字與清晰狀態。
 */
export function transcribePersistedHandwriting(handwriting: LocalPracticeHandwritingInput, signal?: AbortSignal) {
    return practiceApi<{ transcription: string | null; legibility: "clear" | "uncertain" | "unreadable" }>(
        "/api/v1/local-practice/handwriting/transcription",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ handwriting }),
            signal,
        },
    );
}

export function submitPersistedPracticeAttempt(input: {
    sessionId: string;
    questionId: string;
    sessionItemId?: string;
    partId?: string;
    idempotencyKey: string;
    durationSeconds: number | null;
    answers: LocalPracticeAnswerInput[];
    handwriting?: LocalPracticeHandwritingInput;
}) {
    return practiceApi<LocalPracticeAttemptSubmission>("/api/v1/local-practice/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
}

export function updatePersistedPracticeSessionStatus(
    sessionId: string,
    status: "active" | "paused" | "abandoned",
) {
    return practiceApi<{ session: LocalPracticeSession }>("/api/v1/local-practice/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, status }),
    });
}
