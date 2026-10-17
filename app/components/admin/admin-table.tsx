import { AlertCircle, TableOff } from "@keel-design/icons";
import {
    DataTable,
    DataTableActionCell,
    DataTableBody,
    DataTableCell,
    DataTableFooter,
    DataTableHeadCell,
    DataTableHeader,
    DataTableRow,
    DataTableStateRow,
    DataTableTableFooter,
    DataTableToolbar,
    DataTableTopBar,
    DataTableViewport,
    Button,
    Spinner,
    type DataTableProps,
} from "@keel-design/ui";
import type { CSSProperties, ReactNode } from "react";

import styles from "./admin-components.module.css";

export type AdminTableFrameProps = Omit<DataTableProps, "children" | "layout"> & {
    children: ReactNode;
    toolbar?: ReactNode;
    footer?: ReactNode;
    minWidth?: number | string;
    tableClassName?: string;
};

/**
 * Keel DataTable frame with a horizontally scrollable viewport.
 * Pass table rows and sections as children; query and sorting state stay with the page.
 */
export function AdminTableFrame({
    children,
    toolbar,
    footer,
    minWidth = 760,
    tableClassName,
    className,
    style,
    ...props
}: AdminTableFrameProps) {
    const resolvedMinWidth =
        typeof minWidth === "number" ? `${minWidth}px` : minWidth;
    const tableStyle = {
        ...style,
        "--keel-data-table-min-width": resolvedMinWidth,
    } as CSSProperties;

    return (
        <DataTable
            className={[styles.tableFrame, className].filter(Boolean).join(" ")}
            layout="composed"
            style={tableStyle}
            {...props}
        >
            {toolbar ? <DataTableToolbar>{toolbar}</DataTableToolbar> : null}
            <DataTableViewport tableClassName={tableClassName}>
                {children}
            </DataTableViewport>
            {footer ? <DataTableFooter>{footer}</DataTableFooter> : null}
        </DataTable>
    );
}

type AdminTableStateProps = {
    colSpan: number;
    title?: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
};

export type AdminTableErrorStateProps = AdminTableStateProps & {
    /**
     * Full-page retry destination. Defaults to the current URL; set to `null`
     * when retry is not appropriate. A custom `action` replaces this control.
     */
    retryHref?: string | null;
    retryLabel?: ReactNode;
};

function AdminTableStateContent({
    title,
    description,
    action,
    kind,
}: Omit<AdminTableStateProps, "colSpan"> & {
    kind: "empty" | "error" | "loading";
}) {
    return (
        <div
            className={styles.tableState}
            aria-live={
                kind === "error" ? "assertive" : kind === "loading" ? "polite" : undefined
            }
            role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined}
        >
            {kind === "loading" ? (
                <Spinner className={styles.tableStateSpinner} />
            ) : kind === "error" ? (
                <AlertCircle
                    className={`${styles.tableStateIcon} ${styles.tableStateErrorIcon}`}
                    aria-hidden="true"
                />
            ) : (
                <TableOff className={styles.tableStateIcon} aria-hidden="true" />
            )}
            <p className={styles.tableStateTitle}>{title}</p>
            {description ? (
                <p className={styles.tableStateDescription}>{description}</p>
            ) : null}
            {action ? <div className={styles.tableStateAction}>{action}</div> : null}
        </div>
    );
}

export function AdminTableEmptyState({
    colSpan,
    title = "目前沒有資料",
    description,
    action,
}: AdminTableStateProps) {
    return (
        <DataTableStateRow colSpan={colSpan} live="off">
            <AdminTableStateContent
                title={title}
                description={description}
                action={action}
                kind="empty"
            />
        </DataTableStateRow>
    );
}

export function AdminTableErrorState({
    colSpan,
    title = "無法載入資料",
    description = "請稍後再試；若問題持續發生，請保留目前的篩選條件並聯絡維護人員。",
    action,
    retryHref = "",
    retryLabel = "重新載入",
}: AdminTableErrorStateProps) {
    const resolvedAction =
        action ??
        (retryHref !== null ? (
            <Button asChild appearance="outline" size="sm" tone="primary">
                <a href={retryHref}>{retryLabel}</a>
            </Button>
        ) : undefined);

    return (
        <DataTableStateRow colSpan={colSpan} live="off">
            <AdminTableStateContent
                title={title}
                description={description}
                action={resolvedAction}
                kind="error"
            />
        </DataTableStateRow>
    );
}

export function AdminTableLoadingState({
    colSpan,
    title = "正在載入資料",
    description,
}: Omit<AdminTableStateProps, "action">) {
    return (
        <DataTableStateRow colSpan={colSpan} live="off">
            <AdminTableStateContent
                title={title}
                description={description}
                kind="loading"
            />
        </DataTableStateRow>
    );
}

export {
    DataTableActionCell as AdminTableActionCell,
    DataTableBody as AdminTableBody,
    DataTableCell as AdminTableCell,
    DataTableFooter as AdminTableFooter,
    DataTableHeadCell as AdminTableHeadCell,
    DataTableHeader as AdminTableHeader,
    DataTableRow as AdminTableRow,
    DataTableTableFooter as AdminTableSummaryFooter,
    DataTableToolbar as AdminTableToolbar,
    DataTableTopBar as AdminTableTopBar,
};
