"use client";

import {
    FileText,
    Home,
    ListCheck,
    Lock,
    Table as TableIcon,
    User,
    type IconComponent,
} from "@keel-design/icons";
import { AppShell } from "@keel-design/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { LerniqaMark } from "@/app/components/lerniqa-mark";

import styles from "./admin-components.module.css";

export type AdminNavigationItem = {
    href: string;
    label: string;
    icon?: IconComponent;
    /** Only match the exact path. `/admin` is exact by default. */
    exact?: boolean;
};

export const DEFAULT_ADMIN_NAVIGATION: readonly AdminNavigationItem[] = [
    { href: "/admin", label: "總覽", icon: Home, exact: true },
    { href: "/admin/accounts", label: "帳號", icon: User },
    { href: "/admin/questions", label: "題庫", icon: FileText, exact: true },
    { href: "/admin/questions/relations", label: "題型關係", icon: ListCheck },
    { href: "/admin/subscription-plans", label: "訂閱方案", icon: TableIcon },
    { href: "/admin/reports", label: "管理報表", icon: ListCheck },
    { href: "/admin/audit", label: "稽核紀錄", icon: Lock },
];

export type AdminShellProps = {
    children: ReactNode;
    navigation?: readonly AdminNavigationItem[];
    sidebarFooter?: ReactNode;
    brandLabel?: string;
};

function isNavigationItemActive(pathname: string, item: AdminNavigationItem) {
    const exact = item.exact ?? item.href === "/admin";

    return exact
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function AdminNavigation({
    items,
    pathname,
}: {
    items: readonly AdminNavigationItem[];
    pathname: string;
}) {
    return (
        <AppShell.Nav className={styles.nav} aria-label="後台主要導覽">
            {items.map((item) => {
                const Icon = item.icon;

                return (
                    <AppShell.NavItem
                        key={item.href}
                        className={styles.navItem}
                        href={item.href}
                        current={isNavigationItemActive(pathname, item)}
                        icon={
                            Icon ? (
                                <Icon className={styles.navIcon} aria-hidden="true" />
                            ) : undefined
                        }
                    >
                        {item.label}
                    </AppShell.NavItem>
                );
            })}
        </AppShell.Nav>
    );
}

/**
 * Thin, route-aware configuration of Keel AppShell for every `/admin` page.
 *
 * Authorization stays in the server layout. Keel owns the responsive sidebar
 * and its native mobile details navigation; this component supplies only the
 * Lerniqa brand, current route, and footer content.
 */
export function AdminShell({
    children,
    navigation = DEFAULT_ADMIN_NAVIGATION,
    sidebarFooter = "僅限授權管理員使用",
    brandLabel = "Lerniqa 管理後台",
}: AdminShellProps) {
    const pathname = usePathname();
    const sidebar = (
        <div className={styles.sidebarContent}>
            <Link className={styles.brandLink} href="/admin">
                <LerniqaMark className={styles.brandMark} />
                <span className={styles.brandCopy}>
                    <span className={styles.brandName}>Lerniqa</span>
                    <span className={styles.brandContext}>管理後台</span>
                </span>
            </Link>

            <AdminNavigation items={navigation} pathname={pathname} />

            {sidebarFooter ? (
                <div className={styles.sidebarFooter}>{sidebarFooter}</div>
            ) : null}
        </div>
    );

    return (
        <>
            <a className={styles.skipLink} href="#admin-main-content">
                跳到主要內容
            </a>
            <AppShell
                className={styles.shell}
                contentClassName={styles.main}
                mobileNavigationLabel={brandLabel}
                position="sticky"
                sidebar={sidebar}
            >
                <div
                    className={styles.contentTarget}
                    id="admin-main-content"
                    tabIndex={-1}
                >
                    {children}
                </div>
            </AppShell>
        </>
    );
}
