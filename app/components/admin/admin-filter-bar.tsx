import type { ComponentPropsWithoutRef, ReactNode } from "react";

import styles from "./admin-components.module.css";

export type AdminFilterBarProps = Omit<
    ComponentPropsWithoutRef<"form">,
    "children"
> & {
    search?: ReactNode;
    filters?: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
};

/**
 * Responsive filter form. Controls are supplied by each page so their names and
 * URL contract remain explicit.
 */
export function AdminFilterBar({
    search,
    filters,
    actions,
    children,
    className,
    "aria-label": ariaLabel = "篩選資料",
    ...props
}: AdminFilterBarProps) {
    return (
        <form
            className={[styles.filterBar, className].filter(Boolean).join(" ")}
            aria-label={ariaLabel}
            {...props}
        >
            {search ? <div className={styles.filterSearch}>{search}</div> : null}
            {filters || children ? (
                <div className={styles.filterFields}>
                    {filters}
                    {children}
                </div>
            ) : null}
            {actions ? <div className={styles.filterActions}>{actions}</div> : null}
        </form>
    );
}
