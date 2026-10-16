import { legacyFixtureApiGone } from "../_legacy-fixture";

export const runtime = "nodejs";

/** 舊版整份 state 覆寫沒有資料列授權，正式 HTTP surface 永久停用。 */
export async function PUT() {
    return legacyFixtureApiGone();
}
