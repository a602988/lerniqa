import { legacyFixtureApiGone } from "../_legacy-fixture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 完整 JSON 題目含答案且無帳號隔離；正式查詢改走授權後的 local-practice API。 */
export async function GET() {
    return legacyFixtureApiGone();
}
