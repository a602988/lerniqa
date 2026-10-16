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
