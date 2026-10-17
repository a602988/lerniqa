const RETURN_ORIGIN = "https://lerniqa.invalid";

/**
 * Limits account-page redirects to the admin route tree so a login link cannot
 * be turned into an open redirect or used to skip ordinary navigation rules.
 *
 * @param value Raw `returnTo` query value.
 * @returns A normalized admin path, or `null` when the value is not allowed.
 */
export function resolveAdminReturnPath(value: string | null): string | null {
    if (value === null || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
        return null;
    }

    try {
        const url = new URL(value, RETURN_ORIGIN);
        const isAdminPath = url.pathname === "/admin" || url.pathname.startsWith("/admin/");

        if (url.origin !== RETURN_ORIGIN || !isAdminPath) return null;

        return `${url.pathname}${url.search}${url.hash}`;
    }
    catch {
        return null;
    }
}
