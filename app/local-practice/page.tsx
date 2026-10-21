"use client";

import { Badge, Button } from "@keel-design/ui";
import {
    AlertCircle,
    ArrowLeft,
    ArrowRight,
    BookOpenCheck,
    Check,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    CircleDashed,
    Clock3,
    Database,
    FileQuestion,
    History,
    ImageOff,
    ListChecks,
    LoaderCircle,
    Play,
    RefreshCw,
    RotateCcw,
    ShieldCheck,
    SkipForward,
    Volume2,
    X,
    XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasCompleteAnswerSlots, setAnswerSlot, splitAnswerSlots } from "../lib/answer-slots";
import { BopomofoText } from "../components/bopomofo-text";
import { AppSelect } from "../components/app-select";
import { LerniqaMark } from "../components/lerniqa-mark";
import { MathFormula } from "../components/math-formula";
import { QuestionTable } from "../components/question-table";
import {
    LOCAL_PRACTICE_DEFAULT_FILTERS,
    LOCAL_PRACTICE_MAX_QUESTIONS,
    type LocalPracticeAnswerInput,
    type LocalPracticeAnswerValue,
    type LocalPracticeAttempt,
    type LocalPracticeContentBlock,
    type LocalPracticeFilters,
    type LocalPracticeQuestion,
    type LocalPracticeQuestionPart,
    type LocalPracticeResult,
    type LocalPracticeSession,
    type LocalPracticeSessionHistory,
    type LocalPracticeWrongQueueItem,
} from "../lib/local-practice-types";
import { CHINESE_SUBJECT_LABEL } from "../lib/subject-labels";
import styles from "./local-practice.module.css";

const CATALOG_PAGE_SIZE = 50;
const HISTORY_LIMIT = 50;
const COUNT_OPTIONS = [5, 10, 20, 50];

interface ApiMeta {
    persistence: "local-postgresql";
    identityMode: "authenticated";
}

interface AccountResponse {
    data: {
        account: {
            displayName: string;
            emailVerified: boolean;
            activeRole: "parent" | "learner" | "tutor";
            learner: { id: string; displayName: string; gradeName: string | null };
        };
    };
}

interface CatalogResponse {
    data: { questions: LocalPracticeQuestion[] };
    meta: ApiMeta & {
        filters: LocalPracticeFilters;
        page: number;
        limit: number;
        total: number;
    };
}

interface SessionResponse {
    data: { session: LocalPracticeSession };
    meta: ApiMeta;
}

interface AttemptResponse {
    data: {
        attempt: LocalPracticeAttempt;
        session: Pick<LocalPracticeSession, "id" | "status" | "completedAt">;
    };
    meta: ApiMeta & { replayed: boolean };
}

interface HistoryResponse {
    data: {
        attempts: LocalPracticeAttempt[];
        wrongReviewQueue: {
            pendingCount: number;
            items: LocalPracticeWrongQueueItem[];
        };
        sessions: LocalPracticeSessionHistory[];
    };
    meta: ApiMeta;
}

interface ApiErrorBody {
    error?: { message?: string } | string;
    message?: string;
}

type AnswerBook = Record<string, Record<string, LocalPracticeAnswerValue>>;
type PracticeView = "catalog" | "practice" | "summary";

interface AttemptRequestSnapshot {
    sessionId: string;
    questionId: string;
    idempotencyKey: string;
    durationSeconds: number;
    answers: LocalPracticeAnswerInput[];
}

const RESULT_COPY: Record<LocalPracticeResult, { label: string; detail: string }> = {
    correct: { label: "答對", detail: "這一題已由標準答案完成自動檢核。" },
    wrong: { label: "待加強", detail: "這一題已記入錯題複習，之後可以再練一次。" },
    pending: { label: "待處理", detail: "本題含尚待處理的小題；若其他小題已判錯，仍會加入錯題複習。" },
};

const FEEDBACK_COPY: Record<LocalPracticeAttempt["parts"][number]["feedbackCode"], string> = {
    correct: "答案正確",
    wrong: "答案不符標準答案",
    missing_answer: "尚未作答",
    missing_answer_key: "題庫尚無完整標準答案",
    manual_review: "等待人工批改",
    ai_assisted_review: "等待輔助批改",
};

/** Reads JSON API responses without losing a useful server-side error message. */
async function readApi<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => ({})) as T & ApiErrorBody;
    if (!response.ok) {
        const error = body.error;
        const message = typeof error === "string" ? error : error?.message ?? body.message;
        throw new Error(message || `要求失敗（${response.status}）`);
    }
    return body;
}

function formatDateTime(value: string | null): string {
    if (!value) return "進行中";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("zh-TW", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

function shortId(value: string): string {
    return value.slice(0, 8);
}

function hasAnswer(value: LocalPracticeAnswerValue | undefined, part: LocalPracticeQuestionPart): boolean {
    return Array.isArray(value) ? value.length > 0 : hasCompleteAnswerSlots(value ?? "", part.answerFieldCount ?? 1);
}

function resultIcon(result: LocalPracticeResult) {
    if (result === "correct") return <CheckCircle2 aria-hidden="true" />;
    if (result === "wrong") return <XCircle aria-hidden="true" />;
    return <CircleDashed aria-hidden="true" />;
}

function ResultPill({ result }: { result: LocalPracticeResult }) {
    return (
        <span className={styles.resultPill} data-result={result}>
            {resultIcon(result)}
            {RESULT_COPY[result].label}
        </span>
    );
}

function MediaFallback({ block }: { block: LocalPracticeContentBlock }) {
    const label = block.altText || (block.contentType === "audio" ? "音訊內容" : "題目媒體");
    return (
        <div className={styles.mediaFallback} role="note">
            {block.contentType === "audio" ? <Volume2 aria-hidden="true" /> : <ImageOff aria-hidden="true" />}
            <div>
                <strong>{label}</strong>
                <span>媒體目前無法顯示，文字題仍可繼續作答。</span>
            </div>
        </div>
    );
}

function ContentBlocks({ blocks, duplicateText }: { blocks: LocalPracticeContentBlock[]; duplicateText?: string }) {
    const hasInlineFormula = blocks.some((block) => block.contentType === "formula" || (block.contentType === "image" && block.altText === "來源數學公式"));
    return (
        <div className={`${styles.contentBlocks} ${hasInlineFormula ? styles.inlineFormulaSequence : ""}`}>
            {blocks.map((block) => {
                if (block.contentType === "text" || block.contentType === "transcript") {
                    if (!block.text || block.text.trim() === duplicateText?.trim()) return null;
                    return hasInlineFormula
                        ? <span key={block.id}><BopomofoText text={block.text} /></span>
                        : <p key={block.id}><BopomofoText text={block.text} /></p>;
                }
                if (block.contentType === "formula") {
                    return block.text
                        ? <MathFormula className={styles.formula} expression={block.text} key={block.id} />
                        : <span className={styles.formula} key={block.id}>（公式內容缺漏）</span>;
                }
                if (block.contentType === "table") {
                    return <QuestionTable key={block.id} text={block.text} />;
                }

                const asset = block.asset;
                if (asset?.url && (block.contentType === "image" || block.contentType === "page_crop")) {
                    return (
                        <div className={`${styles.mediaAsset} ${block.altText === "來源數學公式" ? styles.inlineFormulaAsset : ""}`} key={block.id}>
                            {/* Imported assets keep their source dimensions, so plain img is intentional here. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                className={block.altText === "來源數學公式" ? styles.inlineFormulaImage : styles.promptImage}
                                src={asset.url}
                                alt={block.altText || "題目圖片"}
                                width={asset.width ?? undefined}
                                height={asset.height ?? undefined}
                                onError={(event) => {
                                    event.currentTarget.hidden = true;
                                    event.currentTarget.nextElementSibling?.removeAttribute("hidden");
                                }}
                            />
                            <div hidden><MediaFallback block={block} /></div>
                        </div>
                    );
                }
                if (asset?.url && block.contentType === "audio") {
                    return (
                        <div className={styles.mediaAsset} key={block.id}>
                            <audio
                                className={styles.audio}
                                controls
                                src={asset.url}
                                onError={(event) => {
                                    event.currentTarget.hidden = true;
                                    event.currentTarget.nextElementSibling?.removeAttribute("hidden");
                                }}
                            >{block.altText || "題目音訊"}</audio>
                            <div hidden><MediaFallback block={block} /></div>
                        </div>
                    );
                }
                return <MediaFallback block={block} key={block.id} />;
            })}
        </div>
    );
}

function PartAnswer({
    part,
    displayIndex,
    hidePrompt,
    value,
    disabled,
    result,
    onChange,
}: {
    part: LocalPracticeQuestionPart;
    displayIndex: number;
    hidePrompt: boolean;
    value: LocalPracticeAnswerValue | undefined;
    disabled: boolean;
    result?: LocalPracticeAttempt["parts"][number];
    onChange: (value: LocalPracticeAnswerValue) => void;
}) {
    const fieldName = `part-${part.id}`;
    const usesDedicatedAnswerSlots = part.answerMode === "text" && part.answerFieldCount > 1;
    const choiceOptions = part.options.length
        ? part.options
        : part.answerMode === "boolean"
            ? [
                { id: `${part.id}-yes`, key: "是", position: 0, label: "是", contentBlocks: [] },
                { id: `${part.id}-no`, key: "否", position: 1, label: "否", contentBlocks: [] },
            ]
            : [];
    const selectedValues = Array.isArray(value) ? value : [];

    return (
        <fieldset className={styles.answerPart} disabled={disabled}>
            <legend className={usesDedicatedAnswerSlots ? styles.visuallyHidden : undefined}>
                {!usesDedicatedAnswerSlots && <span className={styles.partNumber}>{displayIndex + 1}</span>}
                <span><BopomofoText text={usesDedicatedAnswerSlots ? `第 ${displayIndex + 1} 小題` : hidePrompt ? "作答" : part.prompt || `第 ${displayIndex + 1} 小題`} /></span>
            </legend>
            {!hidePrompt && !usesDedicatedAnswerSlots && <ContentBlocks blocks={part.promptBlocks} duplicateText={part.prompt} />}

            {(part.answerMode === "single_choice" || part.answerMode === "boolean") && (
                <div className={styles.choiceGrid}>
                    {choiceOptions.map((option) => (
                        <label className={styles.choice} data-selected={value === option.key} key={option.id}>
                            <input
                                checked={value === option.key}
                                name={fieldName}
                                onChange={() => onChange(option.key)}
                                type="radio"
                                value={option.key}
                            />
                            <span className={styles.choiceKey}>{option.key}</span>
                            <span className={styles.choiceBody}>
                                <BopomofoText text={option.label || option.key} />
                                <ContentBlocks blocks={option.contentBlocks.filter((block) => block.contentType !== "text")} />
                            </span>
                        </label>
                    ))}
                </div>
            )}

            {part.answerMode === "multiple_choice" && (
                <div className={styles.choiceGrid}>
                    {choiceOptions.map((option) => {
                        const selected = selectedValues.includes(option.key);
                        return (
                            <label className={styles.choice} data-selected={selected} key={option.id}>
                                <input
                                    checked={selected}
                                    onChange={(event) => onChange(
                                        event.target.checked
                                            ? [...selectedValues, option.key]
                                            : selectedValues.filter((item) => item !== option.key),
                                    )}
                                    type="checkbox"
                                    value={option.key}
                                />
                                <span className={styles.choiceKey}>{option.key}</span>
                                <span className={styles.choiceBody}>
                                    <BopomofoText text={option.label || option.key} />
                                    <ContentBlocks blocks={option.contentBlocks.filter((block) => block.contentType !== "text")} />
                                </span>
                            </label>
                        );
                    })}
                </div>
            )}

            {part.answerMode === "text" && part.answerFieldCount > 1 && (
                <div className={styles.answerSlotsRow}>
                    <span aria-hidden="true" className={styles.answerSlotsNumber}>({displayIndex + 1})</span>
                    <div className={styles.answerSlots}>
                        {splitAnswerSlots(typeof value === "string" ? value : "", part.answerFieldCount).map((slot, index) => (
                            <input
                                aria-label={`第 ${displayIndex + 1} 小題第 ${index + 1} 個答案`}
                                key={index}
                                maxLength={4_000}
                                onChange={(event) => onChange(setAnswerSlot(typeof value === "string" ? value : "", part.answerFieldCount, index, event.target.value))}
                                type="text"
                                value={slot}
                            />
                        ))}
                    </div>
                </div>
            )}
            {part.answerMode === "text" && !(part.answerFieldCount > 1) && (
                <textarea
                    aria-label={`${part.prompt || `第 ${displayIndex + 1} 小題`}答案`}
                    className={styles.textAnswer}
                    maxLength={4_000}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder="在這裡輸入答案"
                    rows={3}
                    value={typeof value === "string" ? value : ""}
                />
            )}

            {result && (
                <div className={styles.partFeedback} data-result={result.result} role="status">
                    {resultIcon(result.result)}
                    <span>{FEEDBACK_COPY[result.feedbackCode]}</span>
                </div>
            )}
        </fieldset>
    );
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
    return (
        <div className={styles.emptyPanel}>
            <FileQuestion aria-hidden="true" />
            <strong>{title}</strong>
            <p>{detail}</p>
        </div>
    );
}

function HistoryPanel({
    value,
    loading,
    error,
    questionMap,
    onRetry,
}: {
    value: HistoryResponse["data"] | null;
    loading: boolean;
    error: string;
    questionMap: Map<string, LocalPracticeQuestion>;
    onRetry: () => void;
}) {
    return (
        <aside className={styles.historyPanel} aria-labelledby="local-history-title">
            <div className={styles.panelHeading}>
                <div>
                    <span className={styles.eyebrow}><History aria-hidden="true" />持久化紀錄</span>
                    <h2 id="local-history-title">最近作答</h2>
                </div>
                <Button appearance="ghost" size="sm" aria-label="重新載入作答紀錄" disabled={loading} onClick={onRetry}>
                    <RefreshCw aria-hidden="true" />
                </Button>
            </div>

            {loading && !value && (
                <div className={styles.loadingLine} role="status"><LoaderCircle aria-hidden="true" />正在讀取紀錄…</div>
            )}
            {error && (
                <div className={styles.inlineError} role="alert">
                    <AlertCircle aria-hidden="true" />
                    <span>{error}</span>
                    <button onClick={onRetry} type="button">重試</button>
                </div>
            )}
            {value && (
                <>
                    <div className={styles.historyStats}>
                        <div><strong>{value.attempts.length}</strong><span>近期作答</span></div>
                        <div><strong>{value.wrongReviewQueue.pendingCount}</strong><span>待複習小題</span></div>
                    </div>
                    {value.attempts.length ? (
                        <ol className={styles.historyList}>
                            {value.attempts.slice(0, 8).map((attempt) => {
                                const question = questionMap.get(attempt.questionId);
                                return (
                                    <li key={attempt.id}>
                                        <div>
                                            <strong>{question?.code || `題目 ${shortId(attempt.questionId)}`}</strong>
                                            <span><Clock3 aria-hidden="true" />{formatDateTime(attempt.submittedAt)}</span>
                                        </div>
                                        <ResultPill result={attempt.overallResult} />
                                    </li>
                                );
                            })}
                        </ol>
                    ) : (
                        <EmptyPanel title="還沒有作答紀錄" detail="完成第一題後，作答結果會顯示在這裡。" />
                    )}
                    {value.wrongReviewQueue.items.length > 0 && (
                        <div className={styles.wrongQueue}>
                            <h3>錯題複習佇列</h3>
                            <ul>
                                {value.wrongReviewQueue.items.slice(0, 5).map((item) => {
                                    const question = questionMap.get(item.questionId);
                                    return <li key={item.id}><span>{question?.code || `題目 ${shortId(item.questionId)}`}</span><Badge tone="danger">待複習</Badge></li>;
                                })}
                            </ul>
                        </div>
                    )}
                </>
            )}
        </aside>
    );
}

export default function LocalPracticePage() {
    const [account, setAccount] = useState<AccountResponse["data"]["account"] | null>(null);
    const [accountLoading, setAccountLoading] = useState(true);
    const [accountError, setAccountError] = useState("");
    const [view, setView] = useState<PracticeView>("catalog");
    const [catalogPage, setCatalogPage] = useState(1);
    const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
    const [questionCache, setQuestionCache] = useState<Record<string, LocalPracticeQuestion>>({});
    const [catalogLoading, setCatalogLoading] = useState(true);
    const [catalogError, setCatalogError] = useState("");
    const [history, setHistory] = useState<HistoryResponse["data"] | null>(null);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [historyError, setHistoryError] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [selectionCount, setSelectionCount] = useState(5);
    const [session, setSession] = useState<LocalPracticeSession | null>(null);
    const [answers, setAnswers] = useState<AnswerBook>({});
    const [attempts, setAttempts] = useState<Record<string, LocalPracticeAttempt>>({});
    const [pendingAttemptIds, setPendingAttemptIds] = useState<Set<string>>(new Set());
    const pendingAttemptSnapshots = useRef<Record<string, AttemptRequestSnapshot>>({});
    const [activeIndex, setActiveIndex] = useState(0);
    const [questionStartedAt, setQuestionStartedAt] = useState(Date.now());
    const [actionLoading, setActionLoading] = useState(false);
    const [actionError, setActionError] = useState("");
    const questionHeadingRef = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        void fetch("/api/v1/auth/me", { cache: "no-store" })
            .then(async (response) => {
                if (response.status === 401) return null;
                return readApi<AccountResponse>(response);
            })
            .then((result) => setAccount(result?.data.account ?? null))
            .catch((error) => setAccountError(error instanceof Error ? error.message : "無法確認登入狀態。"))
            .finally(() => setAccountLoading(false));
    }, []);

    const loadCatalog = useCallback(async () => {
        setCatalogLoading(true);
        setCatalogError("");
        try {
            const query = new URLSearchParams({
                ...LOCAL_PRACTICE_DEFAULT_FILTERS,
                page: String(catalogPage),
                limit: String(CATALOG_PAGE_SIZE),
            });
            const response = await fetch(`/api/v1/local-practice/questions?${query}`, { cache: "no-store" });
            const next = await readApi<CatalogResponse>(response);
            setCatalog(next);
            setQuestionCache((current) => {
                const merged = { ...current };
                next.data.questions.forEach((question) => { merged[question.id] = question; });
                return merged;
            });
        }
        catch (error) {
            setCatalogError(error instanceof Error ? error.message : "無法讀取題庫，請稍後再試。" );
        }
        finally {
            setCatalogLoading(false);
        }
    }, [catalogPage]);

    const loadHistory = useCallback(async () => {
        setHistoryLoading(true);
        setHistoryError("");
        try {
            const response = await fetch(`/api/v1/local-practice/history?limit=${HISTORY_LIMIT}`, { cache: "no-store" });
            const next = await readApi<HistoryResponse>(response);
            setHistory(next.data);
        }
        catch (error) {
            setHistoryError(error instanceof Error ? error.message : "無法讀取作答紀錄。" );
        }
        finally {
            setHistoryLoading(false);
        }
    }, []);

    useEffect(() => { if (account) void loadCatalog(); }, [account, loadCatalog]);
    useEffect(() => { if (account) void loadHistory(); }, [account, loadHistory]);

    const questions = catalog?.data.questions ?? [];
    const totalQuestions = catalog?.meta.total ?? 0;
    const pageCount = Math.max(1, Math.ceil(totalQuestions / CATALOG_PAGE_SIZE));
    const questionMap = useMemo(() => new Map(Object.values(questionCache).map((question) => [question.id, question])), [questionCache]);
    const sessionItems = session?.items ?? [];
    const activeItem = sessionItems[activeIndex];
    const activeQuestion = activeItem ? questionMap.get(activeItem.questionId) : undefined;
    const activeAttempt = activeQuestion ? attempts[activeQuestion.id] : undefined;
    const activeAttemptPending = activeQuestion ? pendingAttemptIds.has(activeQuestion.id) : false;
    const activeQuestionHeading = activeQuestion
        ? activeQuestion.promptBlocks.length > 0
            ? activeQuestion.prompt
            : activeQuestion.parts.length === 1
                ? activeQuestion.parts[0]?.prompt || activeQuestion.prompt
                : `請依序完成以下 ${activeQuestion.parts.length} 小題`
        : "";
    const currentAnswers = activeQuestion ? answers[activeQuestion.id] ?? {} : {};
    const answeredPartCount = activeQuestion?.parts.filter((part) => hasAnswer(currentAnswers[part.id], part)).length ?? 0;
    const completedCount = Object.keys(attempts).length;

    useEffect(() => {
        if (view === "practice" && activeQuestion) {
            setQuestionStartedAt(Date.now());
            window.requestAnimationFrame(() => questionHeadingRef.current?.focus());
        }
    }, [activeIndex, activeQuestion, view]);

    function toggleQuestion(question: LocalPracticeQuestion) {
        if (!question.parts.length) return;
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(question.id)) next.delete(question.id);
            else if (next.size < LOCAL_PRACTICE_MAX_QUESTIONS) next.add(question.id);
            return next;
        });
    }

    function addPageSelection() {
        setSelectedIds((current) => {
            const next = new Set(current);
            questions
                .filter((question) => question.parts.length > 0)
                .slice(0, selectionCount)
                .forEach((question) => {
                    if (next.size < LOCAL_PRACTICE_MAX_QUESTIONS) next.add(question.id);
                });
            return next;
        });
    }

    async function startSession() {
        if (!selectedIds.size) return;
        setActionLoading(true);
        setActionError("");
        try {
            const response = await fetch("/api/v1/local-practice/sessions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ questionIds: [...selectedIds] }),
            });
            const next = await readApi<SessionResponse>(response);
            setSession(next.data.session);
            setAnswers({});
            setAttempts({});
            pendingAttemptSnapshots.current = {};
            setPendingAttemptIds(new Set());
            setActiveIndex(0);
            setView("practice");
        }
        catch (error) {
            setActionError(error instanceof Error ? error.message : "無法建立練習。" );
        }
        finally {
            setActionLoading(false);
        }
    }

    function updateAnswer(partId: string, value: LocalPracticeAnswerValue) {
        if (!activeQuestion || activeAttempt) return;
        setAnswers((current) => ({
            ...current,
            [activeQuestion.id]: {
                ...current[activeQuestion.id],
                [partId]: value,
            },
        }));
    }

    async function submitActiveQuestion(skip = false) {
        if (!session || !activeQuestion || activeAttempt) return;
        setActionLoading(true);
        setActionError("");
        let requestSnapshot = pendingAttemptSnapshots.current[activeQuestion.id];
        if (!requestSnapshot) {
            const answerPayload = skip
                ? []
                : activeQuestion.parts.flatMap((part) => {
                    const value = currentAnswers[part.id];
                    return value === undefined ? [] : [{ partId: part.id, value }];
                });
            requestSnapshot = {
                sessionId: session.id,
                questionId: activeQuestion.id,
                idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${session.id}-${activeQuestion.id}-${Date.now()}`,
                durationSeconds: Math.max(0, Math.round((Date.now() - questionStartedAt) / 1_000)),
                answers: answerPayload,
            };
            pendingAttemptSnapshots.current = {
                ...pendingAttemptSnapshots.current,
                [activeQuestion.id]: requestSnapshot,
            };
            setPendingAttemptIds((current) => new Set(current).add(activeQuestion.id));
        }
        try {
            const response = await fetch("/api/v1/local-practice/attempts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestSnapshot),
            });
            const next = await readApi<AttemptResponse>(response);
            const { [activeQuestion.id]: completedSnapshot, ...remainingSnapshots } = pendingAttemptSnapshots.current;
            void completedSnapshot;
            pendingAttemptSnapshots.current = remainingSnapshots;
            setPendingAttemptIds((current) => {
                const nextIds = new Set(current);
                nextIds.delete(activeQuestion.id);
                return nextIds;
            });
            setAttempts((current) => ({ ...current, [activeQuestion.id]: next.data.attempt }));
            setSession((current) => current ? {
                ...current,
                status: next.data.session.status,
                completedAt: next.data.session.completedAt,
            } : current);
            void loadHistory();
        }
        catch (error) {
            setActionError(error instanceof Error ? error.message : "答案未能保存，請重試。" );
        }
        finally {
            setActionLoading(false);
        }
    }

    function moveToQuestion(index: number) {
        setActionError("");
        setActiveIndex(Math.max(0, Math.min(sessionItems.length - 1, index)));
    }

    function continueAfterResult() {
        const nextIncompleteIndex = sessionItems.findIndex((item, index) => index > activeIndex && !attempts[item.questionId]);
        const anyIncompleteIndex = sessionItems.findIndex((item) => !attempts[item.questionId]);
        if (nextIncompleteIndex >= 0) {
            moveToQuestion(nextIncompleteIndex);
            return;
        }
        if (anyIncompleteIndex >= 0) {
            moveToQuestion(anyIncompleteIndex);
            return;
        }
        setView("summary");
    }

    function leaveSummary() {
        setView("catalog");
        setSession(null);
        setAttempts({});
        setAnswers({});
        pendingAttemptSnapshots.current = {};
        setPendingAttemptIds(new Set());
        setSelectedIds(new Set());
        void loadCatalog();
        void loadHistory();
    }

    const resultCounts = useMemo(() => {
        return Object.values(attempts).reduce((counts, attempt) => {
            counts[attempt.overallResult] += 1;
            return counts;
        }, { correct: 0, wrong: 0, pending: 0 });
    }, [attempts]);

    if (accountLoading || !account) {
        return (
            <main className={styles.page}>
                <header className={styles.topbar}>
                    <Link className={styles.brand} href="/overview" aria-label="返回 Lerniqa 首頁">
                        <span className={styles.brandMark}><LerniqaMark /></span>
                        <span><strong>Lerniqa</strong><small>{CHINESE_SUBJECT_LABEL}第四課題庫</small></span>
                    </Link>
                    <Link className={styles.accountLink} href="/account">帳號中心<ArrowRight aria-hidden="true" /></Link>
                </header>
                <section className={styles.authGate} aria-live="polite">
                    <ShieldCheck aria-hidden="true" />
                    <span className={styles.eyebrow}>個人練習紀錄</span>
                    <h1>{accountLoading ? "正在確認登入狀態" : `登入後開始${CHINESE_SUBJECT_LABEL}第四課練習`}</h1>
                    <p>{accountLoading ? "請稍候，正在讀取你的學習帳號。" : accountError || "題目、作答與錯題會依目前學習者分開保存。"}</p>
                    {!accountLoading && <Link className={styles.authGateAction} href="/account">登入或建立帳號<ArrowRight aria-hidden="true" /></Link>}
                </section>
            </main>
        );
    }

    return (
        <main className={styles.page}>
            <header className={styles.topbar}>
                <Link className={styles.brand} href="/overview" aria-label="返回 Lerniqa 首頁">
                    <span className={styles.brandMark}><LerniqaMark /></span>
                    <span><strong>Lerniqa</strong><small>{CHINESE_SUBJECT_LABEL}第四課題庫</small></span>
                </Link>
                <div className={styles.topbarBadges}>
                    <Link className={styles.accountLink} href="/account">{account.learner.displayName}<ArrowRight aria-hidden="true" /></Link>
                    <Badge tone="primary"><BookOpenCheck aria-hidden="true" />{CHINESE_SUBJECT_LABEL}・第四課</Badge>
                    <Badge tone="success"><ShieldCheck aria-hidden="true" />作答自動保存</Badge>
                </div>
            </header>

            <section className={styles.hero} aria-labelledby="local-practice-title">
                <div className={styles.heroCopy}>
                    <span className={styles.eyebrow}><BookOpenCheck aria-hidden="true" />國一{CHINESE_SUBJECT_LABEL}題庫</span>
                    <h1 id="local-practice-title">第四課，開始練習</h1>
                    <p>挑選題目後即可開始作答。標準答案完整的題目會自動判分；需要進一步核對的題目會標成待處理，作答與錯題紀錄都會保存。</p>
                    <div className={styles.filterTrail} aria-label="目前題庫範圍">
                        {Object.values(LOCAL_PRACTICE_DEFAULT_FILTERS).map((value) => <span key={value}>{value}</span>)}
                    </div>
                </div>
                <div className={styles.chapterStamp} aria-label="第四課"><span>LESSON</span><strong>04</strong></div>
            </section>

            <div className={styles.workspace}>
                <section className={styles.mainPanel}>
                    {view === "catalog" && (
                        <>
                            <div className={styles.panelHeading}>
                                <div>
                                    <span className={styles.eyebrow}><ListChecks aria-hidden="true" />第一步</span>
                                    <h2>挑選這輪題目</h2>
                                    <p>目前已選 {selectedIds.size} 題；每輪最多 {LOCAL_PRACTICE_MAX_QUESTIONS} 題。</p>
                                </div>
                                <div className={styles.selectionTools}>
                                    <label>
                                        <span>本頁加入題數</span>
                                        <AppSelect value={String(selectionCount)} onChange={(event) => setSelectionCount(Number(event.target.value))} options={COUNT_OPTIONS.map((count) => ({ label: `${count} 題`, value: String(count) }))} />
                                    </label>
                                    <Button appearance="outline" disabled={!questions.length || selectedIds.size >= LOCAL_PRACTICE_MAX_QUESTIONS} onClick={addPageSelection}>加入本頁前 {selectionCount} 題</Button>
                                    {selectedIds.size > 0 && <Button appearance="ghost" tone="muted" onClick={() => setSelectedIds(new Set())}><X aria-hidden="true" />清除</Button>}
                                </div>
                            </div>

                            {catalogLoading && !catalog && (
                                <div className={styles.loadingPanel} role="status"><LoaderCircle aria-hidden="true" /><strong>正在讀取第四課題庫…</strong><span>準備可練習的題目</span></div>
                            )}
                            {catalogError && (
                                <div className={styles.errorPanel} role="alert">
                                    <AlertCircle aria-hidden="true" />
                                    <div><strong>題庫暫時讀不到</strong><p>{catalogError}</p></div>
                                    <Button appearance="outline" onClick={() => void loadCatalog()}><RefreshCw aria-hidden="true" />重試</Button>
                                </div>
                            )}
                            {!catalogLoading && !catalogError && questions.length === 0 && (
                                <EmptyPanel title="第四課還沒有可練習的題目" detail="目前沒有已發布的題目，請稍後再試。" />
                            )}
                            {questions.length > 0 && (
                                <div className={styles.catalogList} aria-label="第四課題目清單">
                                    {questions.map((question, index) => {
                                        const selected = selectedIds.has(question.id);
                                        const unavailable = question.parts.length === 0;
                                        return (
                                            <label className={styles.catalogQuestion} data-selected={selected} data-disabled={unavailable} key={question.id}>
                                                <input
                                                    aria-label={`選取 ${question.code || `第 ${(catalogPage - 1) * CATALOG_PAGE_SIZE + index + 1} 題`}`}
                                                    checked={selected}
                                                    disabled={unavailable}
                                                    onChange={() => toggleQuestion(question)}
                                                    type="checkbox"
                                                />
                                                <span className={styles.catalogCheck}>{selected ? <Check aria-hidden="true" /> : index + 1}</span>
                                                <span className={styles.catalogQuestionBody}>
                                                    <span className={styles.catalogMeta}>
                                                        <strong>{question.code || `題目 ${(catalogPage - 1) * CATALOG_PAGE_SIZE + index + 1}`}</strong>
                                                        <span>{question.type.name}</span>
                                                        {question.difficulty && <span>{question.difficulty.name}</span>}
                                                        {unavailable && <span>缺少作答欄位</span>}
                                                    </span>
                                                    <span className={styles.catalogPrompt}>{question.prompt || "（題幹文字由媒體提供）"}</span>
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}

                            {catalog && totalQuestions > 0 && (
                                <div className={styles.pagination}>
                                    <span>第 {catalogPage}／{pageCount} 頁，共 {totalQuestions} 題</span>
                                    <div>
                                        <Button appearance="outline" size="sm" disabled={catalogLoading || catalogPage <= 1} onClick={() => setCatalogPage((page) => page - 1)}><ChevronLeft aria-hidden="true" />上一頁</Button>
                                        <Button appearance="outline" size="sm" disabled={catalogLoading || catalogPage >= pageCount} onClick={() => setCatalogPage((page) => page + 1)}>下一頁<ChevronRight aria-hidden="true" /></Button>
                                    </div>
                                </div>
                            )}

                            {actionError && <div className={styles.actionError} role="alert"><AlertCircle aria-hidden="true" />{actionError}</div>}
                            <div className={styles.stickyAction}>
                                <div><strong>{selectedIds.size ? `已選 ${selectedIds.size} 題` : "先選一題開始"}</strong><span>開始後會建立這輪練習並保存進度。</span></div>
                                <Button disabled={!selectedIds.size || actionLoading} onClick={() => void startSession()}>
                                    {actionLoading ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Play aria-hidden="true" />}
                                    {actionLoading ? "正在建立…" : "開始作答"}
                                </Button>
                            </div>
                        </>
                    )}

                    {view === "practice" && session && activeQuestion && activeItem && (
                        <>
                            <div className={styles.practiceProgress}>
                                <div>
                                    <span>第 {activeIndex + 1} 題，共 {sessionItems.length} 題</span>
                                    <strong>{completedCount} 題已保存</strong>
                                </div>
                                <div className={styles.progressTrack} aria-label={`已完成 ${completedCount}／${sessionItems.length} 題`} role="progressbar" aria-valuemin={0} aria-valuemax={sessionItems.length} aria-valuenow={completedCount}>
                                    <span style={{ width: `${sessionItems.length ? (completedCount / sessionItems.length) * 100 : 0}%` }} />
                                </div>
                            </div>

                            <article className={styles.questionCard}>
                                <div className={styles.questionHeadingRow}>
                                    <div>
                                        <span className={styles.questionCode}>{activeQuestion.code || `題目 ${activeIndex + 1}`}</span>
                                        <h2 ref={questionHeadingRef} tabIndex={-1}><BopomofoText text={activeQuestionHeading || "請依題目媒體作答"} /></h2>
                                    </div>
                                    {activeAttempt && <ResultPill result={activeAttempt.overallResult} />}
                                </div>
                                <ContentBlocks blocks={activeQuestion.promptBlocks} duplicateText={activeQuestion.prompt} />
                                <div className={styles.questionTags}>
                                    <span>{activeQuestion.type.name}</span>
                                    <span>{activeQuestion.unit.name}</span>
                                    {activeQuestion.difficulty && <span>{activeQuestion.difficulty.name}</span>}
                                </div>

                                <div className={styles.parts}>
                                    {activeQuestion.parts.map((part, partIndex) => (
                                        <PartAnswer
                                            disabled={Boolean(activeAttempt) || activeAttemptPending || actionLoading}
                                            displayIndex={partIndex}
                                            hidePrompt={activeQuestion.parts.length === 1 && part.prompt.trim() === activeQuestionHeading.trim()}
                                            key={part.id}
                                            onChange={(value) => updateAnswer(part.id, value)}
                                            part={part}
                                            result={activeAttempt?.parts.find((item) => item.partId === part.id)}
                                            value={currentAnswers[part.id]}
                                        />
                                    ))}
                                </div>

                                {activeAttempt && (
                                    <div className={styles.overallFeedback} data-result={activeAttempt.overallResult} role="status">
                                        {resultIcon(activeAttempt.overallResult)}
                                        <div><strong>{RESULT_COPY[activeAttempt.overallResult].label}</strong><p>{RESULT_COPY[activeAttempt.overallResult].detail}</p></div>
                                    </div>
                                )}
                                {actionError && <div className={styles.actionError} role="alert"><AlertCircle aria-hidden="true" />{actionError}</div>}

                                <div className={styles.questionActions}>
                                    <Button appearance="outline" disabled={activeIndex === 0 || actionLoading} onClick={() => moveToQuestion(activeIndex - 1)}><ArrowLeft aria-hidden="true" />上一題</Button>
                                    {!activeAttempt ? (
                                        <div className={styles.submitActions}>
                                            {activeAttemptPending ? (
                                                <Button disabled={actionLoading} onClick={() => void submitActiveQuestion()}>
                                                    {actionLoading ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                                                    {actionLoading ? "正在重試…" : "以原作答重試保存"}
                                                </Button>
                                            ) : (
                                                <>
                                                    <Button appearance="ghost" tone="muted" disabled={actionLoading} onClick={() => void submitActiveQuestion(true)}><SkipForward aria-hidden="true" />略過，記為待處理</Button>
                                                    <Button disabled={answeredPartCount !== activeQuestion.parts.length || actionLoading} onClick={() => void submitActiveQuestion(false)}>
                                                        {actionLoading ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Check aria-hidden="true" />}
                                                        {actionLoading ? "正在保存…" : `送出本題（${answeredPartCount}/${activeQuestion.parts.length}）`}
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    ) : (
                                        <Button onClick={continueAfterResult}>
                                            {completedCount === sessionItems.length ? "查看本輪結果" : "前往未完成題目"}
                                            <ArrowRight aria-hidden="true" />
                                        </Button>
                                    )}
                                </div>
                            </article>

                            <nav className={styles.questionNav} aria-label="本輪題目">
                                {sessionItems.map((item, index) => {
                                    const attempt = attempts[item.questionId];
                                    const resultLabel = attempt ? RESULT_COPY[attempt.overallResult].label : "尚未送出";
                                    return (
                                        <button
                                            aria-current={index === activeIndex ? "step" : undefined}
                                            aria-label={`第 ${index + 1} 題，${resultLabel}`}
                                            data-result={attempt?.overallResult}
                                            disabled={actionLoading}
                                            key={item.id}
                                            onClick={() => moveToQuestion(index)}
                                            type="button"
                                        >
                                            <span>{index + 1}</span>
                                            {attempt && resultIcon(attempt.overallResult)}
                                        </button>
                                    );
                                })}
                            </nav>
                        </>
                    )}

                    {view === "practice" && session && (!activeQuestion || !activeItem) && (
                        <div className={styles.errorPanel} role="alert">
                            <AlertCircle aria-hidden="true" />
                            <div><strong>這輪題目資料不完整</strong><p>這輪練習仍已保存，請返回題庫重新載入。</p></div>
                            <Button appearance="outline" onClick={() => setView("catalog")}>返回題庫</Button>
                        </div>
                    )}

                    {view === "summary" && session && (
                        <div className={styles.summary}>
                            <span className={styles.eyebrow}><CheckCircle2 aria-hidden="true" />本輪已保存</span>
                            <h2>完成 {sessionItems.length} 題練習</h2>
                            <p>每筆作答結果都已保存。待處理不等於整題答錯；若同題其他小題已判錯，該小題仍會加入錯題複習。</p>
                            <div className={styles.summaryStats}>
                                <div data-result="correct"><strong>{resultCounts.correct}</strong><span>答對</span></div>
                                <div data-result="wrong"><strong>{resultCounts.wrong}</strong><span>待加強</span></div>
                                <div data-result="pending"><strong>{resultCounts.pending}</strong><span>待處理</span></div>
                            </div>
                            <div className={styles.summaryList}>
                                {sessionItems.map((item, index) => {
                                    const question = questionMap.get(item.questionId);
                                    const attempt = attempts[item.questionId];
                                    return (
                                        <button key={item.id} onClick={() => { setActiveIndex(index); setView("practice"); }} type="button">
                                            <span>{index + 1}</span>
                                            <strong>{question?.code || `題目 ${shortId(item.questionId)}`}</strong>
                                            {attempt ? <ResultPill result={attempt.overallResult} /> : <Badge tone="muted">未送出</Badge>}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className={styles.summaryActions}>
                                <Button appearance="outline" onClick={() => { setActiveIndex(0); setView("practice"); }}><RotateCcw aria-hidden="true" />查看本輪題目</Button>
                                <Button onClick={leaveSummary}><BookOpenCheck aria-hidden="true" />再選一輪</Button>
                            </div>
                        </div>
                    )}
                </section>

                <HistoryPanel
                    error={historyError}
                    loading={historyLoading}
                    onRetry={() => void loadHistory()}
                    questionMap={questionMap}
                    value={history}
                />
            </div>

            <footer className={styles.footer}>
                <span><Database aria-hidden="true" />題目與作答紀錄會安全保存</span>
                <Link href="/overview">返回學習工作區<ArrowRight aria-hidden="true" /></Link>
            </footer>
        </main>
    );
}
