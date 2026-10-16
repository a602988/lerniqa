import { parseLoginAccountInput } from "@/app/lib/auth-input";
import { loginAccount } from "@/app/lib/auth-service";
import {
    authenticatedResponse,
    handleAuthError,
    readJsonBody,
    requireSafeCredentialTransport,
} from "../_shared";

export const runtime = "nodejs";

export async function POST(request: Request) {
    try {
        requireSafeCredentialTransport(request);
        const input = parseLoginAccountInput(await readJsonBody(request));
        const issued = await loginAccount(input);
        return authenticatedResponse(request, issued.account, issued.token);
    }
    catch (error) {
        return handleAuthError(error);
    }
}
