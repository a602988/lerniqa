"use client";

import { Button } from "@keel-design/ui";
import { ArrowLeft, Mail, Send } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { credentialTransportAllowed } from "../recovery/recovery-client";
import { RecoveryShell, RecoveryStatus, recoveryStyles as styles } from "../recovery/recovery-shell";

const GENERIC_ACCEPTED_MESSAGE = "如果此電子郵件已註冊，我們會寄出一封一次性重設連結。請檢查收件匣與垃圾郵件匣。";

export default function ForgotPasswordPage() {
    const [submitting, setSubmitting] = useState(false);
    const [accepted, setAccepted] = useState(false);
    const [transportAllowed, setTransportAllowed] = useState<boolean | null>(null);
    const [error, setError] = useState("");

    useEffect(() => setTransportAllowed(credentialTransportAllowed()), []);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting || !transportAllowed) return;
        setSubmitting(true);
        setError("");
        try {
            const form = new FormData(event.currentTarget);
            const response = await fetch("/api/v1/auth/password-reset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: form.get("email") }),
            });
            if (!response.ok) throw new Error("目前無法受理密碼重設要求，請稍後再試。");
            setAccepted(true);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : "目前無法受理密碼重設要求，請稍後再試。");
        }
        finally {
            setSubmitting(false);
        }
    }

    return (
        <RecoveryShell
            description="輸入註冊時使用的電子郵件。為保護帳號資訊，不論信箱是否存在，頁面都會顯示相同結果。"
            eyebrow="忘記密碼"
            icon={Mail}
            title="取得密碼重設連結"
        >
            {transportAllowed === false ? (
                <RecoveryStatus tone="error">這個網址不是安全連線，因此不接受帳號資料。請改用 HTTPS 或在執行 Lerniqa 的電腦使用 localhost。</RecoveryStatus>
            ) : accepted ? (
                <div className={styles.content}>
                    <RecoveryStatus tone="success">{GENERIC_ACCEPTED_MESSAGE}</RecoveryStatus>
                    <p className={styles.note}>連結有時效且只能使用一次。若沒有收到信，請稍候再試，並確認輸入的是註冊信箱。</p>
                    <Button asChild appearance="outline"><Link href="/account"><ArrowLeft aria-hidden="true" />返回登入</Link></Button>
                </div>
            ) : (
                <form className={styles.form} onSubmit={(event) => void submit(event)}>
                    <label className={styles.field} htmlFor="recovery-email">
                        電子郵件
                        <input
                            autoCapitalize="none"
                            autoComplete="email"
                            id="recovery-email"
                            inputMode="email"
                            maxLength={320}
                            name="email"
                            placeholder="name@example.com"
                            required
                            spellCheck={false}
                            type="email"
                        />
                    </label>
                    {error && <RecoveryStatus tone="error">{error}</RecoveryStatus>}
                    <Button disabled={submitting || transportAllowed !== true} type="submit">
                        <Send aria-hidden="true" />{submitting ? "正在送出…" : "寄送重設連結"}
                    </Button>
                    <Link className={styles.textLink} href="/account"><ArrowLeft aria-hidden="true" />返回登入</Link>
                </form>
            )}
        </RecoveryShell>
    );
}
