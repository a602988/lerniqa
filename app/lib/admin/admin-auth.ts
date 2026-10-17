import type { QueryResultRow } from "pg";

import { hashSessionToken } from "../auth-crypto.ts";
import { AdminApiError } from "./admin-types.ts";

export interface AdminQueryResult<Row extends QueryResultRow> {
    rows: Row[];
    rowCount?: number | null;
}

/**
 * Deliberately smaller than pg.PoolClient so repositories can be tested with a
 * deterministic in-memory runner. Production callers can adapt either a pool
 * or a transaction client without giving the repository access to connection
 * lifecycle methods.
 */
export interface AdminQueryRunner {
    query<Row extends QueryResultRow>(
        text: string,
        values?: readonly unknown[],
    ): Promise<AdminQueryResult<Row>>;
}

export interface SystemAdminActor {
    sessionId: string;
    userId: string;
    displayName: string;
    expiresAt: string;
}

interface SystemAdminSessionRow extends QueryResultRow {
    session_id: string;
    user_id: string;
    display_name: string;
    expires_at: Date | string;
    is_system_admin: boolean;
}

export const ADMIN_SESSION_COOKIE = "lerniqa_session";

export const SYSTEM_ADMIN_SESSION_SQL = `
    SELECT
        session.id AS session_id,
        session.user_id,
        app_user.display_name,
        session.expires_at,
        EXISTS (
            SELECT 1
            FROM user_roles AS admin_role
            WHERE admin_role.user_id = session.user_id
                AND admin_role.role = 'system_admin'
                AND admin_role.revoked_at IS NULL
        ) AS is_system_admin
    FROM auth_sessions AS session
    JOIN users AS app_user
        ON app_user.id = session.user_id
        AND app_user.status = 'active'
    WHERE session.token_hash = $1
        AND session.revoked_at IS NULL
        AND session.expires_at > transaction_timestamp()
        AND lerniqa_auth_session_is_valid(
            session.user_id,
            session.active_role,
            session.active_learner_id
        )
    LIMIT 1
`;

function toIso(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new AdminApiError("INTERNAL_ERROR", "管理員登入資料格式不正確。", 500);
    }
    return date.toISOString();
}

export function readAdminSessionToken(request: Request): string | null {
    const cookieHeader = request.headers.get("cookie");
    if (!cookieHeader) return null;

    for (const item of cookieHeader.split(";")) {
        const separator = item.indexOf("=");
        if (separator < 0) continue;
        const name = item.slice(0, separator).trim();
        if (name !== ADMIN_SESSION_COOKIE) continue;
        const token = item.slice(separator + 1).trim();
        return /^[A-Za-z0-9_-]{43}$/u.test(token) ? token : null;
    }

    return null;
}

export async function requireSystemAdminToken(
    token: string | null,
    runner: AdminQueryRunner,
): Promise<SystemAdminActor> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
        throw new AdminApiError("UNAUTHENTICATED", "請先登入後台。", 401);
    }

    const tokenHash = hashSessionToken(token);
    const result = await runner.query<SystemAdminSessionRow>(
        SYSTEM_ADMIN_SESSION_SQL,
        [tokenHash],
    );
    const session = result.rows[0];

    if (!session) {
        throw new AdminApiError("UNAUTHENTICATED", "管理員登入狀態已失效。", 401);
    }
    if (!session.is_system_admin) {
        throw new AdminApiError("FORBIDDEN", "這個帳號沒有管理後台權限。", 403);
    }

    return {
        sessionId: session.session_id,
        userId: session.user_id,
        displayName: session.display_name,
        expiresAt: toIso(session.expires_at),
    };
}

export async function requireSystemAdmin(
    request: Request,
    runner: AdminQueryRunner,
): Promise<SystemAdminActor> {
    return requireSystemAdminToken(readAdminSessionToken(request), runner);
}
