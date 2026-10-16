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
import type {
    SubscriptionPlansViewProps,
    ViewSortLinkDto,
} from "./view-types";
import {
    ActionPolicyControl,
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

export function SubscriptionPlansView({
    state,
    catalogState,
    filters,
    sorts = [],
    rows,
    pagination,
    catalogPolicy,
}: SubscriptionPlansViewProps) {
    const catalogReady = catalogState === "ready";
    const visibleRows = catalogReady ? rows : [];

    return (
        <AdminPage
            title="訂閱方案目錄"
            eyebrow="Subscription catalog"
            description="管理未來方案、價格週期、幣別與功能限制的目錄資料。方案狀態不代表可付款。"
        >
            <div className={styles.viewStack}>
                <AdminNotice title="支付尚未串接" tone="warning">
                    目前沒有 checkout、扣款、付款資料、帳號訂閱、發票或收入串接；本頁不顯示付費人數或營收。
                </AdminNotice>

                {catalogState === "schema_pending" ? (
                    <AdminNotice title="目錄資料表尚待整合" tone="info">
                        目前只能驗收介面契約，不會把空畫面或合成 fixture 視為已完成的正式方案串接。
                    </AdminNotice>
                ) : null}

                <div className={styles.policyPanel}>
                    <ActionPolicyControl title="方案目錄異動" policy={catalogPolicy} />
                </div>

                {filters ? <ViewFilters filters={filters} /> : null}

                <div className={styles.desktopRecordTable}>
                    <AdminTableFrame
                        aria-label="訂閱方案目錄"
                        minWidth={1060}
                        footer={
                            catalogReady && pagination ? (
                                <ViewPagination pagination={pagination} />
                            ) : undefined
                        }
                    >
                    <AdminTableHeader>
                        <AdminTableRow>
                            <HeaderCell sorts={sorts} sortKey="code" label="代碼" />
                            <HeaderCell sorts={sorts} sortKey="name" label="方案" />
                            <HeaderCell sorts={sorts} sortKey="status" label="狀態" />
                            <AdminTableHeadCell>價格與幣別</AdminTableHeadCell>
                            <AdminTableHeadCell>計費週期</AdminTableHeadCell>
                            <AdminTableHeadCell>功能限制</AdminTableHeadCell>
                            <HeaderCell sorts={sorts} sortKey="updatedAt" label="更新時間" />
                            <AdminTableHeadCell>操作</AdminTableHeadCell>
                        </AdminTableRow>
                    </AdminTableHeader>
                    <AdminTableBody>
                        {state.kind === "loading" ? (
                            <AdminTableLoadingState
                                colSpan={8}
                                title={state.message ?? "正在載入方案目錄"}
                            />
                        ) : state.kind === "error" ? (
                            <AdminTableErrorState
                                colSpan={8}
                                description={state.message}
                                retryHref={state.retryHref ?? ""}
                                retryLabel={state.retryLabel}
                            />
                        ) : visibleRows.length === 0 ? (
                            <AdminTableEmptyState
                                colSpan={8}
                                title={catalogReady ? "尚未建立方案" : "方案目錄尚未串接"}
                                description={
                                    catalogReady
                                        ? "正式方案值尚未確認時，系統不會自動建立示意方案或價格。"
                                        : "資料表與服務契約完成前，不會顯示合成方案、價格或功能限制。"
                                }
                            />
                        ) : (
                            visibleRows.map((plan) => (
                                <AdminTableRow key={plan.id}>
                                    <AdminTableCell>
                                        <code className={styles.codeValue}>{plan.code}</code>
                                    </AdminTableCell>
                                    <AdminTableCell>
                                        <div className={styles.primaryCell}>
                                            <strong>{plan.name}</strong>
                                            {plan.description ? <span>{plan.description}</span> : null}
                                        </div>
                                    </AdminTableCell>
                                    <AdminTableCell>
                                        <AdminStatusBadge status={plan.status} />
                                    </AdminTableCell>
                                    <AdminTableCell>
                                        {formatViewValue(plan.priceSummary, "無資料")}
                                    </AdminTableCell>
                                    <AdminTableCell>
                                        {formatViewValue(plan.billingSummary, "無資料")}
                                    </AdminTableCell>
                                    <AdminTableCell>
                                        {formatViewValue(plan.featureSummary, "無資料")}
                                    </AdminTableCell>
                                    <AdminTableCell>{plan.updatedAt}</AdminTableCell>
                                    <AdminTableActionCell>
                                        {plan.detailHref ? (
                                            <Button
                                                asChild
                                                size="sm"
                                                appearance="outline"
                                                tone="primary"
                                            >
                                                <a href={plan.detailHref}>查看</a>
                                            </Button>
                                        ) : (
                                            <span className={styles.mutedText}>無可用操作</span>
                                        )}
                                    </AdminTableActionCell>
                                </AdminTableRow>
                            ))
                        )}
                    </AdminTableBody>
                    </AdminTableFrame>
                </div>

                <MobileRecordList label="訂閱方案目錄（行動版）">
                    {state.kind === "loading" ? (
                        <MobileListState
                            kind="loading"
                            title={state.message ?? "正在載入方案目錄"}
                        />
                    ) : state.kind === "error" ? (
                        <MobileListState
                            kind="error"
                            title="無法載入方案目錄"
                            description={state.message}
                            action={
                                <Button asChild appearance="outline" tone="primary">
                                    <a href={state.retryHref ?? ""}>
                                        {state.retryLabel ?? "重新載入"}
                                    </a>
                                </Button>
                            }
                        />
                    ) : visibleRows.length === 0 ? (
                        <MobileListState
                            kind="empty"
                            title={catalogReady ? "尚未建立方案" : "方案目錄尚未串接"}
                            description={
                                catalogReady
                                    ? "正式方案值尚未確認時，不會自動建立示意方案或價格。"
                                    : "資料表與服務契約完成前，不會顯示合成方案、價格或功能限制。"
                            }
                        />
                    ) : (
                        <>
                            {visibleRows.map((plan) => (
                                <MobileRecordCard
                                    key={plan.id}
                                    title={plan.name}
                                    subtitle={plan.code}
                                    badges={<AdminStatusBadge status={plan.status} />}
                                    fields={[
                                        {
                                            label: "價格與幣別",
                                            value: formatViewValue(plan.priceSummary, "無資料"),
                                        },
                                        {
                                            label: "計費週期",
                                            value: formatViewValue(plan.billingSummary, "無資料"),
                                        },
                                        {
                                            label: "功能限制",
                                            value: formatViewValue(plan.featureSummary, "無資料"),
                                        },
                                        { label: "更新時間", value: plan.updatedAt },
                                    ]}
                                    action={
                                        plan.detailHref ? (
                                            <Button asChild appearance="outline" tone="primary">
                                                <a href={plan.detailHref}>查看方案詳情</a>
                                            </Button>
                                        ) : (
                                            <span className={styles.mutedText}>無可用操作</span>
                                        )
                                    }
                                />
                            ))}
                            {pagination ? (
                                <div className={styles.mobilePagination}>
                                    <ViewPagination pagination={pagination} />
                                </div>
                            ) : null}
                        </>
                    )}
                </MobileRecordList>
            </div>
        </AdminPage>
    );
}
