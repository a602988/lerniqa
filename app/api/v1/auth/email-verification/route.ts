import { NextResponse } from "next/server";

import {
    AuthServiceError,
    getAuthenticatedAccount,
} from "@/app/lib/auth-service";
import { requestEmailVerification } from "@/app/lib/email-verification";
import { localPostgresEmailVerificationRepository } from "@/app/lib/email-verification-repository";
import { createConfiguredMailAdapter } from "@/app/lib/mail/server";
import { handleAuthError, requireSafeCredentialTransport } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    try {
        requireSafeCredentialTransport(request);
        const account = await getAuthenticatedAccount(request);
        if (
            account.activeRole === "learner"
            && (account.accountRole === "parent" || account.accountRole === "tutor")
        ) {
            throw new AuthServiceError(
                "ACCOUNT_SETTINGS_FORBIDDEN",
                "受管理學習者模式不可操作帳號信箱；請先切回帳號身份。",
                403,
            );
        }
        // Validate SMTP configuration before issuing a challenge. A missing
        // local secret must not create an unusable token or start the cooldown.
        const adapter = createConfiguredMailAdapter();
        const result = await requestEmailVerification(
            localPostgresEmailVerificationRepository,
            adapter,
            { userId: account.userId, request },
        );
        return NextResponse.json(
            { data: result },
            { headers: { "Cache-Control": "no-store" } },
        );
    }
    catch (error) {
        return handleAuthError(error);
    }
}
