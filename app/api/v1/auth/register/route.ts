import { parseRegisterAccountInput } from "@/app/lib/auth-input";
import { registerAccount } from "@/app/lib/auth-service";
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
        const input = parseRegisterAccountInput(await readJsonBody(request));
        const issued = await registerAccount(input);
        return authenticatedResponse(request, issued.account, issued.token, 201);
    }
    catch (error) {
        return handleAuthError(error);
    }
}
