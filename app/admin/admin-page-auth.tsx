import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache, type ReactNode } from "react";

import { ADMIN_SESSION_COOKIE, requireSystemAdminToken } from "@/app/lib/admin/admin-auth";
import { adminPostgresRunner } from "@/app/lib/admin/admin-server";
import { AdminApiError } from "@/app/lib/admin/admin-types";

import styles from "./admin-route.module.css";

type AdminPageAccess =
    | {
          kind: "authorized";
          actor: Awaited<ReturnType<typeof requireSystemAdminToken>>;
      }
    | { kind: "forbidden" }
    | { kind: "unavailable" };

/**
 * Resolves the admin cookie and server-side role grant once per render request.
 *
 * Every data-bearing admin page calls this before touching its repository. The
 * layout calls the same cached function for presentation, so authorization in
 * a parent layout is never (incorrectly) treated as a sequencing barrier for a
 * concurrently rendered child page.
 */
export const readAdminPageAccess = cache(async (): Promise<AdminPageAccess> => {
    const cookieStore = await cookies();
    const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;

    try {
        const actor = await requireSystemAdminToken(token, adminPostgresRunner);
        return { kind: "authorized", actor };
    }
    catch (error) {
        if (error instanceof AdminApiError) {
            if (error.status === 401) {
                redirect("/account?returnTo=/admin");
            }
            if (error.status === 403) return { kind: "forbidden" };
            return { kind: "unavailable" };
        }
        throw error;
    }
});

export function AdminAccessState({
    kind,
}: {
    kind: Exclude<AdminPageAccess["kind"], "authorized">;
}) {
    const unavailable = kind === "unavailable";

    return (
        <main className={styles.accessPage}>
            <section className={styles.accessCard} aria-live="polite">
                <p className={styles.accessEyebrow}>Lerniqa Administration</p>
                <h1>{unavailable ? "管理後台暫時無法使用" : "無法開啟管理後台"}</h1>
                <p>
                    {unavailable
                        ? "目前無法確認管理員授權，請稍後再試。"
                        : "這個登入帳號沒有系統管理員權限。"}
                </p>
                <a className={styles.accessLink} href="/account">
                    返回帳號頁
                </a>
            </section>
        </main>
    );
}
export function AuthorizedAdminContent({
    access,
    children,
}: {
    access: AdminPageAccess;
    children: ReactNode;
}) {
    return access.kind === "authorized" ? children : null;
}
