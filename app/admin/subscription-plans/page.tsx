import { SubscriptionPlansView } from "@/app/components/admin/views";
import { buildSubscriptionPlansViewModel } from "@/app/lib/admin/admin-view-model";

import { readAdminPageAccess } from "../admin-page-auth";

export default async function AdminSubscriptionPlansPage() {
    const access = await readAdminPageAccess();
    if (access.kind !== "authorized") return null;

    return <SubscriptionPlansView {...buildSubscriptionPlansViewModel()} />;
}
