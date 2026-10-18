/** Versioned protocol shared by the API and learner UI. */
export const LEARNING_BOOK_POLICY = Object.freeze({ maxQuestions: 500, shareDays: 7, pageSize: 30, maxPageSize: 100, localBackupDays: 30, shareInvitesPerHour:100, shareLookupsPerHour:300 });
export const LEARNING_BOOK_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class LearningBookError extends Error {
    constructor(readonly code: string, message: string, readonly status = 400) { super(message); this.name = "LearningBookError"; }
}
export interface LearningBookActor { userId: string; learnerId: string; role: string }
export interface LearningBookQuestion { questionId: string; revisionId?: string; partId?: string }
export interface LearningBookContent {
    name: string; checkMode: "complete" | "instant" | "score";
    questions: LearningBookQuestion[]; filterSnapshot: Record<string, unknown>;
}
export interface LearningBookPerson { id: string; displayName: string }
export interface LearningBookDto {
    id: string; planId: string; subscriptionId: string | null; source: "mine" | "shared";
    name: string; status: string; lockVersion: number; revisionId: string | null; revisionNumber: number;
    hasDraft: boolean; publishedRevisionNumber: number | null;
    creator: LearningBookPerson; sharer: LearningBookPerson | null;
    activeScheduleCount: number; syncStatus: "synced" | "updated" | "revoked"; canEdit: boolean;
    createdAt: string; updatedAt: string; questions: LearningBookQuestion[];
    checkMode: LearningBookContent["checkMode"]; filterSnapshot: Record<string, unknown>;
}
export interface LearningBookListResult { books: LearningBookDto[]; nextCursor: string | null; total: number; facets: { creators: LearningBookPerson[]; sharers: LearningBookPerson[] } }
export interface LearningBookScheduleDto {
    id: string; planId: string | null; subscriptionId: string | null; revisionId: string;
    name: string; scheduledFor: string; status: string; checkMode: LearningBookContent["checkMode"];
    lockVersion: number; questions: LearningBookQuestion[]; canStart: boolean; sourceHasUpdate: boolean;
    sessionId: string | null;
}
export interface LearningBookInviteDto { id: string; createdAt: string; expiresAt: string; redeemedAt: string | null; revokedAt: string | null; subscriptionId: string | null }
export interface LearningBookDetail extends LearningBookDto { schedules: LearningBookScheduleDto[]; invitations: LearningBookInviteDto[] }
export interface LearningBookNotificationDto { id: string; kind: string; planId: string | null; subscriptionId: string | null; revisionId: string | null; createdAt: string; readAt: string | null }
export interface LearningBookMigrationResult { migrationId: string; importedBooks: number; importedSchedules: number; bookIds: string[]; unresolvedItems: unknown[]; replayed?: boolean }
export function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
export function uuid(value: unknown, label = "識別碼"): string {
    if (typeof value !== "string" || !LEARNING_BOOK_UUID.test(value)) throw new LearningBookError("INVALID_ID", `${label}格式不正確。`);
    return value.toLowerCase();
}
export function parseLearningBookSettings(value:unknown):Omit<LearningBookContent,"questions"> {
    if (!record(value)) throw new LearningBookError("INVALID_CONTENT", "學習本資料格式不正確。");
    const name = typeof value.name === "string" ? value.name.normalize("NFC").trim() : "";
    if (!name || name.length > 140 || /[\u0000-\u001f]/u.test(name)) throw new LearningBookError("INVALID_NAME", "請輸入 1 到 140 字的學習本名稱。");
    const checkMode = value.checkMode ?? "instant";
    if (!["complete", "instant", "score"].includes(String(checkMode))) throw new LearningBookError("INVALID_CHECK_MODE", "檢核方式不正確。");
    const filterSnapshot = value.filterSnapshot ?? {};
    if (!record(filterSnapshot) || JSON.stringify(filterSnapshot).length > 64_000) throw new LearningBookError("INVALID_FILTERS", "篩選設定格式不正確。");
    return { name, checkMode: checkMode as LearningBookContent["checkMode"], filterSnapshot };
}
export function parseContent(value: unknown): LearningBookContent {
    const settings=parseLearningBookSettings(value);
    if(!record(value)) throw new LearningBookError("INVALID_CONTENT","學習本資料格式不正確。");
    if (!Array.isArray(value.questions) || !value.questions.length || value.questions.length > LEARNING_BOOK_POLICY.maxQuestions) throw new LearningBookError("INVALID_QUESTIONS", "學習本需包含 1 到 500 道題目。");
    const questions = value.questions.map((q): LearningBookQuestion => {
        if (!record(q)) throw new LearningBookError("INVALID_QUESTIONS", "題目格式不正確。");
        return { questionId: uuid(q.questionId), ...(q.revisionId ? { revisionId: uuid(q.revisionId) } : {}), ...(q.partId ? { partId: uuid(q.partId) } : {}) };
    });
    const identities = new Set<string>();
    const revisions = new Map<string,string|undefined>();
    for (const q of questions) {
        if(revisions.has(q.questionId)&&revisions.get(q.questionId)!==q.revisionId) throw new LearningBookError("MIXED_QUESTION_REVISIONS", "同一道題目的小題必須使用相同修訂版本。", 409);
        revisions.set(q.questionId,q.revisionId);
        const key = `${q.questionId}:${q.partId ?? "all"}`;
        if (identities.has(key) || (q.partId && identities.has(`${q.questionId}:all`)) || (!q.partId && questions.some((other) => other.questionId === q.questionId && other.partId))) throw new LearningBookError("DUPLICATE_QUESTIONS", "題目或小題不能重複或重疊。");
        identities.add(key);
    }
    return { ...settings, questions };
}
export function parseLock(value: unknown): number {
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new LearningBookError("INVALID_VERSION", "請提供目前版本編號。");
    return Number(value);
}
export function parseScheduleDate(value: unknown): string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new LearningBookError("INVALID_DATE", "排程時間需包含時區。");
    return new Date(value).toISOString();
}
export function parseShareToken(value: unknown): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new LearningBookError("INVALID_SHARE", "分享網址無效。", 404);
    return value;
}
export interface LearningBookListQuery {
    arrangement: "all" | "scheduled" | "unscheduled"; source: "all" | "mine" | "shared";
    status: "active" | "archived" | "all"; sync: "all" | "synced" | "updated" | "revoked";
    creatorIds: string[]; sharerIds: string[]; search: string;
    sort: "updated" | "created" | "scheduled" | "name"; cursor: string | null; limit: number;
}
export interface LearningBookCursor { sort:LearningBookListQuery["sort"]; key:string|null; id:string }
export function decodeLearningBookCursor(value:string|null,sort:LearningBookListQuery["sort"]):LearningBookCursor|null {
    if(value===null||value==='')return null;
    try {
        if(value.length>1024||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error();
        const parsed:unknown=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
        if(!record(parsed)||parsed.sort!==sort||(parsed.key!==null&&typeof parsed.key!=='string'))throw new Error();
        const id=uuid(parsed.id);
        if(parsed.key===null&&sort!=='scheduled')throw new Error();
        if(sort!=='name'&&parsed.key!==null&&!Number.isFinite(Date.parse(String(parsed.key))))throw new Error();
        if(typeof parsed.key==='string'&&parsed.key.length>140)throw new Error();
        return {sort,key:parsed.key as string|null,id};
    }catch{throw new LearningBookError('INVALID_PAGE','分頁已失效，請重新載入清單。');}
}
export function encodeLearningBookCursor(value:LearningBookCursor):string {return Buffer.from(JSON.stringify(value),'utf8').toString('base64url');}
export function parseListQuery(params: URLSearchParams): LearningBookListQuery {
    const choice = <T extends string>(key: string, choices: T[], fallback: T): T => {
        const value = params.get(key) ?? fallback;
        if (!choices.includes(value as T)) throw new LearningBookError("INVALID_FILTER", "清單篩選格式不正確。");
        return value as T;
    };
    const ids = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean).map((id) => uuid(id));
    const cursorText = params.get("cursor");
    const limitText = params.get("limit") ?? String(LEARNING_BOOK_POLICY.pageSize);
    if (!/^\d+$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > LEARNING_BOOK_POLICY.maxPageSize) throw new LearningBookError("INVALID_PAGE", "分頁格式不正確。");
    const search = (params.get("search") ?? "").normalize("NFC").trim();
    if (search.length > 140) throw new LearningBookError("INVALID_SEARCH", "搜尋文字過長。");
    const sort=choice("sort", ["updated", "created", "scheduled", "name"], "updated");
    decodeLearningBookCursor(cursorText,sort);
    return { arrangement: choice("arrangement", ["all", "scheduled", "unscheduled"], "all"), source: choice("source", ["all", "mine", "shared"], "all"), status: choice("status", ["active", "archived", "all"], "active"), sync: choice("sync", ["all", "synced", "updated", "revoked"], "all"), creatorIds: ids("creatorIds"), sharerIds: ids("sharerIds"), search, sort, cursor: cursorText, limit: Number(limitText) };
}
