"use client";

import {
    Button,
    Dialog,
    DialogBody,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    FormField,
    Input,
} from "@keel-design/ui";
import {
    type FormEvent,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import { AdminNotice } from "../admin-notice";
import { AppSelect as NativeSelect } from "../../app-select";
import { useAppRouter } from "../../navigation-feedback";
import { invalidatePersistedPracticeCatalog } from "../../../lib/practice-client";
import {
    buildQuestionDraftContentPatch,
    EDITABLE_TEXT_CONTENT_TYPES,
    questionMutationRetryIdentity,
} from "./question-mutation-client";
import { questionContentBlockLabel } from "./question-presentation-labels";
import { useRouteDrawerNavigationGuard } from "./route-drawer";
import type {
    QuestionDetailDto,
    QuestionPartDto,
    QuestionRevisionDto,
} from "./view-types";

import styles from "./views.module.css";

type EditableSystemQuestion = Extract<QuestionDetailDto, { origin: "system" }>;
type EditableAccessPolicy = Extract<
    EditableSystemQuestion["accessPolicy"],
    { mode: "editable" }
>;

interface QuestionMutationWorkflowProps {
    detail: EditableSystemQuestion;
    accessPolicy: EditableAccessPolicy;
}

interface AdminMutationResponse<Result> {
    data?: Result;
    error?: {
        code?: string;
        message?: string;
        requestId?: string;
    };
}

interface DraftResult {
    revisionId: string;
}

interface RetryEvidence {
    identity: string;
    idempotencyKey: string;
}

function safeErrorMessage(error: unknown): string {
    return error instanceof Error && error.message.trim()
        ? error.message
        : "系統暫時無法完成操作，請稍後再試。";
}

function answerLabel(part: QuestionPartDto, position: number): string {
    return `小題 ${part.position + 1} 的參考答案 ${position + 1}`;
}

function latestReviewDecision(revision: QuestionRevisionDto): string | null {
    return revision.reviews.at(-1)?.decision ?? null;
}

export function QuestionMutationWorkflow({
    detail,
    accessPolicy,
}: QuestionMutationWorkflowProps) {
    const router = useAppRouter();
    const retryEvidence = useRef<RetryEvidence | null>(null);
    const dirtyRef = useRef(false);
    const errorRef = useRef<HTMLDivElement | null>(null);
    const [pendingAction, setPendingAction] = useState<
        "draft" | "review" | "publish" | null
    >(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [publishDialogOpen, setPublishDialogOpen] = useState(false);
    const revision = detail.displayRevision;

    const markDirty = useCallback(() => {
        dirtyRef.current = true;
        setHasUnsavedChanges(true);
    }, []);
    const clearDirty = useCallback(() => {
        dirtyRef.current = false;
        setHasUnsavedChanges(false);
    }, []);
    const confirmDiscardChanges = useCallback(() => {
        if (!dirtyRef.current) return true;
        const confirmed = window.confirm(
            "尚有未儲存的題目修改。要放棄變更並離開嗎？",
        );
        if (confirmed) clearDirty();
        return confirmed;
    }, [clearDirty]);

    useRouteDrawerNavigationGuard(confirmDiscardChanges);

    useEffect(() => {
        retryEvidence.current = null;
    }, [detail.id, revision?.id]);

    useEffect(() => {
        clearDirty();
        setPublishDialogOpen(false);
    }, [clearDirty, detail.id, revision?.id]);

    useEffect(() => {
        function preventAccidentalUnload(event: BeforeUnloadEvent): void {
            if (!dirtyRef.current) return;
            event.preventDefault();
            event.returnValue = "";
        }
        window.addEventListener("beforeunload", preventAccidentalUnload);
        return () => window.removeEventListener("beforeunload", preventAccidentalUnload);
    }, []);

    useEffect(() => {
        if (!errorMessage) return;
        errorRef.current?.focus();
        errorRef.current?.scrollIntoView({ block: "nearest" });
    }, [errorMessage]);

    async function sendMutation<Result>(url: string, body: unknown): Promise<Result> {
        const serializedBody = JSON.stringify(body);
        const identity = questionMutationRetryIdentity(url, serializedBody);
        if (retryEvidence.current?.identity !== identity) {
            retryEvidence.current = {
                identity,
                idempotencyKey: crypto.randomUUID(),
            };
        }
        const evidence = retryEvidence.current;
        if (!evidence) throw new Error("無法建立操作識別碼，請重新整理後再試。");

        const response = await fetch(url, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "content-type": "application/json",
                "idempotency-key": evidence.idempotencyKey,
                "x-lerniqa-csrf": "same-origin",
            },
            body: serializedBody,
        });
        const payload = await response.json().catch(() => null) as
            | AdminMutationResponse<Result>
            | null;
        if (!response.ok || !payload?.data) {
            const requestSuffix = payload?.error?.requestId
                ? `（參考編號：${payload.error.requestId}）`
                : "";
            throw new Error(
                `${payload?.error?.message ?? "系統暫時無法完成操作。"}${requestSuffix}`,
            );
        }
        retryEvidence.current = null;
        invalidatePersistedPracticeCatalog();
        return payload.data;
    }

    function refreshSelectedRevision(revisionId?: string): void {
        if (revisionId) {
            const url = new URL(window.location.href);
            url.searchParams.set("question", detail.id);
            url.searchParams.set("revision", revisionId);
            router.replace(`${url.pathname}${url.search}`, { scroll: false });
        }
        router.refresh();
    }

    async function createDraft(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (!revision || revision.id !== detail.currentRevisionId) return;

        const form = new FormData(event.currentTarget);
        const { textBlocks, answers } = buildQuestionDraftContentPatch(
            revision,
            (name) => String(form.get(name) ?? ""),
        );
        if (textBlocks.length === 0 && answers.length === 0) {
            setErrorMessage("請至少修改一段文字或一個參考答案。");
            setSuccessMessage(null);
            return;
        }

        setPendingAction("draft");
        setErrorMessage(null);
        setSuccessMessage(null);
        try {
            const result = await sendMutation<DraftResult>(
                `/api/v1/admin/questions/${detail.id}/revisions`,
                {
                    baseRevisionId: revision.id,
                    baseRevisionNumber: revision.number,
                    changeNote: String(form.get("changeNote") ?? ""),
                    contentPatch: { textBlocks, answers },
                },
            );
            clearDirty();
            setSuccessMessage("新草稿版本已建立；目前發布版本與歷史作答未被覆寫。");
            refreshSelectedRevision(result.revisionId);
        }
        catch (error) {
            setErrorMessage(safeErrorMessage(error));
        }
        finally {
            setPendingAction(null);
        }
    }

    async function reviewDraft(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (!revision || revision.status !== "draft") return;
        const form = new FormData(event.currentTarget);
        setPendingAction("review");
        setErrorMessage(null);
        setSuccessMessage(null);
        try {
            await sendMutation(
                `/api/v1/admin/questions/${detail.id}/revisions/${revision.id}/review`,
                {
                    expectedRevisionNumber: revision.number,
                    decision: String(form.get("decision") ?? ""),
                    reason: String(form.get("reason") ?? ""),
                },
            );
            clearDirty();
            setSuccessMessage("審核決定已保存，題目版本歷程與稽核紀錄已更新。");
            refreshSelectedRevision();
        }
        catch (error) {
            setErrorMessage(safeErrorMessage(error));
        }
        finally {
            setPendingAction(null);
        }
    }

    async function publishDraft(): Promise<void> {
        if (
            !revision
            || revision.status !== "draft"
            || detail.currentRevisionId === null
            || detail.currentRevisionNumber === null
        ) return;
        setPendingAction("publish");
        setErrorMessage(null);
        setSuccessMessage(null);
        try {
            await sendMutation(
                `/api/v1/admin/questions/${detail.id}/revisions/${revision.id}/publish`,
                {
                    expectedCurrentRevisionId: detail.currentRevisionId,
                    expectedCurrentRevisionNumber: detail.currentRevisionNumber,
                    changeNote: revision.changeNote ?? "",
                },
            );
            setPublishDialogOpen(false);
            setSuccessMessage("草稿已發布；先前版本已標記為已取代並保留供歷史作答查閱。");
            refreshSelectedRevision(revision.id);
        }
        catch (error) {
            setPublishDialogOpen(false);
            setErrorMessage(safeErrorMessage(error));
        }
        finally {
            setPendingAction(null);
        }
    }

    if (!revision) return null;
    const latestDecision = latestReviewDecision(revision);
    const publishBlocked = latestDecision === "changes_requested";

    return (
        <section
            id="question-version-workflow"
            className={styles.mutationWorkflow}
            aria-labelledby="question-version-workflow-title"
        >
            <div className={styles.sectionHeading}>
                <h2 id="question-version-workflow-title">版本編修與審核</h2>
                <p>
                    所有寫入都建立或轉換固定版本，並以冪等請求和稽核紀錄防止重複提交。
                </p>
            </div>

            {errorMessage ? (
                <div ref={errorRef} className={styles.mutationFeedback} tabIndex={-1}>
                    <AdminNotice title="操作未完成" tone="danger" live="assertive">
                        {errorMessage}
                    </AdminNotice>
                </div>
            ) : null}
            {successMessage ? (
                <AdminNotice title="操作完成" tone="success" live="polite">
                    {successMessage}
                </AdminNotice>
            ) : null}
            {hasUnsavedChanges ? (
                <AdminNotice title="尚有未儲存的變更" tone="warning">
                    關閉詳情、切換版本或離開頁面前，系統會要求確認是否放棄這些內容。
                </AdminNotice>
            ) : null}

            {revision.status === "published" && revision.id === detail.currentRevisionId ? (
                <form
                    className={styles.mutationForm}
                    onChange={markDirty}
                    onSubmit={createDraft}
                >
                    <AdminNotice title="建立新草稿" tone="info">
                        只會送出有修改的文字與答案；題目關係、來源、媒體與分類會由伺服器從目前版本安全複製。
                    </AdminNotice>

                    {revision.contentBlocks
                        .filter((block) => EDITABLE_TEXT_CONTENT_TYPES.has(block.contentType))
                        .map((block) => (
                            <FormField
                                key={block.id}
                                label={questionContentBlockLabel(
                                    block.placement,
                                    block.contentType,
                                )}
                                htmlFor={`edit-block-${block.id}`}
                                description="留白或無效內容會由伺服器拒絕。"
                            >
                                <textarea
                                    id={`edit-block-${block.id}`}
                                    name={`block:${block.id}`}
                                    className={styles.adminTextarea}
                                    defaultValue={block.textContent ?? ""}
                                    maxLength={50_000}
                                    rows={4}
                                />
                            </FormField>
                        ))}

                    {revision.parts.flatMap((part) => (
                        part.answers.map((answer, answerIndex) => (
                            <FormField
                                key={answer.id}
                                label={answerLabel(part, answerIndex)}
                                htmlFor={`edit-answer-${answer.id}`}
                            >
                                {part.answerMode === "text" ? (
                                    <textarea
                                        id={`edit-answer-${answer.id}`}
                                        name={`answer:${answer.id}`}
                                        className={styles.adminTextarea}
                                        defaultValue={answer.acceptedValue ?? ""}
                                        maxLength={20_000}
                                        rows={3}
                                    />
                                ) : (
                                    <NativeSelect
                                        id={`edit-answer-${answer.id}`}
                                        name={`answer:${answer.id}`}
                                        defaultValue={answer.answerKey ?? ""}
                                        options={part.options.map((option) => ({
                                            value: option.key,
                                            label: `選項 ${option.key}`,
                                        }))}
                                    />
                                )}
                            </FormField>
                        ))
                    ))}

                    <FormField
                        label="修改原因"
                        htmlFor="question-change-note"
                        description="5 到 500 個字元，會保存在新版本與稽核紀錄。"
                        required
                    >
                        <Input
                            id="question-change-note"
                            name="changeNote"
                            minLength={5}
                            maxLength={500}
                            required
                        />
                    </FormField>
                    <div className={styles.sectionActions}>
                        <Button
                            type="submit"
                            appearance="solid"
                            tone="primary"
                            loading={pendingAction === "draft"}
                            disabled={pendingAction !== null}
                        >
                            建立草稿版本
                        </Button>
                    </div>
                </form>
            ) : revision.status === "draft" ? (
                <div className={styles.mutationColumns}>
                    {accessPolicy.canReviewDraft ? (
                        <form
                            className={styles.mutationForm}
                            onChange={markDirty}
                            onSubmit={reviewDraft}
                        >
                            <h3>退回草稿</h3>
                            <FormField
                                label="審核決定"
                                htmlFor="question-review-decision"
                                required
                            >
                                <NativeSelect
                                    id="question-review-decision"
                                    name="decision"
                                    defaultValue="changes_requested"
                                    options={[
                                        { value: "changes_requested", label: "要求修改" },
                                        { value: "rejected", label: "拒絕此版本" },
                                    ]}
                                />
                            </FormField>
                            <FormField
                                label="審核原因"
                                htmlFor="question-review-reason"
                                description="5 到 2,000 個字元，會保存在審核與稽核紀錄。"
                                required
                            >
                                <textarea
                                    id="question-review-reason"
                                    name="reason"
                                    className={styles.adminTextarea}
                                    minLength={5}
                                    maxLength={2_000}
                                    rows={4}
                                    required
                                />
                            </FormField>
                            <Button
                                type="submit"
                                appearance="outline"
                                tone="warning"
                                loading={pendingAction === "review"}
                                disabled={pendingAction !== null}
                            >
                                保存審核決定
                            </Button>
                        </form>
                    ) : (
                        <div className={styles.mutationForm}>
                            <h3>退回草稿</h3>
                            <AdminNotice title="需要另一位管理員審核" tone="warning">
                                {accessPolicy.reviewBlockedReason
                                    ?? "版本建立者不可審核自己的草稿。"}
                            </AdminNotice>
                        </div>
                    )}

                    {accessPolicy.canPublishDraft ? (
                        <div className={styles.mutationForm}>
                            <h3>發布草稿</h3>
                            {publishBlocked ? (
                                <AdminNotice title="必須建立新修正版" tone="warning">
                                    這個草稿最近一次審核要求修改，不能原樣發布。請回到目前發布版本建立新的草稿。
                                </AdminNotice>
                            ) : (
                                <AdminNotice title="發布會切換目前版本" tone="warning">
                                    發布後，這個草稿成為目前版本；原版本只會標記為已取代，不會刪除或覆寫。
                                </AdminNotice>
                            )}
                            <Dialog
                                open={publishDialogOpen}
                                onOpenChange={(nextOpen) => {
                                    if (!nextOpen && pendingAction === "publish") return;
                                    setPublishDialogOpen(nextOpen);
                                }}
                            >
                                <DialogTrigger asChild>
                                    <Button
                                        type="button"
                                        appearance="solid"
                                        tone="primary"
                                        disabled={pendingAction !== null || publishBlocked}
                                        onClick={(event) => {
                                            if (!confirmDiscardChanges()) event.preventDefault();
                                        }}
                                    >
                                        發布此草稿
                                    </Button>
                                </DialogTrigger>
                                <DialogContent size="sm" closeLabel="關閉發布確認">
                                    <DialogHeader>
                                        <DialogTitle>
                                            發布題目版本 v{revision.number}？
                                        </DialogTitle>
                                        <DialogDescription>
                                            請確認要切換目前發布版本；這項操作會寫入版本歷程與稽核紀錄。
                                        </DialogDescription>
                                    </DialogHeader>
                                    <DialogBody className={styles.contentStack}>
                                        <AdminNotice title="發布後仍保留歷史依據" tone="warning">
                                            目前版本 v{detail.currentRevisionNumber} 會標記為已取代，
                                            草稿 v{revision.number} 會成為目前版本；舊內容不會被刪除或覆寫。
                                        </AdminNotice>
                                    </DialogBody>
                                    <DialogFooter>
                                        <DialogClose asChild>
                                            <Button
                                                type="button"
                                                appearance="outline"
                                                tone="muted"
                                                disabled={pendingAction === "publish"}
                                            >
                                                返回檢查
                                            </Button>
                                        </DialogClose>
                                        <Button
                                            type="button"
                                            appearance="solid"
                                            tone="primary"
                                            loading={pendingAction === "publish"}
                                            disabled={pendingAction !== null}
                                            onClick={() => void publishDraft()}
                                        >
                                            確認發布 v{revision.number}
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    ) : (
                        <div className={styles.mutationForm}>
                            <h3>發布草稿</h3>
                            <AdminNotice title="需要另一位管理員發布" tone="warning">
                                {accessPolicy.publishBlockedReason
                                    ?? "發布者不可是草稿或目前版本的建立者。"}
                            </AdminNotice>
                        </div>
                    )}
                </div>
            ) : (
                <AdminNotice title="此版本僅供查閱" tone="muted">
                    請選取目前發布版本建立新的草稿。
                </AdminNotice>
            )}
        </section>
    );
}
