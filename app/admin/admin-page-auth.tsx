import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache, type ReactNode } from "react";

import {
    ADMIN_SESSION_COOKIE,
    type AdminQueryRunner,
    requireSystemAdminToken,
} from "@/app/lib/admin/admin-auth";
import {
    recordAdminServerFailure,
    resolveAdminRequestId,
} from "@/app/lib/admin/admin-observability";
import { adminPostgresRunner } from "@/app/lib/admin/admin-server";
import { AdminApiError } from "@/app/lib/admin/admin-types";

import styles from "./admin-route.module.css";

type AdminPageAccess =
    | {
          kind: "authorized";
          actor: Awaited<ReturnType<typeof requireSystemAdminToken>>;
      }
    | { kind: "forbidden" }
    | { kind: "unavailable"; requestId?: string };

function unavailableAdminPage(error: unknown): Extract<AdminPageAccess, { kind: "unavailable" }> {
    const classified = error instanceof AdminApiError;
    const status = classified && error.status >= 500 && error.status <= 599
        ? error.status
        : 500;
    const requestId = resolveAdminRequestId(classified ? error.requestId : null);

    recordAdminServerFailure({
        scope: "admin_page_auth",
        requestId,
        status,
        failureKind: classified ? "classified" : "unhandled",
        errorCode: classified ? error.code : "UNHANDLED_ERROR",
        error,
    });

    return { kind: "unavailable", requestId };
}

/**
 * Resolves the admin cookie and server-side role grant once per render request.
 *
 * Every data-bearing admin page calls this before touching its repository. The
 * layout calls the same cached function for presentation, so authorization in
 * a parent layout is never (incorrectly) treated as a sequencing barrier for a
 * concurrently rendered child page.
 */
async function resolveAdminPageAccess(
    runner: AdminQueryRunner,
): Promise<AdminPageAccess> {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
        const actor = await requireSystemAdminToken(token, runner);
        return { kind: "authorized", actor };
    }
    catch (error) {
        if (error instanceof AdminApiError) {
            if (error.status === 401) {
                redirect("/account?returnTo=/admin");
            }
            if (error.status === 403) return { kind: "forbidden" };
            if (error.status >= 500) return unavailableAdminPage(error);
            return { kind: "unavailable" };
        }
        return unavailableAdminPage(error);
    }
}

export const readAdminPageAccess = cache(
    async (): Promise<AdminPageAccess> => resolveAdminPageAccess(adminPostgresRunner),
);

/** Re-authorizes a data-bearing page on its transaction-scoped runner. */
export async function readAdminPageAccessInSnapshot(
    runner: AdminQueryRunner,
): Promise<AdminPageAccess> {
    return resolveAdminPageAccess(runner);
}

export function AdminAccessState({
    kind,
    requestId,
}: {
    kind: Exclude<AdminPageAccess["kind"], "authorized">;
    requestId?: string;
}) {
    const unavailable = kind === "unavailable";

    return (
        <main className={styles.accessPage}>
            <section className={styles.accessCard}>
                <p className={styles.accessEyebrow}>Lerniqa Administration</p>
                <h1>{unavailable ? "管理後台暫時無法使用" : "無法開啟管理後台"}</h1>
                <p>
                    {unavailable
                        ? "目前無法確認管理員授權，請稍後再試。"
                        : "這個登入帳號沒有系統管理員權限。"}
                </p>
                {unavailable && requestId ? (
                    <p>參考編號：<code>{requestId}</code></p>
                ) : null}
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
