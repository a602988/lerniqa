import type { HTMLAttributes, ReactNode } from "react";

import styles from "./admin-components.module.css";

export type AdminPageHeaderProps = {
    title: ReactNode;
    description?: ReactNode;
    eyebrow?: ReactNode;
    actions?: ReactNode;
    titleId?: string;
};

/** Shared title and action row for admin pages. */
export function AdminPageHeader({
    title,
    description,
    eyebrow,
    actions,
    titleId = "admin-page-title",
}: AdminPageHeaderProps) {
    return (
        <header className={styles.pageHeader}>
            <div className={styles.pageHeading}>
                {eyebrow ? <p className={styles.pageEyebrow}>{eyebrow}</p> : null}
                <h1 className={styles.pageTitle} id={titleId}>
                    {title}
                </h1>
                {description ? (
                    <p className={styles.pageDescription}>{description}</p>
                ) : null}
            </div>
            {actions ? <div className={styles.pageActions}>{actions}</div> : null}
        </header>
    );
}

export type AdminPageProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> &
    AdminPageHeaderProps & {
        children: ReactNode;
        /** Accessible level-two heading that groups the page's sections. */
        contentHeading?: ReactNode;
        contentHeadingId?: string;
    };

/** Page scaffold that keeps headings, actions, and content responsive. */
export function AdminPage({
    title,
    description,
    eyebrow,
    actions,
    titleId = "admin-page-title",
    contentHeading,
    contentHeadingId = `${titleId}-content`,
    children,
    className,
    ...props
}: AdminPageProps) {
    return (
        <div
            className={[styles.page, className].filter(Boolean).join(" ")}
            aria-labelledby={titleId}
            {...props}
        >
            <AdminPageHeader
                title={title}
                description={description}
                eyebrow={eyebrow}
                actions={actions}
                titleId={titleId}
            />
            <section
                className={styles.pageContent}
                aria-labelledby={contentHeadingId}
            >
                <h2 className={styles.visuallyHidden} id={contentHeadingId}>
                    {contentHeading ?? <>{title}內容</>}
                </h2>
                {children}
            </section>
        </div>
    );
}
