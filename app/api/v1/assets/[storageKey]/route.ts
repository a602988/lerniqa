import { legacyFixtureApiGone } from "../../_legacy-fixture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 儲存鍵本身不是授權；正式圖片只由可反查題目與學習者權限的 asset API 提供。 */
export async function GET() {
    return legacyFixtureApiGone();
}
