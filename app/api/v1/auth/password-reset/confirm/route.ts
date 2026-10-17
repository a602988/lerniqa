import { NextResponse } from "next/server";

import { confirmPasswordReset } from "@/app/lib/account-recovery";
import { localPostgresAccountRecoveryRepository } from "@/app/lib/account-recovery-repository";
import { parsePasswordResetConfirmInput } from "@/app/lib/auth-input";
import {
    AuthServiceError,
    getAuthenticatedAccount,
    sessionTokenFromRequest,
} from "@/app/lib/auth-service";
import {
    clearSessionCookie,
    handleAuthError,
    readJsonBody,
    requireSafeCredentialTransport,
} from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    try {
        requireSafeCredentialTransport(request);
        const input = parsePasswordResetConfirmInput(await readJsonBody(request));
        let currentUserId: string | null = null;
        if (sessionTokenFromRequest(request)) {
            try {
                currentUserId = (await getAuthenticatedAccount(request)).userId;
            }
            catch (error) {
                // A stale browser cookie does not invalidate the one-time email
                // challenge. Other database failures still fail closed.
                if (!(error instanceof AuthServiceError && error.code === "AUTH_REQUIRED")) {
                    throw error;
                }
            }
        }
        const result = await confirmPasswordReset(
            localPostgresAccountRecoveryRepository,
            input,
        );
        const response = NextResponse.json(
            { data: { status: result.status } },
            { headers: { "Cache-Control": "no-store" } },
        );
        // Every target-account session was revoked transactionally. Preserve a
        // valid cookie that belongs to a different account sharing this browser.
        if (currentUserId === result.affectedUserId) clearSessionCookie(request, response);
        return response;
    }
    catch (error) {
        return handleAuthError(error);
    }
}
