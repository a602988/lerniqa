export function credentialTransportAllowed(): boolean {
    return window.location.protocol === "https:"
        || ["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname);
}

export async function readApiError(response: Response, fallback: string): Promise<Error> {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    return new Error(body.error?.message || fallback);
}

export function takeFragmentToken(replacementPath: string): string | null {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", replacementPath);
    return token;
}
