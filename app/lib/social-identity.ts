import "server-only";

import { normalizeAccountEmail } from "./auth-input";
import { AuthServiceError, type RedirectIdentityProvider } from "./auth-service";

export interface VerifiedSocialIdentity {
    subject: string;
    email: string;
    displayName: string;
}

interface SocialOAuthConfig {
    clientId: string;
    clientSecret: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredEnvironment(name: string, providerName: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new AuthServiceError(
            "SOCIAL_QUICK_REGISTRATION_UNAVAILABLE",
            `${providerName} 登入暫時無法使用，請稍後再試。`,
            503,
        );
    }
    return value;
}

function socialOAuthConfig(provider: RedirectIdentityProvider): SocialOAuthConfig {
    if (provider === "line") {
        return {
            clientId: requiredEnvironment("LINE_CHANNEL_ID", "LINE"),
            clientSecret: requiredEnvironment("LINE_CHANNEL_SECRET", "LINE"),
        };
    }
    return {
        clientId: requiredEnvironment("FACEBOOK_APP_ID", "Facebook"),
        clientSecret: requiredEnvironment("FACEBOOK_APP_SECRET", "Facebook"),
    };
}

function normalizedDisplayName(value: unknown, providerName: string): string {
    if (typeof value !== "string") {
        throw new AuthServiceError("SOCIAL_PROFILE_INVALID", `${providerName} 沒有回傳可用的顯示名稱。`, 401);
    }
    const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name)) {
        throw new AuthServiceError("SOCIAL_PROFILE_INVALID", `${providerName} 顯示名稱格式不正確。`, 401);
    }
    return name;
}

function normalizedSubject(value: unknown, providerName: string): string {
    if (typeof value !== "string" || !value || value.length > 255) {
        throw new AuthServiceError("SOCIAL_PROFILE_INVALID", `${providerName} 身份資料不完整。`, 401);
    }
    return value;
}

async function readJson(response: Response, providerName: string): Promise<Record<string, unknown>> {
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(value)) {
        throw new AuthServiceError("SOCIAL_PROVIDER_FAILED", `${providerName} 驗證失敗，請重新操作。`, 401);
    }
    return value;
}

export function socialCallbackUrl(request: Request, provider: RedirectIdentityProvider): string {
    const origin = new URL(request.url).origin;
    return `${origin}/api/v1/auth/social/${provider}/callback`;
}

export function socialAuthorizationUrl(
    request: Request,
    provider: RedirectIdentityProvider,
    state: string,
    nonce: string | null,
): string {
    const config = socialOAuthConfig(provider);
    const redirectUri = socialCallbackUrl(request, provider);
    if (provider === "line") {
        const url = new URL("https://access.line.me/oauth2/v2.1/authorize");
        url.search = new URLSearchParams({
            response_type: "code",
            client_id: config.clientId,
            redirect_uri: redirectUri,
            state,
            scope: "openid profile email",
            nonce: nonce!,
        }).toString();
        return url.toString();
    }
    const url = new URL("https://www.facebook.com/dialog/oauth");
    url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        state,
        scope: "public_profile,email",
        response_type: "code",
    }).toString();
    return url.toString();
}

async function verifyLineAuthorization(
    request: Request,
    code: string,
    nonce: string,
): Promise<VerifiedSocialIdentity> {
    const config = socialOAuthConfig("line");
    const tokenResponse = await fetch("https://api.line.me/oauth2/v2.1/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: socialCallbackUrl(request, "line"),
            client_id: config.clientId,
            client_secret: config.clientSecret,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
    });
    const token = await readJson(tokenResponse, "LINE");
    if (typeof token.id_token !== "string" || token.id_token.length > 16_384) {
        throw new AuthServiceError("SOCIAL_PROVIDER_FAILED", "LINE 驗證資料不完整。", 401);
    }
    const verifyResponse = await fetch("https://api.line.me/oauth2/v2.1/verify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            id_token: token.id_token,
            client_id: config.clientId,
            nonce,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
    });
    const profile = await readJson(verifyResponse, "LINE");
    if (profile.iss !== "https://access.line.me" || profile.aud !== config.clientId || profile.nonce !== nonce) {
        throw new AuthServiceError("SOCIAL_PROFILE_INVALID", "LINE 身份驗證不一致，請重新操作。", 401);
    }
    return {
        subject: normalizedSubject(profile.sub, "LINE"),
        email: normalizeAccountEmail(profile.email),
        displayName: normalizedDisplayName(profile.name, "LINE"),
    };
}

async function verifyFacebookAuthorization(
    request: Request,
    code: string,
): Promise<VerifiedSocialIdentity> {
    const config = socialOAuthConfig("facebook");
    const tokenResponse = await fetch("https://graph.facebook.com/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: socialCallbackUrl(request, "facebook"),
            code,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
    });
    const token = await readJson(tokenResponse, "Facebook");
    if (typeof token.access_token !== "string" || token.access_token.length > 4096) {
        throw new AuthServiceError("SOCIAL_PROVIDER_FAILED", "Facebook 驗證資料不完整。", 401);
    }

    const debugUrl = new URL("https://graph.facebook.com/debug_token");
    debugUrl.searchParams.set("input_token", token.access_token);
    const debugResponse = await fetch(debugUrl, {
        headers: { Authorization: `Bearer ${config.clientId}|${config.clientSecret}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
    });
    const debug = await readJson(debugResponse, "Facebook");
    const debugData = debug.data;
    if (!isRecord(debugData)) {
        throw new AuthServiceError("SOCIAL_PROFILE_INVALID", "Facebook 身份驗證資料不完整。", 401);
    }
    const debugRecord = debugData;
    if (debugRecord.is_valid !== true || debugRecord.app_id !== config.clientId) {
        throw new AuthServiceError("SOCIAL_PROFILE_INVALID", "Facebook 身份驗證不一致，請重新操作。", 401);
    }

    const profileUrl = new URL("https://graph.facebook.com/me");
    profileUrl.searchParams.set("fields", "id,name,email");
    const profileResponse = await fetch(profileUrl, {
        headers: { Authorization: `Bearer ${token.access_token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
    });
    const profile = await readJson(profileResponse, "Facebook");
    if (profile.id !== debugRecord.user_id) {
        throw new AuthServiceError("SOCIAL_PROFILE_INVALID", "Facebook 身份驗證不一致，請重新操作。", 401);
    }
    return {
        subject: normalizedSubject(profile.id, "Facebook"),
        email: normalizeAccountEmail(profile.email),
        displayName: normalizedDisplayName(profile.name, "Facebook"),
    };
}

export async function verifySocialAuthorization(
    request: Request,
    provider: RedirectIdentityProvider,
    code: string,
    nonce: string | null,
): Promise<VerifiedSocialIdentity> {
    if (!code || code.length > 4096) {
        throw new AuthServiceError("SOCIAL_OAUTH_INVALID", "快速註冊授權碼無效。", 401);
    }
    if (provider === "line") {
        if (!nonce) throw new AuthServiceError("SOCIAL_OAUTH_INVALID", "LINE 驗證狀態無效。", 401);
        return verifyLineAuthorization(request, code, nonce);
    }
    return verifyFacebookAuthorization(request, code);
}
