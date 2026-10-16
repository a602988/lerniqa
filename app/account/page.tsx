"use client";

import { Badge, Button } from "@keel-design/ui";
import { ArrowRight, BookOpenCheck, CheckCircle2, LockKeyhole, LogIn, LogOut, ShieldCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { LerniqaMark } from "../components/lerniqa-mark";
import styles from "./account.module.css";

type AccountRole = "parent" | "learner" | "tutor";
type AccountMode = "login" | "register";

interface AccountRecord {
    displayName: string;
    email: string;
    emailVerified: boolean;
    activeRole: AccountRole;
    learner: {
        id: string;
        displayName: string;
        gradeCode: string | null;
        gradeName: string | null;
    };
    expiresAt: string;
}

interface AccountResponse {
    data: { account: AccountRecord };
}

const ROLE_LABELS: Record<AccountRole, string> = {
    parent: "家長",
    learner: "學習者本人",
    tutor: "一對一家教",
};

async function readApi<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => ({})) as T & {
        error?: { message?: string };
    };
    if (!response.ok) throw new Error(body.error?.message || `要求失敗（${response.status}）`);
    return body;
}

function credentialTransportAllowed(): boolean {
    return window.location.protocol === "https:"
        || ["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname);
}

export default function AccountPage() {
    const [account, setAccount] = useState<AccountRecord | null>(null);
    const [mode, setMode] = useState<AccountMode>("login");
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState("");
    const [transportAllowed, setTransportAllowed] = useState<boolean | null>(null);

    useEffect(() => {
        setTransportAllowed(credentialTransportAllowed());
        void fetch("/api/v1/auth/me", { cache: "no-store" })
            .then(async (response) => {
                if (response.status === 401) return null;
                return readApi<AccountResponse>(response);
            })
            .then((result) => setAccount(result?.data.account ?? null))
            .catch((error) => setMessage(error instanceof Error ? error.message : "無法讀取帳號狀態。"))
            .finally(() => setLoading(false));
    }, []);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!transportAllowed) return;
        setSubmitting(true);
        setMessage("");
        const form = new FormData(event.currentTarget);
        const payload = mode === "login"
            ? {
                email: form.get("email"),
                password: form.get("password"),
            }
            : {
                displayName: form.get("displayName"),
                learnerName: form.get("learnerName"),
                email: form.get("email"),
                password: form.get("password"),
                role: form.get("role"),
            };
        try {
            const response = await fetch(`/api/v1/auth/${mode}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const result = await readApi<AccountResponse>(response);
            setAccount(result.data.account);
            setMessage(mode === "register" ? "帳號已建立，學習者資料也已連結。" : "登入成功。" );
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "帳號服務目前無法完成要求。" );
        }
        finally {
            setSubmitting(false);
        }
    }

    async function logout() {
        setSubmitting(true);
        setMessage("");
        try {
            const response = await fetch("/api/v1/auth/logout", { method: "POST" });
            await readApi<{ data: { loggedOut: boolean } }>(response);
            setAccount(null);
            setMode("login");
            setMessage("已安全登出。" );
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "目前無法登出。" );
        }
        finally {
            setSubmitting(false);
        }
    }

    return (
        <main className={styles.page}>
            <header className={styles.topbar}>
                <Link className={styles.brand} href="/overview" aria-label="返回 Lerniqa 首頁">
                    <span className={styles.brandMark}><LerniqaMark /></span>
                    <span><strong>Lerniqa</strong><small>學習帳號</small></span>
                </Link>
                <Link className={styles.practiceLink} href="/local-practice">前往第四課練習<ArrowRight aria-hidden="true" /></Link>
            </header>

            <section className={styles.shell}>
                <div className={styles.intro}>
                    <span className={styles.kicker}><ShieldCheck aria-hidden="true" />每位學習者，各自保存</span>
                    <h1>把練習進度留在自己的帳號裡</h1>
                    <p>登入後，選題、作答、錯題與最近紀錄都會依學習者分開保存。帳號密碼只以安全雜湊存入資料庫。</p>
                    <div className={styles.promiseGrid}>
                        <div><LockKeyhole aria-hidden="true" /><span><strong>密碼不留原文</strong><small>登入憑證不會寫進頁面或紀錄</small></span></div>
                        <div><BookOpenCheck aria-hidden="true" /><span><strong>紀錄不混用</strong><small>每次作答都綁定目前學習者</small></span></div>
                    </div>
                </div>

                <section className={styles.card} aria-live="polite">
                    {loading ? (
                        <div className={styles.centerState}>正在確認帳號狀態…</div>
                    ) : account ? (
                        <div className={styles.accountState}>
                            <span className={styles.successIcon}><CheckCircle2 aria-hidden="true" /></span>
                            <div>
                                <span className={styles.kicker}>已登入</span>
                                <h2>{account.displayName}</h2>
                                <p>{account.email}</p>
                            </div>
                            <dl className={styles.accountFacts}>
                                <div><dt>使用身份</dt><dd>{ROLE_LABELS[account.activeRole]}</dd></div>
                                <div><dt>學習者</dt><dd>{account.learner.displayName}</dd></div>
                                <div><dt>年級</dt><dd>{account.learner.gradeName ?? "尚未設定"}</dd></div>
                                <div>
                                    <dt>信箱狀態</dt>
                                    <dd><Badge tone={account.emailVerified ? "success" : "warning"}>{account.emailVerified ? "已驗證" : "待驗證"}</Badge></dd>
                                </div>
                            </dl>
                            {!account.emailVerified && (
                                <p className={styles.verificationNote}>信箱尚未驗證；目前可繼續使用，啟用寄信服務後再完成驗證。</p>
                            )}
                            {message && <p className={styles.status} role="status">{message}</p>}
                            <div className={styles.actions}>
                                <Link className={styles.primaryAction} href="/local-practice">開始第四課練習<ArrowRight aria-hidden="true" /></Link>
                                <Button appearance="outline" disabled={submitting} onClick={() => void logout()}><LogOut aria-hidden="true" />登出</Button>
                            </div>
                        </div>
                    ) : transportAllowed === false ? (
                        <div className={styles.transportWarning} role="alert">
                            <LockKeyhole aria-hidden="true" />
                            <h2>請改用安全入口</h2>
                            <p>這個網址不是 HTTPS，因此不接受密碼。請在執行 Lerniqa 的電腦開啟 <code>http://localhost:3500/account</code>，或先替跨裝置入口設定 HTTPS。</p>
                        </div>
                    ) : (
                        <>
                            <div className={styles.tabs} role="tablist" aria-label="帳號操作">
                                <button aria-selected={mode === "login"} onClick={() => { setMode("login"); setMessage(""); }} role="tab" type="button">登入</button>
                                <button aria-selected={mode === "register"} onClick={() => { setMode("register"); setMessage(""); }} role="tab" type="button">建立帳號</button>
                            </div>
                            <div className={styles.formHeading}>
                                <h2>{mode === "login" ? "繼續你的練習" : "建立學習帳號"}</h2>
                                <p>{mode === "login" ? "使用註冊時的電子郵件與密碼。" : "先建立一位國一學習者；日後可再擴充其他年級與學習者。"}</p>
                            </div>
                            <form className={styles.form} onSubmit={(event) => void submit(event)}>
                                {mode === "register" && (
                                    <>
                                        <label>帳號稱呼<input autoComplete="name" maxLength={80} name="displayName" placeholder="例如：王小姐" required /></label>
                                        <label>學習者稱呼<input autoComplete="off" maxLength={80} name="learnerName" placeholder="可使用暱稱" required /></label>
                                        <label>使用身份
                                            <select defaultValue="parent" name="role" required>
                                                <option value="parent">家長</option>
                                                <option value="learner">學習者本人</option>
                                                <option value="tutor">一對一家教</option>
                                            </select>
                                        </label>
                                    </>
                                )}
                                <label>電子郵件<input autoComplete="email" inputMode="email" maxLength={320} name="email" placeholder="name@example.com" required type="email" /></label>
                                <label>密碼
                                    <input autoComplete={mode === "login" ? "current-password" : "new-password"} maxLength={128} minLength={12} name="password" required type="password" />
                                    {mode === "register" && <small>至少 12 個字元；可使用容易記住的長句。</small>}
                                </label>
                                {message && <p className={styles.status} role="status">{message}</p>}
                                <Button disabled={submitting} type="submit">
                                    {mode === "login" ? <LogIn aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
                                    {submitting ? "處理中…" : mode === "login" ? "登入" : "建立帳號並登入"}
                                </Button>
                            </form>
                        </>
                    )}
                </section>
            </section>
        </main>
    );
}
