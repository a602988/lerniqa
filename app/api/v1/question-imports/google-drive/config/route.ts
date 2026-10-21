import { NextResponse } from "next/server";
import { AuthServiceError, getAuthenticatedAccount } from "@/app/lib/auth-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    try {
        await getAuthenticatedAccount(request);
        const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
        const apiKey = process.env.GOOGLE_DRIVE_PICKER_API_KEY?.trim() ?? "";
        const appId = process.env.GOOGLE_DRIVE_APP_ID?.trim() ?? "";
        return NextResponse.json({
            data: {
                enabled: Boolean(clientId && apiKey && appId),
                clientId,
                apiKey,
                appId,
            },
        }, { headers: { "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        if (error instanceof AuthServiceError) {
            return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
        }
        return NextResponse.json({ error: { code: "GOOGLE_DRIVE_CONFIG_FAILED", message: "無法讀取 Google 雲端硬碟設定。" } }, { status: 500 });
    }
}
