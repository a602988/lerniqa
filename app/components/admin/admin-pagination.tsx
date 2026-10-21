"use client";

import {
    Pagination,
    type PaginationLabels,
    type PaginationProps,
} from "@keel-design/ui";
import { usePathname, useSearchParams } from "next/navigation";
import { useAppRouter } from "../navigation-feedback";

import styles from "./admin-components.module.css";

type SafePaginationLabels = Omit<PaginationLabels, "range">;

export type AdminPaginationProps = Omit<
    PaginationProps,
    "labels" | "onPageChange" | "onPageSizeChange"
> & {
    labels?: SafePaginationLabels;
    pageParam?: string;
    pageSizeParam?: string;
    historyMode?: "push" | "replace";
    onPageChange?: (page: number) => void;
    onPageSizeChange?: (pageSize: number) => void;
};

/** Keel pagination wired to URL query parameters by default. */
export function AdminPagination({
    labels,
    pageParam = "page",
    pageSizeParam = "perPage",
    historyMode = "push",
    onPageChange,
    onPageSizeChange,
    className,
    ...props
}: AdminPaginationProps) {
    const pathname = usePathname();
    const router = useAppRouter();
    const searchParams = useSearchParams();

    function updateUrl(updates: Record<string, string>) {
        const params = new URLSearchParams(searchParams.toString());

        Object.entries(updates).forEach(([key, value]) => {
            params.set(key, value);
        });

        const query = params.toString();
        const href = query ? `${pathname}?${query}` : pathname;
        router[historyMode](href, { scroll: false });
    }

    function handlePageChange(page: number) {
        if (onPageChange) {
            onPageChange(page);
            return;
        }

        updateUrl({ [pageParam]: String(page) });
    }

    function handlePageSizeChange(pageSize: number) {
        if (onPageSizeChange) {
            onPageSizeChange(pageSize);
            return;
        }

        updateUrl({ [pageParam]: "1", [pageSizeParam]: String(pageSize) });
    }

    const resolvedLabels: PaginationLabels = {
        navigation: "分頁導覽",
        first: "第一頁",
        previous: "上一頁",
        next: "下一頁",
        last: "最後一頁",
        pageSize: "每頁筆數",
        range: (from, to, total) =>
            total === 0 ? "目前沒有資料" : `第 ${from}–${to} 筆，共 ${total} 筆`,
        ...labels,
    };

    return (
        <Pagination
            className={[styles.pagination, className].filter(Boolean).join(" ")}
            labels={resolvedLabels}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            {...props}
        />
    );
}
