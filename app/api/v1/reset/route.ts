import { legacyFixtureApiGone } from "../_legacy-fixture";

export const runtime = "nodejs";

/** 重設只可由隔離測試程序直接操作 fixture，不提供 HTTP 清除入口。 */
export async function POST() {
    return legacyFixtureApiGone();
}
