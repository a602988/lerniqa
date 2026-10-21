/** Shared browser signals for removing account-scoped data after logout or expiry. */
export const AUTH_SESSION_EXPIRED_EVENT = "lerniqa:auth-session-expired";
export const AUTH_SESSION_STORAGE_KEY = "lerniqa:auth-session-event-v1";
export const AUTH_SESSION_CONTEXT_STORAGE_KEY = "lerniqa:auth-context-event-v1";

function writeCrossTabSignal(key: string): void {
    try {
        const nonce = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
        window.localStorage?.setItem(key, `${Date.now()}:${nonce}`);
    }
    catch {
        // Callers still reconcile on focus when storage is unavailable or blocked.
    }
}

export function isAuthSessionExpired(expiresAt: string, now = Date.now()): boolean {
    const expiresAtMillis = new Date(expiresAt).getTime();
    return !Number.isFinite(expiresAtMillis) || expiresAtMillis <= now;
}

export function broadcastAuthSessionExpired(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
    writeCrossTabSignal(AUTH_SESSION_STORAGE_KEY);
}

/**
 * 判斷外部回應是否為可安全讀取欄位的物件。
 * @param value 尚未驗證的外部資料。
 * @returns 可讀取字串鍵值時回傳 true。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 結束目前瀏覽器的伺服器 Session，成功後通知同分頁與其他分頁清除帳號資料。
 * @returns 登出完成後結束；API 拒絕或回應格式錯誤時拋出可顯示的錯誤。
 */
export async function logoutAuthSession(): Promise<void> {
    const response = await fetch("/api/v1/auth/logout", { method: "POST" });
    const payload: unknown = await response.json().catch(() => null);
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error.message : undefined;
    if (!response.ok) {
        const message = typeof error === "string" ? error : `登出失敗（${response.status}）`;
        throw new Error(message);
    }

    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : undefined;
    if (data?.loggedOut !== true) throw new Error("登出服務回應格式不正確，登入狀態未變更。");
    broadcastAuthSessionExpired();
}

/** Tells peer tabs to reload after this tab changes the server-backed role or learner context. */
export function broadcastAuthSessionContextChanged(): void {
    if (typeof window === "undefined") return;
    writeCrossTabSignal(AUTH_SESSION_CONTEXT_STORAGE_KEY);
}

export function isAuthSessionStorageEvent(event: StorageEvent): boolean {
    return event.key === AUTH_SESSION_STORAGE_KEY && event.newValue !== null;
}

export function isAuthSessionContextStorageEvent(event: StorageEvent): boolean {
    return event.key === AUTH_SESSION_CONTEXT_STORAGE_KEY && event.newValue !== null;
}
