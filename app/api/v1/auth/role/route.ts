import { parseSwitchAccountRoleInput } from "@/app/lib/auth-input";
import { switchAccountRole } from "@/app/lib/auth-service";
import {
    accountResponse,
    handleAuthError,
    readJsonBody,
    requireSafeCredentialTransport,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
    try {
        requireSafeCredentialTransport(request);
        const input = parseSwitchAccountRoleInput(await readJsonBody(request));
        const account = await switchAccountRole(request, input);
        return accountResponse(account);
    }
    catch (error) {
        return handleAuthError(error);
    }
}
