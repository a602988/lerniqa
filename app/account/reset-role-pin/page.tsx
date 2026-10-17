"use client";

import { Button } from "@keel-design/ui";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

import { validateNewRolePin } from "../../lib/auth-input";
import { broadcastAuthSessionContextChanged } from "../../lib/auth-session-client";
import { credentialTransportAllowed, readApiError, takeFragmentToken } from "../recovery/recovery-client";
import { RecoveryShell, RecoveryStatus, recoveryStyles as styles } from "../recovery/recovery-shell";

type AdultRole = "parent" | "tutor";

const ROLE_LABELS: Readonly<Record<AdultRole, string>> = {
    parent: "家長",
    tutor: "家教",
};

export default function ResetRolePinPage() {
    const started = useRef(false);
    const [token, setToken] = useState<string | null>(null);
    const [newPin, setNewPin] = useState("");
    const [confirmPin, setConfirmPin] = useState("");
    const [ready, setReady] = useState(false);
    const [transportAllowed, setTransportAllowed] = useState<boolean | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [completedRole, setCompletedRole] = useState<AdultRole | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        setTransportAllowed(credentialTransportAllowed());
        setToken(takeFragmentToken("/account/reset-role-pin"));
        setReady(true);
    }, []);

    function updatePin(value: string, setter: (next: string) => void) {
        setter(value.replace(/\D/gu, "").slice(0, 6));
        setError("");
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!token || !transportAllowed || submitting) return;
        setSubmitting(true);
        setError("");
        try {
            const validatedPin = validateNewRolePin(newPin);
            if (validatedPin !== confirmPin) throw new Error("兩次輸入的角色 PIN 不一致。");
            const response = await fetch("/api/v1/auth/role-pin-reset/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, newPin: validatedPin }),
            });
            if (!response.ok) throw await readApiError(response, "目前無法設定角色 PIN，請重新申請連結。");
            const payload = await response.json() as {
                data?: { targetRole?: unknown };
            };
            const targetRole = payload.data?.targetRole;
            if (targetRole !== "parent" && targetRole !== "tutor") {
                throw new Error("伺服器未回傳已設定的角色，請重新整理帳號中心確認狀態。");
            }
            // Each tab revalidates its own role-scoped session; unrelated-role
            // sessions remain usable while target-role sessions expire.
            broadcastAuthSessionContextChanged();
            setNewPin("");
            setConfirmPin("");
            setCompletedRole(targetRole);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : "目前無法設定角色 PIN。");
        }
        finally {
            setSubmitting(false);
        }
    }

    return (
        <RecoveryShell
            description="輸入新的六位數 PIN。完成後，使用該角色的既有工作階段會被撤銷；角色切換仍使用帳號密碼。"
            eyebrow="角色 PIN"
            icon={ShieldCheck}
            title="設定新的角色 PIN"
        >
            {!ready ? (
                <p className={styles.loading} role="status">正在安全地讀取設定連結…</p>
            ) : transportAllowed === false ? (
                <RecoveryStatus tone="error">這個網址不是安全連線，因此不接受新 PIN。請改用 HTTPS 或 localhost 開啟設定連結。</RecoveryStatus>
            ) : completedRole ? (
                <div className={styles.content}>
                    <RecoveryStatus tone="success">{ROLE_LABELS[completedRole]} PIN 已設定，{ROLE_LABELS[completedRole]}角色的既有工作階段已撤銷。PIN 目前不會取代切換角色時的帳號密碼。</RecoveryStatus>
                    <Button asChild><Link href="/account">返回帳號中心</Link></Button>
                </div>
            ) : !token ? (
                <div className={styles.content}>
                    <RecoveryStatus tone="error">設定連結缺少必要資訊，可能已失效。請登入帳號後重新提出要求。</RecoveryStatus>
                    <Button asChild appearance="outline"><Link href="/account/forgot-role-pin"><ArrowLeft aria-hidden="true" />重新申請連結</Link></Button>
                </div>
            ) : (
                <form className={styles.form} onSubmit={(event) => void submit(event)}>
                    <label className={styles.field} htmlFor="new-role-pin">
                        新的六位數 PIN
                        <input
                            aria-describedby="role-pin-hint"
                            autoComplete="new-password"
                            className={styles.pinInput}
                            id="new-role-pin"
                            inputMode="numeric"
                            maxLength={6}
                            minLength={6}
                            onChange={(event) => updatePin(event.target.value, setNewPin)}
                            pattern="[0-9]{6}"
                            required
                            type="password"
                            value={newPin}
                        />
                        <small id="role-pin-hint">請避開 123456、654321 或六個相同數字；系統不會顯示既有 PIN。</small>
                    </label>
                    <label className={styles.field} htmlFor="confirm-role-pin">
                        再輸入一次 PIN
                        <input
                            autoComplete="new-password"
                            className={styles.pinInput}
                            id="confirm-role-pin"
                            inputMode="numeric"
                            maxLength={6}
                            minLength={6}
                            onChange={(event) => updatePin(event.target.value, setConfirmPin)}
                            pattern="[0-9]{6}"
                            required
                            type="password"
                            value={confirmPin}
                        />
                    </label>
                    {error && <RecoveryStatus tone="error">{error}</RecoveryStatus>}
                    <Button disabled={submitting} type="submit"><ShieldCheck aria-hidden="true" />{submitting ? "正在設定…" : "設定角色 PIN"}</Button>
                </form>
            )}
        </RecoveryShell>
    );
}
