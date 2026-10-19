import "server-only";

import { OAuth2Client } from "google-auth-library";
import { normalizeAccountEmail } from "./auth-input";
import { AuthServiceError } from "./auth-service";

export interface VerifiedGoogleIdentity {
    subject: string;
    email: string;
    displayName: string;
}

export function googleOAuthClientId(): string {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
    if (!clientId) {
        throw new AuthServiceError(
            "GOOGLE_QUICK_REGISTRATION_UNAVAILABLE",
            "Google 快速註冊尚未完成設定。",
            503,
        );
    }
    return clientId;
}

export async function verifyGoogleCredential(credential: string): Promise<VerifiedGoogleIdentity> {
    if (!credential || credential.length > 16_384) {
        throw new AuthServiceError(
            "GOOGLE_CREDENTIAL_INVALID",
            "Google 驗證資料無效，請重新選擇帳號。",
            401,
        );
    }

    try {
        const clientId = googleOAuthClientId();
        const ticket = await new OAuth2Client().verifyIdToken({
            idToken: credential,
            audience: clientId,
        });
        const payload = ticket.getPayload();
        const subject = payload?.sub;
        const displayName = payload?.name?.normalize("NFKC").trim().replace(/\s+/gu, " ");
        if (
            !subject
            || subject.length > 255
            || payload?.email_verified !== true
            || !displayName
            || displayName.length > 80
        ) {
            throw new Error("Required Google identity claims are missing");
        }
        return {
            subject,
            email: normalizeAccountEmail(payload.email),
            displayName,
        };
    }
    catch (error) {
        if (error instanceof AuthServiceError) throw error;
        throw new AuthServiceError(
            "GOOGLE_CREDENTIAL_INVALID",
            "Google 驗證失敗，請重新選擇帳號。",
            401,
        );
    }
}
