import {
    parseCreateAccountLearnerInput,
    parseUpdateAccountLearnerInput,
} from "@/app/lib/auth-input";
import {
    createAccountLearner,
    updateAccountLearner,
} from "@/app/lib/auth-service";
import {
    accountResponse,
    handleAuthError,
    readJsonBody,
    requireSafeCredentialTransport,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    try {
        requireSafeCredentialTransport(request);
        const input = parseCreateAccountLearnerInput(await readJsonBody(request));
        const account = await createAccountLearner(request, input);
        return accountResponse(account, 201);
    }
    catch (error) {
        return handleAuthError(error);
    }
}

export async function PATCH(request: Request) {
    try {
        requireSafeCredentialTransport(request);
        const input = parseUpdateAccountLearnerInput(await readJsonBody(request));
        const account = await updateAccountLearner(request, input);
        return accountResponse(account);
    }
    catch (error) {
        return handleAuthError(error);
    }
}
