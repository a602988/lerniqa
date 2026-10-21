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
import {
    SubscriptionCatalogActions,
    SubscriptionPlanActions,
} from "./subscription-catalog-actions";
import {
    subscriptionBillingIntervalLabel,
    subscriptionCatalogStatusLabel,
} from "./subscription-catalog-labels";
import { RouteDrawer } from "./route-drawer";
import type {
    SubscriptionPlansViewProps,
    ViewSortLinkDto,
} from "./view-types";
import {
    ActionPolicyControl,
    MobileListState,
    MobileRecordCard,
    MobileRecordList,
    DetailList,
    ViewFilters,
    ViewPagination,
    ViewSection,
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
    detail = null,
    detailCloseHref = "/admin/subscription-plans",
    featureDefinitions = [],
}: SubscriptionPlansViewProps) {
    const catalogReady = catalogState === "ready";
    const visibleRows = catalogReady ? rows : [];
    const hasActiveFilters = Boolean(
        filters
        && (
            (filters.search?.value.trim().length ?? 0) > 0
            || (filters.selects?.some((filter) => filter.value.trim().length > 0) ?? false)
        )
    );
    const emptyTitle = !catalogReady
        ? "沒有方案資料"
        : hasActiveFilters
            ? "找不到符合條件的方案"
            : "尚未建立方案";
    const emptyDescription = !catalogReady
        ? "目前沒有可顯示的方案、價格或功能限制。"
        : hasActiveFilters
            ? "請調整搜尋字詞或狀態篩選條件。"
            : "建立方案後，方案資料會顯示在這裡。";

    return (
        <AdminPage
            title="訂閱方案目錄"
            eyebrow="Subscription catalog"
            description="管理方案、價格週期、幣別與功能限制。"
        >
            <div className={styles.viewStack}>
                <div className={styles.policyPanel}>
                    <ActionPolicyControl title="方案目錄異動" policy={catalogPolicy} />
                </div>

                {catalogReady ? (
                    <SubscriptionCatalogActions featureDefinitions={featureDefinitions} />
                ) : null}

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
                                title={emptyTitle}
                                description={emptyDescription}
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
                            title={emptyTitle}
                            description={emptyDescription}
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

                <RouteDrawer
                    open={detail !== null}
                    closeHref={detailCloseHref}
                    title={detail?.name ?? "方案詳情"}
                    description={detail
                        ? detail.code
                        : "方案詳情"}
                    size="xl"
                >
                    {detail ? (
                        <div className={styles.drawerStack}>
                            <ViewSection title="方案資料">
                                <DetailList
                                    items={[
                                        { label: "方案代碼", value: detail.code },
                                        { label: "名稱", value: detail.name },
                                        { label: "說明", value: detail.description },
                                        {
                                            label: "狀態",
                                            value: subscriptionCatalogStatusLabel(detail.status),
                                        },
                                        { label: "資料版本", value: detail.lockVersion },
                                        { label: "建立時間", value: detail.createdAt },
                                        { label: "更新時間", value: detail.updatedAt },
                                    ]}
                                />
                            </ViewSection>

                            <ViewSection
                                title="價格版本"
                                description="金額固定顯示 minor unit；已啟用價格不原地修改。"
                            >
                                {detail.prices.length === 0 ? (
                                    <AdminNotice tone="muted">尚無價格。</AdminNotice>
                                ) : (
                                    <ul className={styles.detailItems}>
                                        {detail.prices.map((price) => (
                                            <li key={price.id}>
                                                <div className={styles.detailItemContent}>
                                                    <div className={styles.badgeList}>
                                                        <AdminStatusBadge status={price.status} />
                                                    </div>
                                                    <strong>
                                                        {price.currency} {price.amountMinor}（minor unit）
                                                    </strong>
                                                    <span>
                                                        每 {price.billingIntervalCount} {subscriptionBillingIntervalLabel(price.billingInterval)}；
                                                        生效 {price.effectiveFrom ?? "未填"}；
                                                        結束 {price.effectiveUntil ?? "未填"}；
                                                        版本 {price.lockVersion}
                                                    </span>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </ViewSection>

                            <ViewSection
                                title="功能限制"
                                description="未設定與不包含分開顯示；不從方案名稱推測功能。"
                            >
                                {detail.featureLimits.length === 0 ? (
                                    <AdminNotice tone="muted">尚未設定功能限制。</AdminNotice>
                                ) : (
                                    <ul className={styles.detailItems}>
                                        {detail.featureLimits.map((limit) => (
                                            <li key={limit.id}>
                                                <div className={styles.detailItemContent}>
                                                    <strong>{limit.displayName}</strong>
                                                    <span>
                                                        {limit.included
                                                            ? limit.unlimited
                                                                ? "包含，無上限"
                                                                : limit.limit === null
                                                                    ? "包含"
                                                                    : `包含，上限 ${limit.limit} ${limit.unit ?? ""}`
                                                            : "不包含"}
                                                        ；功能狀態 {subscriptionCatalogStatusLabel(limit.featureStatus)}；版本 {limit.lockVersion}
                                                    </span>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </ViewSection>

                            <ViewSection
                                title="目錄操作"
                                description="所有操作都會重新驗證管理員、檢查版本、寫入冪等收據與稽核。"
                            >
                                <SubscriptionPlanActions
                                    plan={detail}
                                    featureDefinitions={featureDefinitions}
                                />
                            </ViewSection>
                        </div>
                    ) : null}
                </RouteDrawer>
            </div>
        </AdminPage>
    );
}
