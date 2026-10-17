import { parseEnableLearnerSubjectInput, parseUpdateLearnerSubjectSettingInput } from "@/app/lib/auth-input";
import { enableLearnerSubject, updateLearnerSubjectSetting } from "@/app/lib/auth-service";
import {
    accountResponse,
    handleAuthError,
    readJsonBody,
    requireSafeCredentialTransport,
} from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
    try {
        requireSafeCredentialTransport(request);
        const input = parseUpdateLearnerSubjectSettingInput(await readJsonBody(request));
        const account = await updateLearnerSubjectSetting(request, input);
        return accountResponse(account);
    }
    catch (error) {
        return handleAuthError(error);
    }
}

export async function POST(request: Request) {
    try {
        requireSafeCredentialTransport(request);
        const input = parseEnableLearnerSubjectInput(await readJsonBody(request));
        const account = await enableLearnerSubject(request, input);
        return accountResponse(account);
    }
    catch (error) {
        return handleAuthError(error);
    }
}
