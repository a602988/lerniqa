import { Button } from "@keel-design/ui";

import { AdminPage } from "../admin-page";
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
import type { AuditViewProps, ViewSortLinkDto } from "./view-types";
import {
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

export function AuditView({
    state,
    filters,
    sorts,
    rows,
    pagination,
    hasActiveFilters,
}: AuditViewProps) {
    const emptyState = hasActiveFilters
        ? {
              title: "找不到符合條件的稽核紀錄",
              description: "請調整日期、操作類型或搜尋條件。",
          }
        : {
              title: "尚無稽核紀錄",
              description: "管理操作產生稽核紀錄後，會顯示在這裡。",
          };

    return (
        <AdminPage
            title="稽核紀錄"
            eyebrow="Audit log"
            description="檢視管理操作的時間、操作者、目標與請求識別；清單不直接暴露完整 before/after payload。"
        >
            <div className={styles.viewStack}>
                <ViewFilters filters={filters} />

                <div className={styles.desktopRecordTable}>
                    <AdminTableFrame
                        aria-label="稽核紀錄清單"
                        minWidth={1120}
                        footer={<ViewPagination pagination={pagination} />}
                    >
                    <AdminTableHeader>
                        <AdminTableRow>
                            <HeaderCell sorts={sorts} sortKey="occurredAt" label="發生時間" />
                            <AdminTableHeadCell>操作者</AdminTableHeadCell>
                            <HeaderCell sorts={sorts} sortKey="action" label="操作" />
                            <HeaderCell sorts={sorts} sortKey="targetType" label="目標類型" />
                            <AdminTableHeadCell>目標</AdminTableHeadCell>
                            <AdminTableHeadCell>Request ID</AdminTableHeadCell>
                            <AdminTableHeadCell>操作</AdminTableHeadCell>
                        </AdminTableRow>
                    </AdminTableHeader>
                    <AdminTableBody>
                        {state.kind === "loading" ? (
                            <AdminTableLoadingState
                                colSpan={7}
                                title={state.message ?? "正在載入稽核紀錄"}
                            />
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
                                title={emptyState.title}
                                description={emptyState.description}
                            />
                        ) : (
                            rows.map((entry) => (
                                <AdminTableRow key={entry.id}>
                                    <AdminTableCell>{entry.occurredAt}</AdminTableCell>
                                    <AdminTableCell>{entry.actorLabel}</AdminTableCell>
                                    <AdminTableCell>
                                        <code className={styles.codeValue}>{entry.actionLabel}</code>
                                    </AdminTableCell>
                                    <AdminTableCell>{entry.targetTypeLabel}</AdminTableCell>
                                    <AdminTableCell className={styles.longValue}>
                                        {formatViewValue(entry.targetLabel)}
                                    </AdminTableCell>
                                    <AdminTableCell className={styles.longValue}>
                                        {formatViewValue(entry.requestId)}
                                    </AdminTableCell>
                                    <AdminTableActionCell>
                                        {entry.detailHref ? (
                                            <Button
                                                asChild
                                                size="sm"
                                                appearance="outline"
                                                tone="primary"
                                            >
                                                <a href={entry.detailHref}>查看</a>
                                            </Button>
                                        ) : (
                                            <span className={styles.mutedText}>無可用詳情</span>
                                        )}
                                    </AdminTableActionCell>
                                </AdminTableRow>
                            ))
                        )}
                    </AdminTableBody>
                    </AdminTableFrame>
                </div>

                <MobileRecordList label="稽核紀錄清單（行動版）">
                    {state.kind === "loading" ? (
                        <MobileListState
                            kind="loading"
                            title={state.message ?? "正在載入稽核紀錄"}
                        />
                    ) : state.kind === "error" ? (
                        <MobileListState
                            kind="error"
                            title="無法載入稽核紀錄"
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
                            title={emptyState.title}
                            description={emptyState.description}
                        />
                    ) : (
                        <>
                            {rows.map((entry) => (
                                <MobileRecordCard
                                    key={entry.id}
                                    title={entry.actionLabel}
                                    subtitle={entry.occurredAt}
                                    fields={[
                                        { label: "操作者", value: entry.actorLabel },
                                        { label: "目標類型", value: entry.targetTypeLabel },
                                        {
                                            label: "目標",
                                            value: formatViewValue(entry.targetLabel),
                                        },
                                        {
                                            label: "Request ID",
                                            value: formatViewValue(entry.requestId),
                                        },
                                    ]}
                                    action={
                                        entry.detailHref ? (
                                            <Button asChild appearance="outline" tone="primary">
                                                <a href={entry.detailHref}>查看稽核詳情</a>
                                            </Button>
                                        ) : (
                                            <span className={styles.mutedText}>無可用詳情</span>
                                        )
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
        </AdminPage>
    );
}
