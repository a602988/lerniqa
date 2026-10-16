import {
    FileText,
    List,
    ListCheck,
    Table as TableIcon,
    User,
} from "@keel-design/icons";
import {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    FormField,
    Input,
    NativeSelect,
} from "@keel-design/ui";
import type { ReactNode } from "react";

import { AdminFilterBar } from "../admin-filter-bar";
import { AdminMetricCard } from "../admin-metric-card";
import { AdminNotice } from "../admin-notice";
import { AdminPagination } from "../admin-pagination";
import { AdminTableHeadCell } from "../admin-table";
import { PolicyDialog } from "./policy-dialog";
import type {
    ViewActionPolicyDto,
    ViewDisplayValue,
    ViewFilterDto,
    ViewLoadState,
    ViewMetricDto,
    ViewMetricValueDto,
    ViewPaginationDto,
    ViewSortLinkDto,
} from "./view-types";

import styles from "./views.module.css";

export function formatViewValue(
    value: ViewDisplayValue,
    nullLabel = "未填",
): string | number {
    return value === null ? nullLabel : value;
}

export function formatMetricValue(value: ViewMetricValueDto): string | number {
    switch (value.state) {
        case "available":
            return value.value;
        case "not_collected":
            return "無資料（尚未蒐集）";
        case "privacy_suppressed":
            return "未達顯示門檻";
        case "integration_pending":
            return "尚未串接";
        case "no_data":
        default:
            return "無資料";
    }
}

export function ViewFilters({ filters }: { filters: ViewFilterDto }) {
    return (
        <AdminFilterBar
            method="get"
            action={filters.action}
            search={
                filters.search ? (
                    <FormField
                        className={styles.compactField}
                        label={filters.search.label}
                        htmlFor={`filter-${filters.search.name}`}
                    >
                        <Input
                            id={`filter-${filters.search.name}`}
                            type="search"
                            name={filters.search.name}
                            defaultValue={filters.search.value}
                            placeholder={filters.search.placeholder}
                        />
                    </FormField>
                ) : undefined
            }
            filters={filters.selects?.map((select) => (
                <FormField
                    className={styles.compactField}
                    key={select.name}
                    label={select.label}
                    htmlFor={`filter-${select.name}`}
                >
                    <NativeSelect
                        id={`filter-${select.name}`}
                        name={select.name}
                        defaultValue={select.value}
                        options={[...select.options]}
                    />
                </FormField>
            ))}
            actions={
                <>
                    <Button type="submit" appearance="solid" tone="primary">
                        {filters.submitLabel ?? "套用篩選"}
                    </Button>
                    {filters.resetHref ? (
                        <Button asChild appearance="outline" tone="muted">
                            <a href={filters.resetHref}>清除篩選</a>
                        </Button>
                    ) : null}
                </>
            }
        >
            {Object.entries(filters.hiddenFields ?? {}).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
            ))}
        </AdminFilterBar>
    );
}

export function sortLinkFor(
    sorts: readonly ViewSortLinkDto[],
    key: string,
): ViewSortLinkDto | undefined {
    return sorts.find((sort) => sort.key === key);
}

export function ViewSortHeader({ sort }: { sort: ViewSortLinkDto }) {
    const ariaSort =
        sort.direction === "asc"
            ? "ascending"
            : sort.direction === "desc"
              ? "descending"
              : "none";

    return (
        <AdminTableHeadCell aria-sort={ariaSort}>
            <a className={styles.sortLink} href={sort.href}>
                <span>{sort.label}</span>
                <span className={styles.sortDirection} aria-hidden="true">
                    {sort.direction === "asc"
                        ? "↑"
                        : sort.direction === "desc"
                          ? "↓"
                          : "↕"}
                </span>
            </a>
        </AdminTableHeadCell>
    );
}

export function ViewPagination({
    pagination,
}: {
    pagination: ViewPaginationDto;
}) {
    return (
        <AdminPagination
            currentPage={pagination.currentPage}
            pageSize={pagination.pageSize}
            totalItems={pagination.totalItems}
            pageSizeOptions={pagination.pageSizeOptions}
        />
    );
}

const metricIcons = {
    accounts: <User />,
    questions: <FileText />,
    activity: <List />,
    completion: <ListCheck />,
    quality: <ListCheck />,
    plans: <TableIcon />,
} satisfies Record<NonNullable<ViewMetricDto["icon"]>, ReactNode>;

export function ViewMetricGrid({
    metrics,
}: {
    metrics: readonly ViewMetricDto[];
}) {
    if (metrics.length === 0) {
        return <AdminNotice tone="muted">無資料</AdminNotice>;
    }

    return (
        <div className={styles.metricGrid}>
            {metrics.map((metric) => (
                <AdminMetricCard
                    key={metric.key}
                    label={metric.label}
                    value={formatMetricValue(metric.value)}
                    detail={
                        metric.detail ??
                        (metric.value.state === "available"
                            ? undefined
                            : metric.value.reason)
                    }
                    icon={metric.icon ? metricIcons[metric.icon] : undefined}
                />
            ))}
        </div>
    );
}

export function ViewSection({
    title,
    description,
    actions,
    children,
}: {
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
}) {
    return (
        <Card>
            <CardHeader className={styles.sectionHeader}>
                <div className={styles.sectionHeading}>
                    <CardTitle asChild>
                        <h2>{title}</h2>
                    </CardTitle>
                    {description ? (
                        <CardDescription>{description}</CardDescription>
                    ) : null}
                </div>
                {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
            </CardHeader>
            <CardContent>{children}</CardContent>
        </Card>
    );
}

export function ViewLoadNotice({ state }: { state: ViewLoadState }) {
    if (state.kind === "loading") {
        return (
            <AdminNotice title="正在載入" tone="info" live="polite">
                {state.message ?? "正在取得最新資料。"}
            </AdminNotice>
        );
    }

    if (state.kind === "error") {
        return (
            <AdminNotice
                title="無法載入資料"
                tone="danger"
                live="assertive"
                actions={
                    <Button asChild appearance="outline" tone="primary">
                        <a href={state.retryHref ?? ""}>
                            {state.retryLabel ?? "重新載入"}
                        </a>
                    </Button>
                }
            >
                {state.message}
            </AdminNotice>
        );
    }

    return null;
}

export function DetailList({
    items,
}: {
    items: readonly { label: string; value: ViewDisplayValue }[];
}) {
    return (
        <dl className={styles.detailList}>
            {items.map((item) => (
                <div className={styles.detailRow} key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>{formatViewValue(item.value)}</dd>
                </div>
            ))}
        </dl>
    );
}

export function ActionPolicyControl({
    title,
    policy,
}: {
    title: string;
    policy: ViewActionPolicyDto;
}) {
    return (
        <div className={styles.policyControl}>
            <div className={styles.policyCopy}>
                <strong>{title}</strong>
                <span>{policy.reason}</span>
            </div>
            {policy.mode === "locked" ? (
                <div className={styles.policyActions}>
                    <Button type="button" disabled appearance="outline" tone="muted">
                        {policy.label}
                    </Button>
                    <PolicyDialog title={title} description={policy.reason} />
                </div>
            ) : (
                <Button asChild appearance="outline" tone="primary">
                    <a href={policy.href}>{policy.label}</a>
                </Button>
            )}
        </div>
    );
}

export function MobileRecordList({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <section className={styles.mobileRecordList} aria-label={label}>
            {children}
        </section>
    );
}

export function MobileRecordCard({
    title,
    subtitle,
    badges,
    fields,
    action,
}: {
    title: ReactNode;
    subtitle?: ReactNode;
    badges?: ReactNode;
    fields: readonly { label: string; value: ReactNode }[];
    action?: ReactNode;
}) {
    return (
        <article className={styles.mobileRecordCard}>
            <header className={styles.mobileRecordHeader}>
                <div className={styles.mobileRecordTitle}>
                    <h2>{title}</h2>
                    {subtitle ? <span>{subtitle}</span> : null}
                </div>
                {badges ? <div className={styles.badgeList}>{badges}</div> : null}
            </header>
            <dl className={styles.mobileRecordFields}>
                {fields.map((field) => (
                    <div key={field.label}>
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                    </div>
                ))}
            </dl>
            {action ? <footer className={styles.mobileRecordAction}>{action}</footer> : null}
        </article>
    );
}

export function MobileListState({
    kind,
    title,
    description,
    action,
}: {
    kind: "loading" | "error" | "empty";
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
}) {
    return (
        <div
            className={styles.mobileListState}
            role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined}
            aria-live={kind === "loading" ? "polite" : undefined}
        >
            <strong>{title}</strong>
            {description ? <p>{description}</p> : null}
            {action ? <div>{action}</div> : null}
        </div>
    );
}
