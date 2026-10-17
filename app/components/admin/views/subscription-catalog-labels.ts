const CATALOG_STATUS_LABELS: Readonly<Record<string, string>> = {
    draft: "草稿",
    active: "啟用",
    retired: "已停用",
};

const BILLING_INTERVAL_LABELS: Readonly<Record<string, string>> = {
    day: "日",
    week: "週",
    month: "月",
    year: "年",
};

export function subscriptionCatalogStatusLabel(status: string): string {
    return CATALOG_STATUS_LABELS[status] ?? status;
}

export function subscriptionBillingIntervalLabel(interval: string): string {
    return BILLING_INTERVAL_LABELS[interval] ?? interval;
}
