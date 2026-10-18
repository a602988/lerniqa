import { resolveAdminReturnPath } from "./admin-return-path.ts";

// Sharing uses 32 random bytes encoded as unpadded base64url. Only the exact
// invitation route is eligible for returning from authentication.
const LEARNING_BOOK_SHARE_RETURN_PATH = /^\/learning-books\/share\/[A-Za-z0-9_-]{43}$/u;

export function resolveLearningBookShareReturnPath(value: string | null): string | null {
    if (value === null) return null;
    const match = value.match(LEARNING_BOOK_SHARE_RETURN_PATH);
    return match?.[0] === value ? value : null;
}

/** Allow only existing administration routes and one canonical share route. */
export function resolveAccountReturnPath(value: string | null): string | null {
    return resolveLearningBookShareReturnPath(value) ?? resolveAdminReturnPath(value);
}
