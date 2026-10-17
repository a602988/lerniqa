import { AdminNotice, AdminPage } from "@/app/components/admin";

export default function AdminLoading() {
    return (
        <AdminPage
            title="正在載入管理資料"
            eyebrow="Administration"
            description="正在確認授權並讀取最新資料。"
        >
            <AdminNotice title="請稍候" tone="info">
                管理資料只會在伺服器確認系統管理員權限後載入。
            </AdminNotice>
        </AdminPage>
    );
}
