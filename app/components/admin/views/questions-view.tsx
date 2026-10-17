import { Button, Card, CardContent, CardHeader, CardTitle } from "@keel-design/ui";

import { AdminNotice } from "../admin-notice";
import { AdminPage } from "../admin-page";
import { AdminStatusBadge } from "../admin-status-badge";
import {
    AdminTableActionCell,
    AdminTableBody,
    AdminTableCell,
    AdminTableEmptyState,
    AdminTableErrorState,
    AdminTableFrame,
    AdminTableHeadCell,
    AdminTableHeader,
    AdminTableLoadingState,
    AdminTableRow,
} from "../admin-table";
import { RouteDrawer } from "./route-drawer";
import { QuestionMutationWorkflow } from "./question-mutation-workflow";
import {
    questionContentBlockLabel,
    questionContentPlacementLabel,
    questionContentTypeLabel,
} from "./question-presentation-labels";
import type {
    QuestionClassificationDto,
    QuestionContentBlockDto,
    QuestionDetailDto,
    QuestionPartDto,
    QuestionRevisionDto,
    QuestionReviewDto,
    QuestionSourceDto,
    QuestionsViewProps,
    ViewSortLinkDto,
} from "./view-types";
import {
    DetailList,
    MobileListState,
    MobileRecordCard,
    MobileRecordList,
    ViewFilters,
    ViewPagination,
    ViewSortHeader,
    formatViewValue,
    sortLinkFor,
} from "./view-shared";

import styles from "./views.module.css";

const CREATED_METHOD_LABELS: Readonly<Record<string, string>> = {
    manual: "手動建立",
    import: "匯入",
    generated: "系統產生",
    migration: "資料搬移",
};

const ANSWER_MODE_LABELS: Readonly<Record<string, string>> = {
    single_choice: "單選",
    multiple_choice: "複選",
    boolean: "是非",
    text: "文字作答",
};

const GRADING_POLICY_LABELS: Readonly<Record<string, string>> = {
    automatic: "自動判定",
    manual_review: "人工審核",
    ai_assisted_review: "AI 輔助後人工確認",
};

const INPUT_TYPE_LABELS: Readonly<Record<string, string>> = {
    image: "圖片",
    pdf: "PDF",
    document: "文件",
    text: "貼上文字",
};

const REVIEW_DECISION_LABELS: Readonly<Record<string, string>> = {
    approved: "已核准",
    rejected: "已退回",
    changes_requested: "要求修改",
};

const QUESTION_STATUS_LABELS: Readonly<Record<string, string>> = {
    draft: "草稿",
    published: "已發布",
    archived: "已封存",
    superseded: "已取代",
    rejected: "已退回",
};

const IDENTIFIER_TYPE_LABELS: Readonly<Record<string, string>> = {
    legacy: "舊系統題號",
    publisher_question: "出版社題號",
    source_document_question: "來源文件題號",
};

function labelFor(labels: Readonly<Record<string, string>>, value: string): string {
    return labels[value] ?? value;
}

function actorLabel(actor: QuestionRevisionDto["createdBy"]): string {
    if (actor.displayName?.trim()) return actor.displayName;
    switch (actor.type) {
        case "bootstrap_admin":
            return "預設系統管理員";
        case "system_job":
            return "系統工作";
        case "migration":
            return "資料搬移";
        case "user":
            return "帳號使用者（名稱未填）";
        default:
            return actor.type;
    }
}

function reviewerLabel(review: QuestionReviewDto): string {
    if (review.reviewerDisplayName?.trim()) return review.reviewerDisplayName;
    return review.reviewerType === "bootstrap_admin"
        ? "預設系統管理員"
        : "管理員（名稱未填）";
}

function sourceLabel(source: QuestionSourceDto): string {
    return (
        source.documentTitle?.trim()
        || source.originalFileName?.trim()
        || labelFor(INPUT_TYPE_LABELS, source.inputType)
    );
}

function sourceReference(source: QuestionSourceDto): string | null {
    const segments = [
        source.sourcePage === null ? null : `第 ${source.sourcePage} 頁`,
        source.sourceQuestionNumber === null
            ? null
            : `題號 ${source.sourceQuestionNumber}`,
    ].filter((value): value is string => value !== null);
    return segments.length === 0 ? null : segments.join("、");
}

function blockVisibleText(block: QuestionContentBlockDto): string {
    if (block.textContent?.trim()) return block.textContent;
    if (block.altText?.trim()) return block.altText;
    if (block.assetId !== null) {
        return `${questionContentTypeLabel(block.contentType)}內容`;
    }
    return "未填";
}

function blockMediaDescription(block: QuestionContentBlockDto): string {
    if (block.altText?.trim()) return block.altText.trim();
    return `${questionContentPlacementLabel(block.placement)}的${questionContentTypeLabel(
        block.contentType,
    )}，未提供替代文字`;
}

function ProtectedAssetLink({
    href,
    children,
}: {
    href: string;
    children: string;
}) {
    return (
        <a
            className={styles.mediaOpenLink}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
        >
            {children}
        </a>
    );
}

function ContentBlockAsset({ block }: { block: QuestionContentBlockDto }) {
    if (block.assetUrl === null) return null;

    const description = blockMediaDescription(block);
    if (block.contentType === "image" || block.contentType === "page_crop") {
        return (
            <figure className={styles.mediaFigure}>
                <img
                    className={styles.mediaImage}
                    src={block.assetUrl}
                    alt={description}
                    loading="lazy"
                    decoding="async"
                />
                <figcaption className={styles.mediaCaption}>
                    <span>{description}</span>
                    <ProtectedAssetLink href={block.assetUrl}>
                        在新分頁開啟或重試圖片
                    </ProtectedAssetLink>
                </figcaption>
            </figure>
        );
    }

    if (block.contentType === "audio") {
        return (
            <figure className={styles.mediaFigure}>
                <audio
                    className={styles.mediaAudio}
                    controls
                    preload="none"
                    aria-label={description}
                >
                    <source src={block.assetUrl} />
                    瀏覽器無法播放此音訊。
                </audio>
                <figcaption className={styles.mediaCaption}>
                    <span>{description}</span>
                    <ProtectedAssetLink href={block.assetUrl}>
                        在新分頁開啟或重試音訊
                    </ProtectedAssetLink>
                </figcaption>
            </figure>
        );
    }

    return (
        <ProtectedAssetLink href={block.assetUrl}>
            在新分頁開啟或重試受保護資產
        </ProtectedAssetLink>
    );
}

function currentPrompt(revision: QuestionRevisionDto | null): string {
    if (revision === null) return "尚無目前版本";
    const prompt = revision.contentBlocks
        .filter((block) => block.placement === "prompt")
        .sort((left, right) => left.position - right.position)
        .map(blockVisibleText)
        .filter((value) => value !== "未填")
        .join("\n");
    return prompt || "未填";
}

function referenceAnswerCount(revision: QuestionRevisionDto | null): number {
    return revision?.parts.reduce((sum, part) => sum + part.answers.length, 0) ?? 0;
}

function ContentBlockList({
    blocks,
    emptyLabel = "無資料",
}: {
    blocks: readonly QuestionContentBlockDto[];
    emptyLabel?: string;
}) {
    if (blocks.length === 0) {
        return <AdminNotice tone="muted">{emptyLabel}</AdminNotice>;
    }

    return (
        <ul className={styles.detailItems}>
            {[...blocks]
                .sort((left, right) => left.position - right.position)
                .map((block) => (
                    <li key={block.id}>
                        <div className={styles.detailItemContent}>
                            <strong>
                                {questionContentBlockLabel(
                                    block.placement,
                                    block.contentType,
                                )}
                            </strong>
                            <span>{blockVisibleText(block)}</span>
                            <ContentBlockAsset block={block} />
                            {block.parentBlockId !== null ? (
                                <span>此內容附屬於同版本的上層內容區塊。</span>
                            ) : null}
                        </div>
                    </li>
                ))}
        </ul>
    );
}

function QuestionPartPanel({
    part,
    parts,
    contentBlocks,
}: {
    part: QuestionPartDto;
    parts: readonly QuestionPartDto[];
    contentBlocks: readonly QuestionContentBlockDto[];
}) {
    const parent = part.parentPartId === null
        ? null
        : parts.find((candidate) => candidate.id === part.parentPartId) ?? null;
    const partBlocks = contentBlocks.filter(
        (block) => block.questionPartId === part.id && block.questionOptionId === null,
    );

    return (
        <section className={styles.policyPanel} aria-labelledby={`question-part-${part.id}`}>
            <div className={styles.contentStack}>
                <h4 id={`question-part-${part.id}`}>
                    小題 {part.position + 1} · {part.stableKey}
                </h4>
                <DetailList
                    items={[
                        {
                            label: "作答方式",
                            value: labelFor(ANSWER_MODE_LABELS, part.answerMode),
                        },
                        {
                            label: "判定方式",
                            value: labelFor(GRADING_POLICY_LABELS, part.gradingPolicy),
                        },
                        {
                            label: "可獨立計分",
                            value: part.independentlyGradable ? "是" : "否",
                        },
                        {
                            label: "上層小題",
                            value: parent?.stableKey ?? null,
                        },
                    ]}
                />

                <div className={styles.contentStack}>
                    <h5>小題內容</h5>
                    <ContentBlockList blocks={partBlocks} />
                </div>

                <div className={styles.contentStack}>
                    <h5>選項</h5>
                    {part.options.length === 0 ? (
                        <AdminNotice tone="muted">此小題沒有選項。</AdminNotice>
                    ) : (
                        <ul className={styles.detailItems}>
                            {part.options.map((option) => {
                                const optionBlocks = contentBlocks.filter(
                                    (block) => block.questionOptionId === option.id,
                                );
                                return (
                                    <li key={option.id}>
                                        <div className={styles.contentStack}>
                                            <strong>
                                                選項 {option.position + 1} · {option.key}
                                            </strong>
                                            <ContentBlockList
                                                blocks={optionBlocks}
                                                emptyLabel="選項內容未填"
                                            />
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <div className={styles.contentStack}>
                    <h5>參考答案</h5>
                    {part.answers.length === 0 ? (
                        <AdminNotice tone="warning">
                            此版本沒有可顯示的參考答案。
                        </AdminNotice>
                    ) : (
                        <ul className={styles.detailItems}>
                            {part.answers.map((answer) => (
                                <li key={answer.id}>
                                    <div>
                                        <strong>答案 {answer.position + 1}</strong>
                                        <span>
                                            答案鍵：{formatViewValue(answer.answerKey)}；接受值：
                                            {formatViewValue(answer.acceptedValue)}
                                        </span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </section>
    );
}

function SourcesList({ sources }: { sources: readonly QuestionSourceDto[] }) {
    if (sources.length === 0) return <AdminNotice tone="muted">無資料</AdminNotice>;
    return (
        <ul className={styles.detailItems}>
            {sources.map((source) => (
                <li key={source.id}>
                    <div className={styles.detailItemContent}>
                        <div className={styles.badgeList}>
                            <strong>{sourceLabel(source)}</strong>
                            {source.primary ? (
                                <AdminStatusBadge
                                    status="primary"
                                    label="主要來源"
                                    tone="primary"
                                />
                            ) : null}
                            <AdminStatusBadge status={source.documentStatus} />
                        </div>
                        <span>
                            {labelFor(INPUT_TYPE_LABELS, source.inputType)}；
                            {formatViewValue(sourceReference(source), "未提供頁碼或題號")}
                        </span>
                        {source.cropAssetId !== null ? (
                            source.cropAssetUrl !== null ? (
                                <figure className={styles.mediaFigure}>
                                    <img
                                        className={`${styles.mediaImage} ${styles.sourceCropImage}`}
                                        src={source.cropAssetUrl}
                                        alt={`${sourceLabel(source)}的來源裁切預覽`}
                                        loading="lazy"
                                        decoding="async"
                                    />
                                    <figcaption className={styles.mediaCaption}>
                                        <span>來源裁切預覽</span>
                                        <ProtectedAssetLink href={source.cropAssetUrl}>
                                            在新分頁開啟或重試來源裁切圖
                                        </ProtectedAssetLink>
                                    </figcaption>
                                </figure>
                            ) : (
                                <span>附有來源裁切圖。</span>
                            )
                        ) : null}
                    </div>
                </li>
            ))}
        </ul>
    );
}

function ReviewsList({ reviews }: { reviews: readonly QuestionReviewDto[] }) {
    if (reviews.length === 0) return <AdminNotice tone="muted">無資料</AdminNotice>;
    return (
        <ol className={styles.timeline}>
            {reviews.map((review) => (
                <li key={review.id} className={styles.timelineItem}>
                    <div className={styles.timelineMarker} aria-hidden="true" />
                    <div className={styles.timelineContent}>
                        <div className={styles.timelineHeading}>
                            <strong>{reviewerLabel(review)}</strong>
                            <AdminStatusBadge
                                status={review.decision}
                                label={labelFor(REVIEW_DECISION_LABELS, review.decision)}
                                tone={
                                    review.decision === "approved"
                                        ? "success"
                                        : review.decision === "rejected"
                                          ? "danger"
                                          : "warning"
                                }
                            />
                        </div>
                        <p>
                            {labelFor(QUESTION_STATUS_LABELS, review.fromStatus)} → {labelFor(
                                QUESTION_STATUS_LABELS,
                                review.toStatus,
                            )}；{review.createdAt}
                        </p>
                        <p>說明：{formatViewValue(review.reason)}</p>
                    </div>
                </li>
            ))}
        </ol>
    );
}

function recordString(
    record: QuestionClassificationDto,
    key: string,
): string | null {
    const value = record[key];
    return typeof value === "string" && value.trim() ? value : null;
}

function recordBoolean(
    record: QuestionClassificationDto,
    key: string,
): boolean | null {
    const value = record[key];
    return typeof value === "boolean" ? value : null;
}

function recordConfidence(record: QuestionClassificationDto): string | null {
    const value = record.confidence;
    const numeric = typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
          ? Number(value)
          : Number.NaN;
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1
        ? `${Math.round(numeric * 100)}%`
        : null;
}

function ClassificationList({
    title,
    rows,
}: {
    title: string;
    rows: readonly QuestionClassificationDto[];
}) {
    return (
        <section className={styles.contentStack}>
            <h5>{title}</h5>
            {rows.length === 0 ? (
                <AdminNotice tone="muted">無資料</AdminNotice>
            ) : (
                <ul className={styles.detailItems}>
                    {rows.map((row, index) => {
                        const fieldName = recordString(row, "fieldName");
                        const displayValue =
                            recordString(row, "name")
                            ?? recordString(row, "optionLabel")
                            ?? recordString(row, "rawLabel")
                            ?? recordString(row, "normalizedValue")
                            ?? recordString(row, "optionValue")
                            ?? recordString(row, "rawValue")
                            ?? recordString(row, "code")
                            ?? "未填";
                        const code = recordString(row, "code");
                        const metadata = [
                            code && code !== displayValue ? `代碼 ${code}` : null,
                            recordBoolean(row, "primary") ? "主要分類" : null,
                            recordString(row, "assignmentType"),
                            recordString(row, "valueSource"),
                            recordConfidence(row) === null
                                ? null
                                : `信心值 ${recordConfidence(row)}`,
                        ].filter((value): value is string => value !== null);

                        return (
                            <li key={`${title}-${recordString(row, "id") ?? index}`}>
                                <div>
                                    <strong>
                                        {fieldName ? `${fieldName}：${displayValue}` : displayValue}
                                    </strong>
                                    {metadata.length > 0 ? (
                                        <span>{metadata.join("；")}</span>
                                    ) : null}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

function RevisionPanel({
    revision,
    currentRevisionId,
}: {
    revision: QuestionRevisionDto;
    currentRevisionId: string | null;
}) {
    const globalBlocks = revision.contentBlocks.filter(
        (block) => block.questionPartId === null,
    );
    return (
        <article className={styles.policyPanel} aria-labelledby={`revision-${revision.id}`}>
            <div className={styles.contentStack}>
                <div className={styles.timelineHeading}>
                    <h3 id={`revision-${revision.id}`}>版本 v{revision.number}</h3>
                    <AdminStatusBadge
                        status={revision.status}
                        label={labelFor(QUESTION_STATUS_LABELS, revision.status)}
                    />
                    {revision.id === currentRevisionId ? (
                        <AdminStatusBadge
                            status="current"
                            label="目前版本"
                            tone="primary"
                        />
                    ) : null}
                </div>

                <DetailList
                    items={[
                        {
                            label: "標準題型",
                            value: `${revision.questionType.name} (${revision.questionType.code})`,
                        },
                        {
                            label: "來源題型原文",
                            value: revision.originalQuestionTypeLabel,
                        },
                        { label: "科目", value: revision.subject?.name ?? null },
                        { label: "年級", value: revision.grade?.name ?? null },
                        { label: "學期", value: revision.semester?.name ?? null },
                        { label: "教材版本", value: revision.bookVersion?.name ?? null },
                        { label: "考試級別", value: revision.examLevel?.name ?? null },
                        { label: "難度", value: revision.difficulty?.name ?? null },
                        { label: "題目來源", value: revision.sourceCategory?.name ?? null },
                        { label: "建立者", value: actorLabel(revision.createdBy) },
                        { label: "建立時間", value: revision.createdAt },
                        { label: "發布時間", value: revision.publishedAt },
                        { label: "修改原因", value: revision.changeNote },
                    ]}
                />

                <section className={styles.contentStack}>
                    <h4>版本共用內容</h4>
                    <ContentBlockList blocks={globalBlocks} />
                </section>

                <section className={styles.contentStack}>
                    <h4>小題、選項與參考答案</h4>
                    {revision.parts.length === 0 ? (
                        <AdminNotice tone="warning">此版本沒有小題資料。</AdminNotice>
                    ) : (
                        revision.parts.map((part) => (
                            <QuestionPartPanel
                                key={part.id}
                                part={part}
                                parts={revision.parts}
                                contentBlocks={revision.contentBlocks}
                            />
                        ))
                    )}
                </section>

                <section className={styles.contentStack}>
                    <h4>來源文件</h4>
                    <SourcesList sources={revision.sources} />
                </section>

                <section className={styles.contentStack}>
                    <h4>分類資料</h4>
                    <ClassificationList title="教材單元" rows={revision.classifications.units} />
                    <ClassificationList title="主題" rows={revision.classifications.topics} />
                    <ClassificationList
                        title="知識點"
                        rows={revision.classifications.knowledgePoints}
                    />
                    <ClassificationList
                        title="課綱代碼"
                        rows={revision.classifications.curriculumCodes}
                    />
                    <ClassificationList
                        title="來源專屬欄位"
                        rows={revision.classifications.filterValues}
                    />
                </section>

                <section className={styles.contentStack}>
                    <h4>審核紀錄</h4>
                    <ReviewsList reviews={revision.reviews} />
                </section>
            </div>
        </article>
    );
}

function HeaderCell({
    sorts,
    sortKey,
    label,
}: {
    sorts: readonly ViewSortLinkDto[];
    sortKey: string;
    label: string;
}) {
    const sort = sortLinkFor(sorts, sortKey);
    return sort ? (
        <ViewSortHeader sort={sort} />
    ) : (
        <AdminTableHeadCell>{label}</AdminTableHeadCell>
    );
}

export function QuestionsView({
    state,
    filters,
    sorts,
    rows,
    pagination,
    detail,
    detailCloseHref,
    hasActiveFilters,
    reviewQueueHref,
}: QuestionsViewProps) {
    const currentRevision = detail?.displayRevision ?? null;
    const currentSource =
        currentRevision?.sources.find((source) => source.primary)
        ?? currentRevision?.sources[0]
        ?? null;

    return (
        <AdminPage
            title="題庫管理"
            eyebrow="Question bank"
            description="檢視全題庫、來源與固定版本；任何編修都建立新 revision，不覆寫歷史作答引用的版本。"
            actions={
                reviewQueueHref ? (
                    <Button asChild appearance="outline" tone="primary">
                        <a href={reviewQueueHref}>開啟審核佇列</a>
                    </Button>
                ) : undefined
            }
        >
            <div className={styles.viewStack}>
                <AdminNotice title="版本保存原則" tone="info">
                    已發布與已取代版本保持不可覆寫；歷史練習持續指向當時使用的 question revision。
                </AdminNotice>

                <ViewFilters filters={filters} />

                <div className={styles.desktopRecordTable}>
                    <AdminTableFrame
                        aria-label="題庫清單"
                        minWidth={1160}
                        footer={<ViewPagination pagination={pagination} />}
                    >
                        <AdminTableHeader>
                            <AdminTableRow>
                                <AdminTableHeadCell>題目</AdminTableHeadCell>
                                <HeaderCell sorts={sorts} sortKey="origin" label="來源範圍" />
                                <HeaderCell sorts={sorts} sortKey="status" label="題目狀態" />
                                <HeaderCell
                                    sorts={sorts}
                                    sortKey="revisionNumber"
                                    label="目前版本"
                                />
                                <AdminTableHeadCell>來源文件</AdminTableHeadCell>
                                <AdminTableHeadCell>所屬題庫</AdminTableHeadCell>
                                <HeaderCell
                                    sorts={sorts}
                                    sortKey="createdAt"
                                    label="建立時間"
                                />
                                <AdminTableHeadCell>操作</AdminTableHeadCell>
                            </AdminTableRow>
                        </AdminTableHeader>
                        <AdminTableBody>
                            {state.kind === "loading" ? (
                                <AdminTableLoadingState
                                    colSpan={8}
                                    title={state.message ?? "正在載入題庫"}
                                />
                            ) : state.kind === "error" ? (
                                <AdminTableErrorState
                                    colSpan={8}
                                    description={state.message}
                                    retryHref={state.retryHref ?? ""}
                                    retryLabel={state.retryLabel}
                                />
                            ) : rows.length === 0 ? (
                                <AdminTableEmptyState
                                    colSpan={8}
                                    title={
                                        hasActiveFilters
                                            ? "找不到符合條件的題目"
                                            : "題庫尚無題目"
                                    }
                                    description={
                                        hasActiveFilters
                                            ? "請調整關鍵字、題目範圍或版本篩選。"
                                            : "目前沒有可顯示的題目；匯入或建立題目後會出現在這裡。"
                                    }
                                />
                            ) : (
                                rows.map((question) => (
                                    <AdminTableRow key={question.id}>
                                        <AdminTableCell>
                                            <div className={styles.questionPrompt}>
                                                <strong>{question.prompt}</strong>
                                                <span>{question.id}</span>
                                            </div>
                                        </AdminTableCell>
                                        <AdminTableCell>
                                            <AdminStatusBadge
                                                status={question.origin}
                                                label={
                                                    question.origin === "system"
                                                        ? "系統題目"
                                                        : "帳號題目"
                                                }
                                                tone={
                                                    question.origin === "system"
                                                        ? "primary"
                                                        : "light"
                                                }
                                            />
                                        </AdminTableCell>
                                        <AdminTableCell>
                                            <AdminStatusBadge
                                                status={question.status}
                                                label={labelFor(
                                                    QUESTION_STATUS_LABELS,
                                                    question.status,
                                                )}
                                            />
                                        </AdminTableCell>
                                        <AdminTableCell className={styles.numericCell}>
                                            {question.revisionNumber === null
                                                ? "尚無目前版本"
                                                : `v${question.revisionNumber}`}
                                        </AdminTableCell>
                                        <AdminTableCell>
                                            {formatViewValue(question.sourceLabel)}
                                        </AdminTableCell>
                                        <AdminTableCell>
                                            {question.banks.length === 0
                                                ? "未加入題庫"
                                                : question.banks.map((bank) => bank.name).join("、")}
                                        </AdminTableCell>
                                        <AdminTableCell>{question.createdAt}</AdminTableCell>
                                        <AdminTableActionCell>
                                            <Button
                                                asChild
                                                size="sm"
                                                appearance="outline"
                                                tone="primary"
                                            >
                                                <a href={question.detailHref}>查看</a>
                                            </Button>
                                        </AdminTableActionCell>
                                    </AdminTableRow>
                                ))
                            )}
                        </AdminTableBody>
                    </AdminTableFrame>
                </div>

                <MobileRecordList label="題庫清單">
                    {state.kind === "loading" ? (
                        <MobileListState
                            kind="loading"
                            title={state.message ?? "正在載入題庫"}
                        />
                    ) : state.kind === "error" ? (
                        <MobileListState
                            kind="error"
                            title="無法載入題庫"
                            description={state.message}
                            action={
                                <Button asChild appearance="outline" tone="primary">
                                    <a href={state.retryHref ?? ""}>
                                        {state.retryLabel ?? "重新載入"}
                                    </a>
                                </Button>
                            }
                        />
                    ) : rows.length === 0 ? (
                        <MobileListState
                            kind="empty"
                            title={
                                hasActiveFilters
                                    ? "找不到符合條件的題目"
                                    : "題庫尚無題目"
                            }
                            description={
                                hasActiveFilters
                                    ? "請調整關鍵字、題目範圍或版本篩選。"
                                    : "目前沒有可顯示的題目；匯入或建立題目後會出現在這裡。"
                            }
                        />
                    ) : (
                        <>
                            {rows.map((question) => (
                                <MobileRecordCard
                                    key={question.id}
                                    title={question.prompt}
                                    subtitle={question.id}
                                    badges={
                                        <>
                                            <AdminStatusBadge
                                                status={question.origin}
                                                label={
                                                    question.origin === "system"
                                                        ? "系統題目"
                                                        : "帳號題目"
                                                }
                                                tone={
                                                    question.origin === "system"
                                                        ? "primary"
                                                        : "light"
                                                }
                                            />
                                            <AdminStatusBadge
                                                status={question.status}
                                                label={labelFor(
                                                    QUESTION_STATUS_LABELS,
                                                    question.status,
                                                )}
                                            />
                                        </>
                                    }
                                    fields={[
                                        {
                                            label: "目前版本",
                                            value: question.revisionNumber === null
                                                ? "尚無目前版本"
                                                : `v${question.revisionNumber}`,
                                        },
                                        {
                                            label: "來源文件",
                                            value: formatViewValue(question.sourceLabel),
                                        },
                                        {
                                            label: "所屬題庫",
                                            value: question.banks.length === 0
                                                ? "未加入題庫"
                                                : question.banks.map((bank) => bank.name).join("、"),
                                        },
                                        { label: "建立時間", value: question.createdAt },
                                    ]}
                                    action={
                                        <Button asChild appearance="outline" tone="primary">
                                            <a href={question.detailHref}>查看題目</a>
                                        </Button>
                                    }
                                />
                            ))}
                            <div className={styles.mobilePagination}>
                                <ViewPagination pagination={pagination} />
                            </div>
                        </>
                    )}
                </MobileRecordList>
            </div>

            <RouteDrawer
                open={detail !== null}
                closeHref={detailCloseHref}
                title="題目詳情"
                description={detail ? `題目 ID：${detail.id}` : "題目詳情"}
                size="xl"
            >
                {detail ? (
                    <div className={styles.drawerStack}>
                        {detail.accessPolicy.mode === "read-only" ? (
                            <AdminNotice title="目前為唯讀" tone="warning">
                                {detail.accessPolicy.reason}
                            </AdminNotice>
                        ) : (
                            <div className={styles.inlineActionNotice}>
                                <AdminNotice title="以新版本編修" tone="info">
                                    {detail.accessPolicy.reason ??
                                        "編修會建立新草稿版本，不會改動目前已發布內容。"}
                                </AdminNotice>
                                <Button asChild appearance="solid" tone="primary">
                                    <a href={detail.accessPolicy.href}>
                                        {detail.accessPolicy.label}
                                    </a>
                                </Button>
                            </div>
                        )}

                        {detail.origin === "system"
                            && detail.accessPolicy.mode === "editable" ? (
                                <QuestionMutationWorkflow
                                    detail={detail}
                                    accessPolicy={detail.accessPolicy}
                                />
                            ) : null}

                        <Card>
                            <CardHeader>
                                <CardTitle asChild>
                                    <h2>顯示內容</h2>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className={styles.contentStack}>
                                <p className={styles.fullQuestionText}>
                                    {currentPrompt(currentRevision)}
                                </p>
                                <DetailList
                                    items={[
                                        {
                                            label: "題目範圍",
                                            value:
                                                detail.origin === "system"
                                                    ? "系統題目"
                                                    : "帳號題目",
                                        },
                                        {
                                            label: "題目狀態",
                                            value: labelFor(
                                                QUESTION_STATUS_LABELS,
                                                detail.status,
                                            ),
                                        },
                                        {
                                            label: "建立方式",
                                            value: labelFor(
                                                CREATED_METHOD_LABELS,
                                                detail.createdMethod,
                                            ),
                                        },
                                        {
                                            label: "顯示版本",
                                            value:
                                                currentRevision === null
                                                    ? null
                                                    : `v${currentRevision.number}${
                                                          currentRevision.id
                                                              === detail.currentRevisionId
                                                              ? "（目前版本）"
                                                              : "（選定歷史版本）"
                                                      }`,
                                        },
                                        {
                                            label: "參考答案筆數",
                                            value: referenceAnswerCount(currentRevision),
                                        },
                                        {
                                            label: "題目擁有者",
                                            value: detail.owner?.displayName ?? null,
                                        },
                                        {
                                            label: "題目建立者",
                                            value: detail.createdBy?.displayName ?? null,
                                        },
                                        { label: "建立時間", value: detail.createdAt },
                                        { label: "封存時間", value: detail.archivedAt },
                                        {
                                            label: "主要來源",
                                            value:
                                                currentSource === null
                                                    ? null
                                                    : sourceLabel(currentSource),
                                        },
                                        {
                                            label: "來源定位",
                                            value:
                                                currentSource === null
                                                    ? null
                                                    : sourceReference(currentSource),
                                        },
                                    ]}
                                />
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle asChild>
                                    <h2>題目識別碼</h2>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className={styles.contentStack}>
                                {detail.identifiers.length === 0 ? (
                                    <AdminNotice tone="muted">無資料</AdminNotice>
                                ) : (
                                    <ul className={styles.detailItems}>
                                        {detail.identifiers.map((identifier) => {
                                            const scope = [
                                                identifier.publisherName,
                                                identifier.bookVersionName,
                                                identifier.sourceDocumentId === null
                                                    ? null
                                                    : "已連結來源文件",
                                            ].filter(
                                                (value): value is string => value !== null,
                                            );
                                            return (
                                                <li key={identifier.id}>
                                                    <div>
                                                        <strong>
                                                            {labelFor(
                                                                IDENTIFIER_TYPE_LABELS,
                                                                identifier.type,
                                                            )}
                                                            ：{identifier.value}
                                                        </strong>
                                                        {scope.length > 0 ? (
                                                            <span>{scope.join("；")}</span>
                                                        ) : null}
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle asChild>
                                    <h2>顯示版本的完整內容</h2>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className={styles.contentStack}>
                                {detail.displayRevision === null ? (
                                    <AdminNotice title="尚無目前版本" tone="muted">
                                        這個題目沒有目前版本。若已有歷史版本，可從下方版本歷程選取查看。
                                    </AdminNotice>
                                ) : (
                                    <RevisionPanel
                                        revision={detail.displayRevision}
                                        currentRevisionId={detail.currentRevisionId}
                                    />
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle asChild>
                                    <h2>版本歷程</h2>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className={styles.contentStack}>
                                <p>
                                    第 {detail.revisionHistory.page} 頁；每頁 {detail.revisionHistory.pageSize}
                                    筆，共 {detail.revisionHistory.total} 個版本。
                                </p>
                                {detail.revisionHistory.items.length === 0 ? (
                                    <AdminNotice tone="muted">
                                        {detail.revisionHistory.total === 0
                                            ? "此題目尚無版本歷史。"
                                            : "這一頁沒有版本，請返回上一頁。"}
                                    </AdminNotice>
                                ) : (
                                    <ol className={styles.timeline}>
                                        {detail.revisionHistory.items.map((revision) => (
                                            <li key={revision.id} className={styles.timelineItem}>
                                                <div
                                                    className={styles.timelineMarker}
                                                    aria-hidden="true"
                                                />
                                                <div className={styles.timelineContent}>
                                                    <div className={styles.timelineHeading}>
                                                        <strong>v{revision.number}</strong>
                                                        <div className={styles.badgeList}>
                                                            <AdminStatusBadge
                                                                status={revision.status}
                                                                label={labelFor(
                                                                    QUESTION_STATUS_LABELS,
                                                                    revision.status,
                                                                )}
                                                            />
                                                            {revision.id === detail.currentRevisionId ? (
                                                                <AdminStatusBadge
                                                                    status="current"
                                                                    label="目前版本"
                                                                    tone="primary"
                                                                />
                                                            ) : null}
                                                            {revision.id === detail.selectedRevisionId ? (
                                                                <AdminStatusBadge
                                                                    status="selected"
                                                                    label="正在查看"
                                                                    tone="light"
                                                                />
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                    <p>
                                                        {revision.questionType.name}；建立於 {revision.createdAt}
                                                    </p>
                                                    <p>
                                                        變更說明：{formatViewValue(revision.changeNote)}
                                                    </p>
                                                    <Button
                                                        asChild
                                                        size="sm"
                                                        appearance="outline"
                                                        tone="primary"
                                                    >
                                                        <a href={revision.detailHref}>查看此版本</a>
                                                    </Button>
                                                </div>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                                <div className={styles.sectionActions}>
                                    {detail.revisionHistory.previousHref ? (
                                        <Button asChild appearance="outline" tone="muted">
                                            <a href={detail.revisionHistory.previousHref}>上一頁版本</a>
                                        </Button>
                                    ) : null}
                                    {detail.revisionHistory.nextHref ? (
                                        <Button asChild appearance="outline" tone="muted">
                                            <a href={detail.revisionHistory.nextHref}>下一頁版本</a>
                                        </Button>
                                    ) : null}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                ) : null}
            </RouteDrawer>
        </AdminPage>
    );
}
