import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminShell } from "@/app/components/admin";

import { AdminAccessState, readAdminPageAccess } from "./admin-page-auth";

export const metadata: Metadata = {
    title: "Lerniqa 管理後台",
    robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
    const access = await readAdminPageAccess();

    if (access.kind !== "authorized") {
        return (
            <AdminAccessState
                kind={access.kind}
                requestId={access.kind === "unavailable" ? access.requestId : undefined}
            />
        );
    }

    return (
        <AdminShell sidebarFooter="已通過伺服器端管理員授權">
            {children}
        </AdminShell>
    );
}
