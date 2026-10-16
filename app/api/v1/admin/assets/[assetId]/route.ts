import { createAdminAssetGetHandler } from "@/app/lib/admin/admin-asset-handler";
import {
    findAdminQuestionAsset,
    readAdminQuestionAssetFile,
} from "@/app/lib/admin/admin-asset-repository";
import { requireAdminReadContext } from "@/app/lib/admin/admin-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getAdminAsset = createAdminAssetGetHandler({
    requireReadContext: requireAdminReadContext,
    findAsset: findAdminQuestionAsset,
    readAsset: readAdminQuestionAssetFile,
});

export async function GET(
    request: Request,
    context: { params: Promise<{ assetId: string }> },
): Promise<Response> {
    return getAdminAsset(request, context);
}
