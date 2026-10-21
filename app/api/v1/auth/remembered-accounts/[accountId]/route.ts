import { NextResponse } from "next/server";
import {
    AuthServiceError,
    removeRememberedAccount,
    switchRememberedAccount,
} from "@/app/lib/auth-service";
import { authenticatedResponse, handleAuthError, requireSafeCredentialTransport } from "../../_shared";

export const runtime = "nodejs";

function requireAccountId(value: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
        throw new AuthServiceError("INVALID_REMEMBERED_ACCOUNT", "帳號識別資料格式不正確。", 400);
    }
    return value;
}

export async function POST(request: Request, context: { params: Promise<{ accountId: string }> }) {
    try {
        requireSafeCredentialTransport(request);
        const accountId = requireAccountId((await context.params).accountId);
        const issued = await switchRememberedAccount(request, accountId);
        return await authenticatedResponse(request, issued.account, issued.token);
    }
    catch (error) {
        return handleAuthError(error);
    }
}

export async function DELETE(request: Request, context: { params: Promise<{ accountId: string }> }) {
    try {
        requireSafeCredentialTransport(request);
        const accountId = requireAccountId((await context.params).accountId);
        await removeRememberedAccount(request, accountId);
        return NextResponse.json(
            { data: { removed: true } },
            { headers: { "Cache-Control": "no-store" } },
        );
    }
    catch (error) {
        return handleAuthError(error);
    }
}
