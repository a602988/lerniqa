"use client";

import { Button } from "@keel-design/ui";
import { useState } from "react";
import { useAppRouter } from "../../navigation-feedback";

interface QuestionRelationReviewActionsProps {
    kind: "template" | "keyword";
    targetId: string;
    revisionId?: string;
}

export function QuestionRelationReviewActions({
    kind,
    targetId,
    revisionId,
}: QuestionRelationReviewActionsProps) {
    const router = useAppRouter();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    async function submit(decision: "approve" | "reject") {
        const reason = decision === "reject"
            ? window.prompt("請填寫退回原因；這段內容會保留在稽核證據中。")
            : null;
        if (decision === "reject" && !reason?.trim()) return;
        setBusy(true);
        setMessage(null);
        try {
            const query = revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : "";
            const response = await fetch(`/api/v1/admin/question-relations/${kind}/${targetId}${query}`, {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    "Idempotency-Key": crypto.randomUUID(),
                    "X-Lerniqa-CSRF": "same-origin",
                },
                body: JSON.stringify({ decision, reason }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(payload?.error?.message ?? "審核操作未完成。");
            }
            router.refresh();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "審核操作未完成。");
        }
        finally {
            setBusy(false);
        }
    }

    return (
        <div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <Button size="sm" disabled={busy} onClick={() => submit("approve")}>核准</Button>
                <Button size="sm" appearance="outline" tone="danger" disabled={busy} onClick={() => submit("reject")}>退回</Button>
            </div>
            {message ? <p role="alert">{message}</p> : null}
        </div>
    );
}
