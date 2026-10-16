"use client";

import { Button } from "@keel-design/ui";
import { ArrowLeft, CheckCircle2, CircleAlert, LoaderCircle, MailCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { LerniqaMark } from "../../components/lerniqa-mark";
import { broadcastAuthSessionContextChanged } from "../../lib/auth-session-client";
import styles from "./verify-email.module.css";

type VerificationState = "working" | "success" | "error";

interface ConfirmationResponse {
    data: {
        status: "verified" | "already_verified";
        account: { displayName: string; emailVerified: boolean | null } | null;
    };
    error?: { message?: string };
}

export default function VerifyEmailPage() {
    const started = useRef(false);
    const [state, setState] = useState<VerificationState>("working");
    const [message, setMessage] = useState("正在安全地確認驗證連結…");

    useEffect(() => {
        if (started.current) return;
        started.current = true;

        const parameters = new URLSearchParams(window.location.hash.slice(1));
        const token = parameters.get("token");
        window.history.replaceState(null, "", "/account/verify-email");
        if (!token) {
            setState("error");
            setMessage("驗證連結缺少必要資訊，請回到帳號中心重新寄送。");
            return;
        }

        void fetch("/api/v1/auth/email-verification/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
        })
            .then(async (response) => {
                const result = await response.json().catch(() => ({})) as ConfirmationResponse;
                if (!response.ok) {
                    throw new Error(result.error?.message || `驗證失敗（${response.status}）`);
                }
                broadcastAuthSessionContextChanged();
                setState("success");
                setMessage(result.data.account
                    ? `${result.data.account.displayName}，你的信箱已完成驗證。`
                    : "信箱已完成驗證；登入後即可在帳號中心看到更新狀態。");
            })
            .catch((error) => {
                setState("error");
                setMessage(error instanceof Error ? error.message : "目前無法完成信箱驗證。");
            });
    }, []);

    return (
        <main className={styles.page}>
            <section className={styles.card} aria-live="polite">
                <Link className={styles.brand} href="/account" aria-label="返回 Lerniqa 帳號中心">
                    <span><LerniqaMark /></span><strong>Lerniqa</strong>
                </Link>
                <div className={styles.icon} data-state={state}>
                    {state === "working" && <LoaderCircle aria-hidden="true" />}
                    {state === "success" && <CheckCircle2 aria-hidden="true" />}
                    {state === "error" && <CircleAlert aria-hidden="true" />}
                </div>
                <div className={styles.copy}>
                    <span><MailCheck aria-hidden="true" />信箱驗證</span>
                    <h1>{state === "working" ? "正在確認" : state === "success" ? "驗證完成" : "無法驗證"}</h1>
                    <p>{message}</p>
                </div>
                <Button asChild appearance={state === "success" ? "solid" : "outline"}>
                    <Link href="/account"><ArrowLeft aria-hidden="true" />返回帳號中心</Link>
                </Button>
            </section>
        </main>
    );
}
