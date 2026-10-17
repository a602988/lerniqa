import { NextResponse } from "next/server";

import { requestRolePinReset } from "@/app/lib/account-recovery";
import { localPostgresAccountRecoveryRepository } from "@/app/lib/account-recovery-repository";
import { parseRolePinResetRequestInput } from "@/app/lib/auth-input";
import { getAuthenticatedAccount } from "@/app/lib/auth-service";
import { createConfiguredMailAdapter } from "@/app/lib/mail/server";
import {
    handleAuthError,
    readJsonBody,
    requireSafeCredentialTransport,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    try {
        requireSafeCredentialTransport(request);
        const input = parseRolePinResetRequestInput(await readJsonBody(request));
        // Managed learner mode is intentionally allowed: ownership and the
        // requested adult-role grant are revalidated inside the transaction.
        const account = await getAuthenticatedAccount(request);
        const adapter = createConfiguredMailAdapter();
        const result = await requestRolePinReset(
            localPostgresAccountRecoveryRepository,
            adapter,
            {
                userId: account.userId,
                targetRole: input.targetRole,
                request,
            },
        );
        return NextResponse.json(
            { data: result },
            { status: 202, headers: { "Cache-Control": "no-store" } },
        );
    }
    catch (error) {
        return handleAuthError(error);
    }
}
