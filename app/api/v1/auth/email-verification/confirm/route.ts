import { NextResponse } from "next/server";

import {
    AuthServiceError,
    getAuthenticatedAccount,
} from "@/app/lib/auth-service";
import { confirmEmailVerification } from "@/app/lib/email-verification";
import { localPostgresEmailVerificationRepository } from "@/app/lib/email-verification-repository";
import {
    handleAuthError,
    publicAccount,
    readJsonBody,
    requireSafeCredentialTransport,
} from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenFromBody(value: unknown): unknown {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).token
        : undefined;
}

export async function POST(request: Request) {
    try {
        requireSafeCredentialTransport(request);
        const result = await confirmEmailVerification(
            localPostgresEmailVerificationRepository,
            tokenFromBody(await readJsonBody(request)),
        );

        let account = null;
        try {
            const authenticated = await getAuthenticatedAccount(request);
            if (authenticated.userId === result.userId) {
                account = publicAccount(authenticated);
            }
        }
        catch (error) {
            if (!(error instanceof AuthServiceError) || error.status !== 401) throw error;
        }

        return NextResponse.json(
            { data: { status: result.status, account } },
            { headers: { "Cache-Control": "no-store" } },
        );
    }
    catch (error) {
        return handleAuthError(error);
    }
}
