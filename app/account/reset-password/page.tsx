"use client";

import { Button } from "@keel-design/ui";
import { ArrowLeft, KeyRound, LogIn } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

import {
    ACCOUNT_PASSWORD_HINT,
    ACCOUNT_PASSWORD_MAX_LENGTH,
    ACCOUNT_PASSWORD_MIN_LENGTH,
    validateNewAccountPassword,
} from "../../lib/auth-input";
import { broadcastAuthSessionExpired } from "../../lib/auth-session-client";
import { credentialTransportAllowed, readApiError, takeFragmentToken } from "../recovery/recovery-client";
import { RecoveryShell, RecoveryStatus, recoveryStyles as styles } from "../recovery/recovery-shell";

export default function ResetPasswordPage() {
    const started = useRef(false);
    const [token, setToken] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [complete, setComplete] = useState(false);
    const [transportAllowed, setTransportAllowed] = useState<boolean | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        setTransportAllowed(credentialTransportAllowed());
        setToken(takeFragmentToken("/account/reset-password"));
        setReady(true);
    }, []);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!token || !transportAllowed || submitting) return;
        setSubmitting(true);
        setError("");
        try {
            const form = new FormData(event.currentTarget);
            const newPassword = validateNewAccountPassword(form.get("newPassword"));
            if (newPassword !== form.get("confirmPassword")) {
                throw new Error("兩次輸入的密碼不一致。");
            }
            const response = await fetch("/api/v1/auth/password-reset/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, newPassword }),
            });
            if (!response.ok) throw await readApiError(response, "目前無法重設密碼，請重新申請連結。");
            broadcastAuthSessionExpired();
            setComplete(true);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : "目前無法重設密碼。");
        }
        finally {
            setSubmitting(false);
        }
    }

    return (
        <RecoveryShell
            description="設定一組只有你知道的新密碼。完成後，帳號的所有既有登入工作階段都會撤銷。"
            eyebrow="密碼重設"
            icon={KeyRound}
            title="設定新密碼"
        >
            {!ready ? (
                <p className={styles.loading} role="status">正在安全地讀取重設連結…</p>
            ) : transportAllowed === false ? (
                <RecoveryStatus tone="error">這個網址不是安全連線，因此不接受新密碼。請改用 HTTPS 或 localhost 開啟重設連結。</RecoveryStatus>
            ) : complete ? (
                <div className={styles.content}>
                    <RecoveryStatus tone="success">密碼已更新，所有既有登入工作階段都已撤銷。請使用新密碼重新登入。</RecoveryStatus>
                    <Button asChild><Link href="/account"><LogIn aria-hidden="true" />返回登入</Link></Button>
                </div>
            ) : !token ? (
                <div className={styles.content}>
                    <RecoveryStatus tone="error">重設連結缺少必要資訊，可能已失效。請重新提出密碼重設要求。</RecoveryStatus>
                    <Button asChild appearance="outline"><Link href="/account/forgot-password"><ArrowLeft aria-hidden="true" />重新申請連結</Link></Button>
                </div>
            ) : (
                <form className={styles.form} onSubmit={(event) => void submit(event)}>
                    <label className={styles.field} htmlFor="new-password">
                        新密碼
                        <input
                            aria-describedby="new-password-hint"
                            autoComplete="new-password"
                            id="new-password"
                            maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                            minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                            name="newPassword"
                            required
                            type="password"
                        />
                        <small id="new-password-hint">{ACCOUNT_PASSWORD_HINT}</small>
                    </label>
                    <label className={styles.field} htmlFor="confirm-password">
                        再輸入一次新密碼
                        <input
                            autoComplete="new-password"
                            id="confirm-password"
                            maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                            minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                            name="confirmPassword"
                            required
                            type="password"
                        />
                    </label>
                    {error && <RecoveryStatus tone="error">{error}</RecoveryStatus>}
                    <Button disabled={submitting} type="submit"><KeyRound aria-hidden="true" />{submitting ? "正在更新…" : "更新密碼"}</Button>
                </form>
            )}
        </RecoveryShell>
    );
}
