"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, FormField, Input } from "@keel-design/ui";
import { ArrowLeft, ArrowRight, Bell, BookOpen, CalendarDays, Copy, Link2, Plus, RefreshCw } from "lucide-react";
import type { LearningBookContent, LearningBookDetail, LearningBookDto, LearningBookInviteDto, LearningBookListQuery, LearningBookListResult, LearningBookMigrationResult, LearningBookNotificationDto, LearningBookPerson, LearningBookScheduleDto } from "../lib/learning-book-contract";
import { LEARNING_BOOK_POLICY } from "../lib/learning-book-contract";
import { createLearningBook, getLearningBook, learningBookMutation, learningBookQuery, listLearningBooks, type LegacyBookMigration } from "../lib/learning-book-client";
import { completeLearningBookMigration, previewLearningBookMigration, readLearningBookMigrationReceipt } from "../lib/learning-book-migration";
import { practiceApi, PracticeApiError, readLegacyPracticePreferences, writePracticeSessionHint } from "../lib/practice-client";
import type { LocalPracticeQuestion, LocalPracticeSession } from "../lib/local-practice-types";
import "./learning-book-workspace.css";

const syncLabels = { synced: "已同步", updated: "來源已有新版", revoked: "已停止分享" };
const scheduleLabels: Record<string, string> = { scheduled: "已安排", available: "可開始", in_progress: "進行中", completed: "已完成", cancelled: "已取消", missed: "已錯過" };
const notificationLabels: Record<string, string> = { share_received: "收到學習本分享", shared: "收到學習本分享", share_redeemed: "學習本分享已領取", revision_published: "學習本已有新版", updated: "學習本已有新版", share_revoked: "學習本分享已撤銷", revoked: "學習本分享已撤銷" };
const displayDate = (value: string) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const today = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

function PeopleFilter({ label, people, values, onChange }: { label: string; people: LearningBookPerson[]; values: string[]; onChange: (values: string[]) => void }) {
    const [search, setSearch] = useState("");
    const visible = people.filter((person) => person.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    return <details className="learning-book-people-filter"><summary>{label} · {values.length ? `已選 ${values.length}` : "全部"}</summary>
        <div><Input aria-label={`搜尋${label}`} placeholder={`搜尋${label}`} value={search} onChange={(event) => setSearch(event.target.value)} />
            <div className="learning-book-actions"><Button size="sm" appearance="ghost" onClick={() => onChange([...new Set([...values, ...visible.map((person) => person.id)])])}>全選</Button><Button size="sm" appearance="ghost" onClick={() => onChange([])}>取消選擇</Button></div>
            {visible.map((person) => <label key={person.id}><input type="checkbox" checked={values.includes(person.id)} onChange={(event) => onChange(event.target.checked ? [...values, person.id] : values.filter((id) => id !== person.id))} />{person.displayName}</label>)}
            {!visible.length && <p>沒有符合的{label}</p>}
        </div>
    </details>;
}

interface Props {
    learnerId: string;
    canCreatePlans: boolean;
    currentContent: LearningBookContent | null;
    catalog: ReadonlyMap<number, LocalPracticeQuestion>;
    refreshToken?: number;
    onChanged: () => void;
    onStarted: (sessionId: string) => void;
    onBack: () => void;
}

/** The API is authoritative; browser preferences are read solely for explicit migration. */
export function LearningBookWorkspace({ learnerId, canCreatePlans, currentContent, catalog, refreshToken = 0, onChanged, onStarted, onBack }: Props) {
    const [filters, setFilters] = useState<Partial<LearningBookListQuery>>({ arrangement: "all", source: "all", sync: "all", status: "active", sort: "updated", creatorIds: [], sharerIds: [], search: "" });
    const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null]);
    const [result, setResult] = useState<LearningBookListResult>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [reload, setReload] = useState(0);
    const [busy, setBusy] = useState("");
    const [detail, setDetail] = useState<LearningBookDetail>();
    const [editName, setEditName] = useState("");
    const [editMode, setEditMode] = useState<LearningBookContent["checkMode"]>("instant");
    const [replaceQuestions, setReplaceQuestions] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [createName, setCreateName] = useState("");
    const [scheduleBook, setScheduleBook] = useState<LearningBookDto>();
    const [scheduleDate, setScheduleDate] = useState(today);
    const [scheduleTime, setScheduleTime] = useState("");
    const [sharePath, setSharePath] = useState("");
    const [notifications, setNotifications] = useState<LearningBookNotificationDto[]>([]);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const [migration, setMigration] = useState<LegacyBookMigration>();
    const [migrationOpen, setMigrationOpen] = useState(false);
    const [migrationCompleted, setMigrationCompleted] = useState(false);
    const idempotencyKeys = useRef(new Map<string, string>());
    const busyRef = useRef(false);
    const query = learningBookQuery(learnerId, filters).toString();

    useEffect(() => {
        let active = true;
        setLoading(true); setError("");
        const timeout = setTimeout(() => {
            listLearningBooks(learnerId, filters).then((data) => { if (active) setResult(data); })
                .catch((failure: unknown) => { if (active) { setResult(undefined); setError(failure instanceof Error ? failure.message : "無法讀取學習本。"); } })
                .finally(() => { if (active) setLoading(false); });
        }, 180);
        return () => { active = false; clearTimeout(timeout); };
        // The serialized query captures all filter values without object-identity refetches.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [learnerId, query, reload, refreshToken]);

    useEffect(() => {
        setDetail(undefined); setSharePath(""); setMigration(undefined); setMigrationCompleted(false);
        try {
            const receipt = readLearningBookMigrationReceipt(learnerId);
            setMigrationCompleted(Boolean(receipt.completedAt));
            if (!receipt.completedAt) {
                const legacy = readLegacyPracticePreferences(learnerId);
                if (legacy && (legacy.plan || legacy.schedules.length)) setMigration(previewLearningBookMigration(learnerId, receipt.migrationId, legacy, catalog));
            }
        }
        catch { setError("無法讀取本機資料備份；原資料仍保留，請確認瀏覽器允許儲存後重試。"); }
    }, [learnerId, catalog]);

    useEffect(() => {
        let active = true;
        practiceApi<{ notifications: LearningBookNotificationDto[] }>(`/api/v1/learning-books/notifications?${learningBookQuery(learnerId)}`)
            .then((data) => { if (active) setNotifications(data.notifications); })
            .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : "無法讀取通知。"); });
        return () => { active = false; };
    }, [learnerId, reload]);

    const run = useCallback(async (key: string, operation: (idempotencyKey: string) => Promise<void>) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(key); setError(""); setNotice("");
        const idempotencyKey = idempotencyKeys.current.get(key) ?? crypto.randomUUID();
        idempotencyKeys.current.set(key, idempotencyKey);
        try { await operation(idempotencyKey); idempotencyKeys.current.delete(key); setReload((value) => value + 1); onChanged(); }
        catch (failure) {
            if (failure instanceof PracticeApiError && failure.status >= 400 && failure.status < 500 && failure.status !== 429) idempotencyKeys.current.delete(key);
            setError(failure instanceof Error ? failure.message : "操作尚未完成，請重試。");
            if (failure instanceof PracticeApiError && failure.status === 409) setReload((value) => value + 1);
        }
        finally { busyRef.current = false; setBusy(""); }
    }, [onChanged]);

    function changeFilter<K extends keyof LearningBookListQuery>(key: K, value: LearningBookListQuery[K]) {
        setCursorHistory([null]);
        setFilters((current) => ({ ...current, [key]: value, cursor: undefined }));
    }
    function openDetail(book: LearningBookDto) {
        void run(`detail:${book.id}`, async () => {
            const loaded = await getLearningBook(learnerId, book.id);
            setDetail(loaded); setEditName(loaded.name); setEditMode(loaded.checkMode); setReplaceQuestions(false); setSharePath("");
        });
    }
    function start(book: LearningBookDto, schedule?: LearningBookScheduleDto) {
        void run(`start:${schedule?.id ?? book.id}`, async (sessionId) => {
            if (schedule?.sessionId && schedule.status === "in_progress") {
                if (!writePracticeSessionHint(learnerId, schedule.sessionId)) throw new Error("無法保存練習恢復識別碼。");
                onStarted(schedule.sessionId); return;
            }
            const source = schedule ? { practiceScheduleId: schedule.id } : book.subscriptionId ? { subscriptionId: book.subscriptionId } : { practicePlanId: book.planId };
            const data = await practiceApi<{ session: LocalPracticeSession }>("/api/v1/local-practice/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...source, sessionId }) });
            if (!writePracticeSessionHint(learnerId, data.session.id)) throw new Error("練習已建立，但瀏覽器無法保留恢復識別碼；請允許瀏覽器儲存後重試。");
            onStarted(data.session.id);
        });
    }
    async function reloadDetail(id: string) { setDetail(await getLearningBook(learnerId, id)); }
    function saveDraft() {
        if (!detail) return;
        void run(`edit:${detail.id}`, async (key) => {
            await learningBookMutation(`/${detail.id}`, {
                action: "edit", learnerId, lockVersion: detail.lockVersion, idempotencyKey: key,
                name: editName, checkMode: editMode,
                questions: replaceQuestions ? currentContent!.questions : detail.questions,
                filterSnapshot: replaceQuestions ? currentContent!.filterSnapshot : detail.filterSnapshot,
            }, "PATCH");
            await reloadDetail(detail.id); setReplaceQuestions(false);
            setNotice("草稿已儲存，發布更新後才能用於新的排程與分享。");
        });
    }
    function createInvite() {
        if (!detail) return;
        void run(`share:${detail.id}`, async (key) => {
            const shared = await learningBookMutation<{ invite: LearningBookInviteDto; path: string | null }>(`/${detail.id}/share`, { learnerId, idempotencyKey: key });
            if (shared.path) setSharePath(new URL(shared.path, window.location.origin).href);
            else setNotice("這個邀請的網址已發出過，系統不保留原文；請重新產生新的邀請網址。");
            await reloadDetail(detail.id);
        });
    }
    const disabled = Boolean(busy);
    const draftHasUnsavedChanges = Boolean(detail && (editName !== detail.name || editMode !== detail.checkMode || replaceQuestions));

    return <div className="learning-book-workspace">
        <Card className="workspace-card learning-book-card border-border/80 shadow-sm">
        <CardHeader className="practice-card-header learning-book-header"><div className="workspace-heading"><div className="workspace-heading-icon"><BookOpen size={19} /></div><div><CardTitle asChild><h1>學習本計畫</h1></CardTitle><CardDescription>保存學習內容，自由安排時間，也能接收與分享學習本。</CardDescription></div></div>
            <div className="practice-header-actions learning-book-header-actions"><Button appearance="outline" onClick={onBack}><ArrowLeft />返回練習</Button><Button appearance="outline" onClick={() => setNotificationsOpen((value) => !value)}><Bell />通知{notifications.filter((item) => !item.readAt).length > 0 && ` ${notifications.filter((item) => !item.readAt).length}`}</Button><Button disabled={!canCreatePlans || !currentContent || disabled} onClick={() => { setCreateName(currentContent?.name ?? ""); setCreateOpen(true); }}><Plus />建立學習本</Button></div>
        </CardHeader>
        <CardContent className="learning-book-main">
        {error && <p className="learning-book-message learning-book-error" role="alert">{error}<Button size="sm" appearance="ghost" onClick={() => setReload((value) => value + 1)}>重新載入</Button></p>}
        {notice && <p className="learning-book-message" role="status">{notice}</p>}
        {!canCreatePlans && <p className="learning-book-message">目前具有檢視權限；建立、排程及建立副本需由學習者管理者開啟權限。</p>}
        {migration && !migrationCompleted && <div className="learning-book-message"><span>偵測到這個學習者在此瀏覽器的舊資料，請先預覽後匯入。</span><Button appearance="outline" size="sm" onClick={() => setMigrationOpen(true)}>預覽本機資料</Button></div>}
        {notificationsOpen && <section className="learning-book-notifications" aria-label="站內通知"><h2>站內通知</h2>{!notifications.length && <p>目前沒有通知。</p>}{notifications.map((item) => <div key={item.id}><span>{notificationLabels[item.kind] ?? "學習本狀態更新"}</span><small>{displayDate(item.createdAt)}</small>{!item.readAt && <Button size="sm" appearance="ghost" disabled={disabled} onClick={() => void run(`read:${item.id}`, async () => { await learningBookMutation("/notifications", { learnerId, ids: [item.id] }, "PATCH"); })}>標為已讀</Button>}</div>)}</section>}
        <section className="learning-book-filters" aria-label="學習本篩選">
            <FormField label="搜尋學習本"><Input placeholder="搜尋名稱" maxLength={140} value={filters.search} onChange={(event) => changeFilter("search", event.target.value)} /></FormField>
            <FormField label="安排狀態"><select className="learning-book-select" value={filters.arrangement} onChange={(event) => changeFilter("arrangement", event.target.value as LearningBookListQuery["arrangement"])}><option value="all">全部</option><option value="unscheduled">未安排</option><option value="scheduled">已安排</option></select></FormField>
            <FormField label="來源"><select className="learning-book-select" value={filters.source} onChange={(event) => changeFilter("source", event.target.value as LearningBookListQuery["source"])}><option value="all">全部</option><option value="mine">我建立的</option><option value="shared">分享給我的</option></select></FormField>
            <FormField label="同步狀態"><select className="learning-book-select" value={filters.sync} onChange={(event) => changeFilter("sync", event.target.value as LearningBookListQuery["sync"])}><option value="all">全部</option><option value="synced">已同步</option><option value="updated">有新版</option><option value="revoked">已停止分享</option></select></FormField>
            <FormField label="學習本狀態"><select className="learning-book-select" value={filters.status} onChange={(event) => changeFilter("status", event.target.value as LearningBookListQuery["status"])}><option value="active">使用中</option><option value="archived">已封存</option><option value="all">全部</option></select></FormField>
            <FormField label="排序"><select className="learning-book-select" value={filters.sort} onChange={(event) => changeFilter("sort", event.target.value as LearningBookListQuery["sort"])}><option value="updated">最近更新</option><option value="created">最近建立</option><option value="scheduled">最近安排</option><option value="name">名稱</option></select></FormField>
            <PeopleFilter label="建立者" people={result?.facets.creators ?? []} values={filters.creatorIds ?? []} onChange={(values) => changeFilter("creatorIds", values)} />
            <PeopleFilter label="分享者" people={result?.facets.sharers ?? []} values={filters.sharerIds ?? []} onChange={(values) => changeFilter("sharerIds", values)} />
        </section>
        <div className="learning-book-list-heading"><span aria-live="polite">{loading ? "讀取中…" : `共 ${result?.total ?? 0} 本`}</span><Button size="sm" appearance="ghost" disabled={loading || disabled} onClick={() => setReload((value) => value + 1)}><RefreshCw />重新整理</Button></div>
        <ul className="learning-book-list" aria-busy={loading}>
            {result?.books.map((book) => <li className="learning-book-item" key={book.id}>
                <div className="learning-book-tags">
                    <Badge tone="primary">{book.source === "mine" ? "我的學習本" : "收到分享"}</Badge>
                    <Badge>{book.activeScheduleCount ? `已安排 ${book.activeScheduleCount} 次` : "未安排"}</Badge>
                    {book.source === "shared" && <Badge>{syncLabels[book.syncStatus]}</Badge>}
                    {book.hasDraft && <Badge>{book.status === "draft" ? "草稿" : "有未發布草稿"}</Badge>}
                    {book.status === "archived" && <Badge>已封存</Badge>}
                </div>
                <h2>{book.name}</h2>
                <p>{book.questions.length ? `${book.hasDraft ? "草稿 " : ""}${book.questions.length} 題` : "原篩選設定 · 待確認題目"} · {book.publishedRevisionNumber ? `已發布第 ${book.publishedRevisionNumber} 版` : "尚未發布"}</p>
                <dl><div><dt>建立者</dt><dd>{book.creator.displayName}</dd></div><div><dt>分享者</dt><dd>{book.sharer?.displayName ?? "—"}</dd></div></dl>
                <div className="learning-book-actions">
                    <Button appearance="outline" disabled={disabled} onClick={() => openDetail(book)}>查看與管理</Button>
                    <Button disabled={disabled || !book.questions.length || book.status !== "active" || book.syncStatus === "revoked" || !book.publishedRevisionNumber} onClick={() => start(book)}>開始練習<ArrowRight /></Button>
                </div>
            </li>)}
            {!loading && result && !result.books.length && <li className="learning-book-empty"><BookOpen /><h2>沒有符合的學習本</h2><p>可調整篩選，或回到練習頁選擇內容後建立。</p></li>}
        </ul>
        <nav className="learning-book-pagination" aria-label="學習本分頁">
            <Button appearance="outline" disabled={cursorHistory.length < 2 || loading} onClick={() => {
                const previous = cursorHistory.slice(0, -1);
                setCursorHistory(previous); setFilters((current) => ({ ...current, cursor: previous.at(-1) ?? undefined }));
            }}>上一頁</Button>
            <span>第 {cursorHistory.length} 頁</span>
            <Button appearance="outline" disabled={!result?.nextCursor || loading} onClick={() => {
                if (!result?.nextCursor) return;
                setCursorHistory((current) => [...current, result.nextCursor]); setFilters((current) => ({ ...current, cursor: result.nextCursor ?? undefined }));
            }}>下一頁</Button>
        </nav>
        </CardContent>
        </Card>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent closeLabel="關閉建立學習本"><DialogHeader><DialogTitle>建立學習本計畫</DialogTitle><DialogDescription>使用練習頁目前選取的 {currentContent?.questions.length ?? 0} 題。日期可稍後安排。</DialogDescription></DialogHeader><DialogBody><FormField label="學習本名稱"><Input maxLength={140} value={createName} onChange={(event) => setCreateName(event.target.value)} /></FormField></DialogBody><DialogFooter><Button appearance="outline" disabled={disabled} onClick={() => setCreateOpen(false)}>取消</Button><Button appearance="outline" disabled={disabled || !createName.trim() || !currentContent} onClick={() => void run("create-draft", async (key) => { await createLearningBook(learnerId, { ...currentContent!, name: createName }, false, key); setCreateOpen(false); setNotice("學習本草稿已儲存。"); })}>儲存草稿</Button><Button disabled={disabled || !createName.trim() || !currentContent} onClick={() => void run("create", async (key) => { await createLearningBook(learnerId, { ...currentContent!, name: createName }, true, key); setCreateOpen(false); setNotice("學習本已儲存並發布，可開始、安排或分享。"); })}>儲存並發布</Button></DialogFooter></DialogContent></Dialog>

        <Dialog open={Boolean(detail)} onOpenChange={(open) => { if (!open) setDetail(undefined); }}><DialogContent className="learning-book-detail-dialog" closeLabel="關閉學習本"><DialogHeader><DialogTitle>{detail?.name}</DialogTitle><DialogDescription>{detail?.source === "shared" ? "內容跟隨來源已發布版本；排程與已開始的練習固定原版本。" : "修改先存草稿，發布更新後才會同步給收件者。"}</DialogDescription></DialogHeader><DialogBody>{detail && <div className="learning-book-detail">
            <div className="learning-book-tags"><Badge>{detail.status === "draft" ? "草稿" : detail.status === "archived" ? "已封存" : `已發布第 ${detail.publishedRevisionNumber} 版`}</Badge>{detail.hasDraft && <Badge>第 {detail.revisionNumber} 版草稿</Badge>}<Badge>{detail.questions.length} 題</Badge>{detail.source === "shared" && <Badge>{syncLabels[detail.syncStatus]}</Badge>}</div>
            {detail.canEdit && detail.status !== "archived" && <fieldset disabled={disabled}>
                <legend>編輯草稿</legend>
                {!detail.questions.length && <p>原篩選設定已完整保留。請先回練習頁確認範圍，再明確勾選取代草稿；儲存並發布後即可安排與分享。</p>}
                <FormField label="名稱"><Input maxLength={140} value={editName} onChange={(event) => setEditName(event.target.value)} /></FormField>
                <FormField label="檢核方式"><select className="learning-book-select" value={editMode} onChange={(event) => setEditMode(event.target.value as LearningBookContent["checkMode"])}><option value="instant">每題即時檢核</option><option value="complete">全部完成後檢核</option><option value="score">人工批改</option></select></FormField>
                <label className="learning-book-checkbox"><input type="checkbox" checked={replaceQuestions} disabled={!currentContent} onChange={(event) => setReplaceQuestions(event.target.checked)} />以練習頁目前選取的 {currentContent?.questions.length ?? 0} 題取代草稿內容</label>
                {draftHasUnsavedChanges && <p>請先儲存草稿，再發布更新。</p>}
                <div className="learning-book-actions"><Button appearance="outline" disabled={!editName.trim() || (!detail.questions.length && !replaceQuestions)} onClick={saveDraft}>儲存草稿</Button><Button disabled={!detail.hasDraft || !detail.questions.length || draftHasUnsavedChanges} onClick={() => void run(`publish:${detail.id}`, async (key) => { await learningBookMutation(`/${detail.id}`, { action: "publish", learnerId, lockVersion: detail.lockVersion, idempotencyKey: key }, "PATCH"); await reloadDetail(detail.id); setNotice("新版已發布。"); })}>發布更新</Button></div>
            </fieldset>}
            <div className="learning-book-actions">
                <Button disabled={disabled || !canCreatePlans || !detail.questions.length || detail.status !== "active" || detail.syncStatus === "revoked"} onClick={() => { setScheduleBook(detail); setScheduleDate(today()); setScheduleTime(""); }}><CalendarDays />新增排程</Button>
                {detail.source === "shared" && <Button appearance="outline" disabled={disabled || !canCreatePlans || detail.syncStatus === "revoked"} onClick={() => void run(`fork:${detail.id}`, async (key) => { await learningBookMutation(`/${detail.id}/fork`, { learnerId, idempotencyKey: key }); setNotice("個人副本已建立，副本不會接收來源更新。"); setDetail(undefined); })}><Copy />建立個人副本</Button>}
                {detail.canEdit && detail.status === "active" && <Button appearance="outline" disabled={disabled || !detail.questions.length} onClick={createInvite}><Link2 />產生分享網址</Button>}
                {detail.canEdit && detail.status !== "archived" && <Button appearance="ghost" disabled={disabled} onClick={() => void run(`archive:${detail.id}`, async (key) => { await learningBookMutation(`/${detail.id}`, { action: "archive", learnerId, lockVersion: detail.lockVersion, idempotencyKey: key }, "PATCH"); setDetail(undefined); setNotice("學習本已封存，歷史紀錄保留。"); })}>封存學習本</Button>}
            </div>
            {sharePath && <div className="learning-book-share-result"><FormField label="分享網址（七天有效、單次領取）"><Input readOnly value={sharePath} onFocus={(event) => event.target.select()} /></FormField><Button appearance="outline" onClick={async () => { try { await navigator.clipboard.writeText(sharePath); setNotice("分享網址已複製。"); } catch { setNotice("請選取分享網址後複製。"); } }}>複製網址</Button></div>}
            <section><h3>排程</h3>
                {!detail.schedules.length && <p>尚未安排，可直接開始練習或稍後新增排程。</p>}
                {detail.schedules.map((schedule) => <div className="learning-book-schedule" key={schedule.id}>
                    <div><strong>{displayDate(schedule.scheduledFor)}</strong><span>{scheduleLabels[schedule.status] ?? schedule.status}{schedule.sourceHasUpdate ? " · 來源已有新版，本排程保留原版" : ""}</span></div>
                    <div className="learning-book-actions"><Button size="sm" disabled={disabled || (!schedule.canStart && !(schedule.status === "in_progress" && schedule.sessionId))} onClick={() => start(detail, schedule)}>{schedule.status === "in_progress" ? "繼續練習" : "開始練習"}</Button>
                        {canCreatePlans && ["scheduled", "available"].includes(schedule.status) && <Button size="sm" appearance="ghost" disabled={disabled} onClick={() => void run(`cancel:${schedule.id}`, async (key) => {
                            await learningBookMutation("/schedules", { learnerId, scheduleId: schedule.id, status: "cancelled", lockVersion: schedule.lockVersion, idempotencyKey: key }, "PATCH"); await reloadDetail(detail.id);
                        })}>取消排程</Button>}
                    </div>
                </div>)}
            </section>
            {detail.canEdit && <section><h3>分享管理</h3>
                {!detail.invitations.length && <p>尚未產生分享邀請。</p>}
                {detail.invitations.map((invite) => <div className="learning-book-schedule" key={invite.id}>
                    <div><strong>{invite.revokedAt ? "已撤銷" : invite.redeemedAt ? "已領取 · 持續同步" : new Date(invite.expiresAt).getTime() <= Date.now() ? "已過期" : "等待領取"}</strong><span>到期 {displayDate(invite.expiresAt)}</span></div>
                    {!invite.revokedAt && <Button size="sm" appearance="outline" disabled={disabled} onClick={() => void run(`revoke:${invite.id}`, async (key) => {
                        await learningBookMutation(`/${detail.id}/share`, { learnerId, inviteId: invite.id, idempotencyKey: key, ...(invite.subscriptionId ? { subscriptionId: invite.subscriptionId } : {}) }, "DELETE");
                        await reloadDetail(detail.id); setNotice("分享已撤銷；既有完成紀錄保留。");
                    })}>撤銷分享</Button>}
                </div>)}
            </section>}
        </div>}</DialogBody></DialogContent></Dialog>

        <Dialog open={Boolean(scheduleBook)} onOpenChange={(open) => { if (!open) setScheduleBook(undefined); }}><DialogContent closeLabel="關閉新增排程"><DialogHeader><DialogTitle>安排練習</DialogTitle><DialogDescription>{scheduleBook?.name} · 本次固定使用已發布第 {scheduleBook?.publishedRevisionNumber} 版；可重複安排。</DialogDescription></DialogHeader><DialogBody><div className="learning-book-schedule-fields"><FormField label="日期"><Input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} /></FormField><FormField label="時間（選填，台北時間）"><Input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} /></FormField></div></DialogBody><DialogFooter><Button appearance="outline" disabled={disabled} onClick={() => setScheduleBook(undefined)}>取消</Button><Button disabled={disabled || !scheduleDate || !scheduleBook} onClick={() => void run(`schedule:${scheduleBook!.id}`, async (key) => { await learningBookMutation("/schedules", { learnerId, bookId: scheduleBook!.id, scheduledFor: `${scheduleDate}T${scheduleTime || "00:00"}:00+08:00`, idempotencyKey: key }); if (detail) await reloadDetail(detail.id); setScheduleBook(undefined); setNotice("排程已新增，使用建立時的學習本版本。"); })}>新增排程</Button></DialogFooter></DialogContent></Dialog>

        <Dialog open={migrationOpen} onOpenChange={setMigrationOpen}><DialogContent closeLabel="關閉本機資料預覽"><DialogHeader><DialogTitle>預覽本機資料匯入</DialogTitle><DialogDescription>確認後才寫入資料庫；原始瀏覽器資料與備份至少保留 {LEARNING_BOOK_POLICY.localBackupDays} 天，匯入不會覆蓋既有學習本。</DialogDescription></DialogHeader><DialogBody>{migration && <div className="learning-book-migration"><p>可匯入 {migration.books.length} 本、{migration.books.reduce((count, book) => count + book.schedules.length, 0)} 筆排程；待處理 {migration.unresolvedItems.length} 筆。</p><ul>{migration.books.map((book) => <li key={book.legacyId}><strong>{book.name}</strong><span>{book.questions.length ? `${book.questions.length} 題 · ${book.schedules.length} 筆排程` : "保留原篩選設定，不推測固定題目"}</span></li>)}</ul>{migration.unresolvedItems.length > 0 && <section><h3>待處理項目（不匯入）</h3><ul>{migration.unresolvedItems.map((item) => <li key={item.legacyId}><strong>{item.legacyId}</strong><span>{item.reason}</span></li>)}</ul></section>}<p>舊排程將以預覽中對應的正式題目版本建立；完成結果缺少原始版本依據時保留待核對。</p></div>}</DialogBody><DialogFooter><Button appearance="outline" disabled={disabled} onClick={() => setMigrationOpen(false)}>稍後處理</Button><Button disabled={disabled || !canCreatePlans || !migration?.books.length} onClick={() => void run("migration", async () => { const imported = await learningBookMutation<LearningBookMigrationResult>("/migrate", migration!); if (imported.bookIds.length !== imported.importedBooks) throw new Error("匯入結果數量不一致，保留原資料，請重新載入確認。"); await Promise.all(imported.bookIds.map((id) => getLearningBook(learnerId, id))); completeLearningBookMigration(learnerId, migration!.migrationId, imported); setMigrationCompleted(true); setMigrationOpen(false); setNotice(`已確認匯入 ${imported.importedBooks} 本、${imported.importedSchedules} 筆排程；原資料仍保留。`); })}>確認匯入可處理資料</Button></DialogFooter></DialogContent></Dialog>
    </div>;
}
