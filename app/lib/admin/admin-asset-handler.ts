import {
    adminErrorResponse,
    handleAdminHttpError,
} from "./admin-http.ts";
import { parseUuid } from "./admin-input.ts";
import type { AdminQueryRunner } from "./admin-auth.ts";
import {
    type AdminQuestionAssetFile,
    type AdminQuestionAssetRecord,
} from "./admin-asset-repository.ts";
import { AdminApiError } from "./admin-types.ts";

export interface AdminAssetGetDependencies {
    withSnapshot<T>(
        operation: (runner: AdminQueryRunner) => Promise<T>,
    ): Promise<T>;
    authorize(
        request: Request,
        runner: AdminQueryRunner,
    ): Promise<unknown>;
    findAsset(
        runner: AdminQueryRunner,
        assetId: string,
    ): Promise<AdminQuestionAssetRecord | null>;
    readAsset(asset: AdminQuestionAssetRecord): Promise<AdminQuestionAssetFile | null>;
}

export interface AdminAssetRouteContext {
    params: Promise<{ assetId: string }>;
}

const ASSET_RESPONSE_HEADERS = {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
} as const;

function addAssetSecurityHeaders(response: Response): Response {
    for (const [name, value] of Object.entries(ASSET_RESPONSE_HEADERS)) {
        response.headers.set(name, value);
    }
    return response;
}

function notFound(): AdminApiError {
    return new AdminApiError(
        "NOT_FOUND",
        "找不到指定的題目資產。",
        404,
    );
}

function assetFileResponse(
    assetId: string,
    file: AdminQuestionAssetFile,
): Response {
    const body = file.bytes.buffer.slice(
        file.bytes.byteOffset,
        file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer;
    const safeFileName = `question-asset-${assetId}.${file.extension}`;

    return new Response(body, {
        status: 200,
        headers: {
            ...ASSET_RESPONSE_HEADERS,
            "Content-Disposition": `inline; filename="${safeFileName}"`,
            "Content-Length": String(file.bytes.byteLength),
            "Content-Type": file.mimeType,
        },
    });
}

/**
 * Builds a route handler with explicit dependencies so authorization order and
 * failure paths can be verified without starting PostgreSQL or a Next server.
 */
export function createAdminAssetGetHandler(
    dependencies: AdminAssetGetDependencies,
): (
    request: Request,
    context: AdminAssetRouteContext,
) => Promise<Response> {
    return async function adminAssetGet(
        request: Request,
        context: AdminAssetRouteContext,
    ): Promise<Response> {
        try {
            // Authorization, route input parsing and the asset metadata lookup
            // share one repeatable-read snapshot. File I/O starts only after
            // that snapshot has committed so a slow disk read never keeps a
            // database transaction open.
            const { assetId, asset } = await dependencies.withSnapshot(
                async (runner) => {
                    await dependencies.authorize(request, runner);
                    const { assetId: rawAssetId } = await context.params;
                    const assetId = parseUuid(rawAssetId, "題目資產識別碼");
                    const asset = await dependencies.findAsset(runner, assetId);
                    if (!asset) throw notFound();
                    return { assetId, asset };
                },
            );

            const file = await dependencies.readAsset(asset);
            if (!file) throw notFound();
            return assetFileResponse(assetId, file);
        }
        catch (error) {
            const response = error instanceof AdminApiError
                ? adminErrorResponse(error)
                : handleAdminHttpError(error);
            return addAssetSecurityHeaders(response);
        }
    };
}
