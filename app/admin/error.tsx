"use client";

import { Button } from "@keel-design/ui";

import { AdminNotice, AdminPage } from "@/app/components/admin";

export default function AdminError({ reset }: { reset: () => void }) {
    return (
        <AdminPage
            title="目前無法顯示管理資料"
            eyebrow="Administration"
            description="頁面沒有顯示資料庫錯誤、查詢內容或其他內部細節。"
            actions={
                <Button type="button" appearance="solid" tone="primary" onClick={reset}>
                    重新載入
                </Button>
            }
        >
            <AdminNotice title="讀取失敗" tone="danger">
                請稍後再試；若問題持續發生，請使用稽核所需的時間與路徑回報，不要貼上登入 Cookie。
            </AdminNotice>
        </AdminPage>
    );
}
