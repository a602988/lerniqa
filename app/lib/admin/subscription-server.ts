import "server-only";

import { adminMutationReceipts } from "./admin-mutation-receipts.ts";
import { SubscriptionCatalogService } from "./subscription-service.ts";

export const subscriptionCatalogService = new SubscriptionCatalogService({
    idempotency: adminMutationReceipts,
});
