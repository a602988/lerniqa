import { legacyFixtureApiGone } from "../_legacy-fixture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 舊匯入端點信任瀏覽器提供的 owner／learner，完成正式授權管線前不接受寫入。 */
export async function POST() {
    return legacyFixtureApiGone();
}
