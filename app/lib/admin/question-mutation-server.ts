import "server-only";

import { adminMutationReceipts } from "./admin-mutation-receipts.ts";
import { QuestionMutationService } from "./question-mutation-service.ts";

/** Production question writes require the PostgreSQL receipt ledger. */
export const questionMutationService = new QuestionMutationService({
    idempotency: adminMutationReceipts,
});
