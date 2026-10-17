import { NextResponse } from "next/server";

import { confirmRolePinReset } from "@/app/lib/account-recovery";
import { localPostgresAccountRecoveryRepository } from "@/app/lib/account-recovery-repository";
import { parseRolePinResetConfirmInput } from "@/app/lib/auth-input";
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
        const input = parseRolePinResetConfirmInput(await readJsonBody(request));
        let currentSession: Readonly<{
            userId: string;
            activeRole: "parent" | "learner" | "tutor";
        }> | null = null;
        if (sessionTokenFromRequest(request)) {
            try {
                const account = await getAuthenticatedAccount(request);
                currentSession = {
                    userId: account.userId,
                    activeRole: account.activeRole,
                };
            }
            catch (error) {
                // An expired cookie does not invalidate the one-time email
                // challenge. Other database failures still fail closed.
                if (!(error instanceof AuthServiceError && error.code === "AUTH_REQUIRED")) {
                    throw error;
                }
            }
        }
        const result = await confirmRolePinReset(
            localPostgresAccountRecoveryRepository,
            input,
        );
        const response = NextResponse.json(
            {
                data: {
                    status: result.status,
                    targetRole: result.targetRole,
                },
            },
            { headers: { "Cache-Control": "no-store" } },
        );
        // Preserve an unrelated-role browser session. The transaction revokes
        // every server-side session for the target role, so only a cookie that
        // represented that role needs to be removed here.
        if (
            currentSession?.userId === result.affectedUserId
            && currentSession.activeRole === result.targetRole
        ) clearSessionCookie(request, response);
        return response;
    }
    catch (error) {
        return handleAuthError(error);
    }
}
