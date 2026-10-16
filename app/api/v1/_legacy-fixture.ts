import { NextResponse } from "next/server";

/**
 * The runtime JSON store predates authenticated PostgreSQL resources. It cannot
 * enforce account or learner isolation, so its HTTP surface stays closed even
 * in local development. Isolated tests read their synthetic fixtures directly.
 */
export function legacyFixtureApiGone() {
    return NextResponse.json(
        {
            error: {
                code: "LEGACY_FIXTURE_API_DISABLED",
                message: "舊版測試資料 API 已停用，請使用登入後的正式資源 API。",
            },
        },
        { status: 410, headers: { "Cache-Control": "private, no-store" } },
    );
}
