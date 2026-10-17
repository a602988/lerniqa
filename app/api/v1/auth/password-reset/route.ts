import { NextResponse } from "next/server";

import { requestPasswordReset } from "@/app/lib/account-recovery";
import { localPostgresAccountRecoveryRepository } from "@/app/lib/account-recovery-repository";
import { parsePasswordResetRequestInput } from "@/app/lib/auth-input";
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
        const input = parsePasswordResetRequestInput(await readJsonBody(request));
        // Validate configuration before the repository sees the address so a
        // missing local secret has identical behavior for every account.
        const adapter = createConfiguredMailAdapter();
        const result = await requestPasswordReset(
            localPostgresAccountRecoveryRepository,
            adapter,
            { email: input.email, request },
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
