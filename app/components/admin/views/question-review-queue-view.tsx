import { Button } from "@keel-design/ui";

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
import type { QuestionReviewQueueViewProps } from "./view-types";
import {
    MobileListState,
    MobileRecordCard,
    MobileRecordList,
    ViewFilters,
    ViewPagination,
    formatViewValue,
} from "./view-shared";

import styles from "./views.module.css";

export function QuestionReviewQueueView({
    state,
    filters,
    rows,
    pagination,
    hasActiveFilters,
    backHref,
}: QuestionReviewQueueViewProps) {
    const emptyTitle = hasActiveFilters
        ? "找不到符合條件的待審草稿"
        : "目前沒有待審草稿";
    const emptyDescription = hasActiveFilters
        ? "請調整關鍵字或待審狀態篩選。"
        : "新草稿建立後會依建立時間出現在這裡。";

    return (
        <AdminPage
            title="題目審核佇列"
            eyebrow="Question review queue"
            description="集中檢視系統題目的待審草稿；開啟項目後仍會重新確認管理員與版本狀態。"
            actions={(
                <Button asChild appearance="outline" tone="muted">
                    <a href={backHref}>返回題庫管理</a>
                </Button>
            )}
        >
            <div className={styles.viewStack}>
                <AdminNotice title="只列出可處理的固定版本" tone="info">
                    佇列只包含系統題目的草稿版本；已封存、帳號自有與非草稿版本不會出現。
                </AdminNotice>

                <ViewFilters filters={filters} />

                <div className={styles.desktopRecordTable}>
                    <AdminTableFrame
                        aria-label="題目審核佇列"
                        minWidth={1040}
                        footer={<ViewPagination pagination={pagination} />}
                    >
                        <AdminTableHeader>
                            <AdminTableRow>
                                <AdminTableHeadCell>草稿題目</AdminTableHeadCell>
                                <AdminTableHeadCell>版本</AdminTableHeadCell>
                                <AdminTableHeadCell>待審狀態</AdminTableHeadCell>
                                <AdminTableHeadCell>修改原因／最近退回</AdminTableHeadCell>
                                <AdminTableHeadCell>建立者</AdminTableHeadCell>
                                <AdminTableHeadCell>建立時間</AdminTableHeadCell>
                                <AdminTableHeadCell>操作</AdminTableHeadCell>
                            </AdminTableRow>
                        </AdminTableHeader>
                        <AdminTableBody>
                            {state.kind === "loading" ? (
                                <AdminTableLoadingState colSpan={7} title="正在載入審核佇列" />
                            ) : state.kind === "error" ? (
                                <AdminTableErrorState
                                    colSpan={7}
                                    description={state.message}
                                    retryHref={state.retryHref ?? ""}
                                    retryLabel={state.retryLabel}
                                />
                            ) : rows.length === 0 ? (
                                <AdminTableEmptyState
                                    colSpan={7}
                                    title={emptyTitle}
                                    description={emptyDescription}
                                />
                            ) : rows.map((row) => (
                                <AdminTableRow key={row.draftRevisionId}>
                                    <AdminTableCell>
                                        <div className={styles.questionPrompt}>
                                            <strong>{row.prompt}</strong>
                                            <span>{row.questionId}</span>
                                        </div>
                                    </AdminTableCell>
                                    <AdminTableCell className={styles.numericCell}>
                                        v{row.draftRevisionNumber}
                                        {" · "}
                                        目前 v{row.currentRevisionNumber}
                                    </AdminTableCell>
                                    <AdminTableCell>
                                        <AdminStatusBadge
                                            status={row.reviewState}
                                            label={row.reviewStateLabel}
                                            tone={row.reviewState === "changes_requested"
                                                ? "warning"
                                                : "primary"}
                                        />
                                    </AdminTableCell>
                                    <AdminTableCell>
                                        {formatViewValue(
                                            row.latestReviewReason ?? row.changeNote,
                                            "未填",
                                        )}
                                        {row.latestReviewAt ? ` · ${row.latestReviewAt}` : ""}
                                    </AdminTableCell>
                                    <AdminTableCell>{row.createdBy}</AdminTableCell>
                                    <AdminTableCell>{row.createdAt}</AdminTableCell>
                                    <AdminTableActionCell>
                                        <Button asChild size="sm" appearance="outline" tone="primary">
                                            <a href={row.detailHref}>開啟草稿</a>
                                        </Button>
                                    </AdminTableActionCell>
                                </AdminTableRow>
                            ))}
                        </AdminTableBody>
                    </AdminTableFrame>
                </div>

                <MobileRecordList label="題目審核佇列">
                    {state.kind === "loading" ? (
                        <MobileListState kind="loading" title="正在載入審核佇列" />
                    ) : state.kind === "error" ? (
                        <MobileListState
                            kind="error"
                            title="無法載入審核佇列"
                            description={state.message}
                            action={(
                                <Button asChild appearance="outline" tone="primary">
                                    <a href={state.retryHref ?? ""}>重新載入</a>
                                </Button>
                            )}
                        />
                    ) : rows.length === 0 ? (
                        <MobileListState
                            kind="empty"
                            title={emptyTitle}
                            description={emptyDescription}
                        />
                    ) : (
                        <>
                            {rows.map((row) => (
                                <MobileRecordCard
                                    key={row.draftRevisionId}
                                    title={row.prompt}
                                    subtitle={`v${row.draftRevisionNumber} · ${row.questionId}`}
                                    badges={(
                                        <AdminStatusBadge
                                            status={row.reviewState}
                                            label={row.reviewStateLabel}
                                            tone={row.reviewState === "changes_requested"
                                                ? "warning"
                                                : "primary"}
                                        />
                                    )}
                                    fields={[
                                        { label: "目前版本", value: `v${row.currentRevisionNumber}` },
                                        {
                                            label: "修改原因／退回",
                                            value: formatViewValue(
                                                row.latestReviewReason ?? row.changeNote,
                                                "未填",
                                            ),
                                        },
                                        { label: "建立者", value: row.createdBy },
                                        { label: "建立時間", value: row.createdAt },
                                    ]}
                                    action={(
                                        <Button asChild appearance="outline" tone="primary">
                                            <a href={row.detailHref}>開啟草稿</a>
                                        </Button>
                                    )}
                                />
                            ))}
                            <div className={styles.mobilePagination}>
                                <ViewPagination pagination={pagination} />
                            </div>
                        </>
                    )}
                </MobileRecordList>
            </div>
        </AdminPage>
    );
}
