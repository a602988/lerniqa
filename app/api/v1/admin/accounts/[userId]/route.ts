import { NextResponse } from "next/server";

import { getAccountDetail } from "@/app/lib/admin/account-repository";
import { loadAdminAccountDetailRequest } from "@/app/lib/admin/admin-account-handler";
import { adminDataResponse, handleAdminHttpError } from "@/app/lib/admin/admin-http";
import {
    requireAdminReadContext,
    withAdminReadOnlySnapshot,
} from "@/app/lib/admin/admin-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AccountRouteContext {
    params: Promise<{ userId: string }>;
}

export async function GET(
    request: Request,
    context: AccountRouteContext,
): Promise<NextResponse> {
    try {
        const { account } = await loadAdminAccountDetailRequest(
            request,
            () => context.params,
            {
                withSnapshot: withAdminReadOnlySnapshot,
                authorize: requireAdminReadContext,
                load: getAccountDetail,
            },
        );

        return adminDataResponse({ account });
    }
    catch (error) {
        return handleAdminHttpError(error);
    }
}
