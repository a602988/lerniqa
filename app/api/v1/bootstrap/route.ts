import { legacyFixtureApiGone } from "../_legacy-fixture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 舊版整包 fixture 會跨帳號暴露資料，正式 HTTP surface 永久停用。 */
export async function GET() {
    return legacyFixtureApiGone();
}
