"use client";

import { Badge, Button } from "@keel-design/ui";
import {
    ArrowRight,
    BookOpen,
    BookOpenCheck,
    CheckCircle2,
    ClipboardCheck,
    LockKeyhole,
    LogIn,
    LogOut,
    MailCheck,
    ShieldCheck,
    Sparkles,
    Target,
    Trash2,
    UserPlus,
} from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { LerniqaLogo, LerniqaMark } from "../components/lerniqa-mark";
import {
    ACCOUNT_PASSWORD_HINT,
    ACCOUNT_PASSWORD_MAX_LENGTH,
    ACCOUNT_PASSWORD_MIN_LENGTH,
    validateNewAccountPassword,
} from "../lib/auth-input";
import { resolveAccountReturnPath, resolveLearningBookShareReturnPath } from "../lib/account-return-path";
import {
    AUTH_SESSION_EXPIRED_EVENT,
    broadcastAuthSessionContextChanged,
    broadcastAuthSessionExpired,
    isAuthSessionExpired,
    isAuthSessionContextStorageEvent,
    isAuthSessionStorageEvent,
    logoutAuthSession,
} from "../lib/auth-session-client";
import styles from "./account.module.css";

type AccountRole = "parent" | "learner" | "tutor";
type AccountMode = "login" | "register";
type MessageTone = "error" | "success" | "warning";

interface AccountRecord {
    displayName: string;
    email: string | null;
    emailVerified: boolean | null;
    accountRole: AccountRole | null;
    activeRole: AccountRole;
    roles: AccountRole[];
    learner: {
        id: string;
        displayName: string;
        gradeCode: string | null;
        gradeName: string | null;
    };
    learners: Array<{
        id: string;
        displayName: string;
        gradeCode: string | null;
        gradeName: string | null;
    }>;
    expiresAt: string;
}

interface AccountResponse {
    data: { account: AccountRecord };
}

interface VerificationRequestResponse {
    data: {
        status: "sent" | "already_verified";
        expiresAt: string | null;
    };
}

interface SocialRegistration {
    provider: "google" | "line" | "facebook";
    displayName: string;
    email: string;
}

interface GoogleConfigResponse {
    data: {
        clientId: string;
        registration: SocialRegistration | null;
    };
}

interface RememberedAccountRecord {
    id: string;
    displayName: string;
    email: string;
    current: boolean;
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
    const googleButton = useRef<HTMLDivElement>(null);
    const [account, setAccount] = useState<AccountRecord | null>(null);
    const [mode, setMode] = useState<AccountMode>("login");
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [verificationSubmitting, setVerificationSubmitting] = useState(false);
    const [message, setMessage] = useState("");
    const [messageTone, setMessageTone] = useState<MessageTone>("success");
    const [transportAllowed, setTransportAllowed] = useState<boolean | null>(null);
    const [googleClientId, setGoogleClientId] = useState("");
    const [googleScriptReady, setGoogleScriptReady] = useState(false);
    const [rememberedAccounts, setRememberedAccounts] = useState<RememberedAccountRecord[]>([]);
    const [rememberedLoading, setRememberedLoading] = useState(true);
    const [showLoginForm, setShowLoginForm] = useState(false);
    const [switchRequested, setSwitchRequested] = useState(false);
    const loginFormVisible = showLoginForm && (!account || switchRequested);

    const clearExpiredAccount = useCallback((nextMessage: string) => {
        setAccount(null);
        setMode("login");
        setMessageTone("error");
        setMessage(nextMessage);
    }, []);

    useEffect(() => {
        setSwitchRequested(new URLSearchParams(window.location.search).get("switch") === "1");
        setTransportAllowed(credentialTransportAllowed());
        void fetch("/api/v1/auth/me", { cache: "no-store" })
            .then(async (response) => {
                if (response.status === 401) return null;
                return readApi<AccountResponse>(response);
            })
            .then((result) => {
                setAccount(result?.data.account ?? null);
                const returnPath = resolveLearningBookShareReturnPath(
                    new URLSearchParams(window.location.search).get("returnTo"),
                );
                if (result?.data.account && returnPath !== null) window.location.replace(returnPath);
            })
            .catch((error) => {
                setMessageTone("error");
                setMessage(error instanceof Error ? error.message : "無法讀取帳號狀態。");
            })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        void fetch("/api/v1/auth/remembered-accounts", { cache: "no-store" })
            .then((response) => readApi<{ data: { accounts: RememberedAccountRecord[] } }>(response))
            .then(({ data }) => {
                setRememberedAccounts(data.accounts);
                if (data.accounts.length === 0) setShowLoginForm(true);
            })
            .catch(() => setShowLoginForm(true))
            .finally(() => setRememberedLoading(false));
    }, []);

    useEffect(() => {
        if (!loginFormVisible || transportAllowed === false) return;
        void fetch("/api/v1/auth/google/quick-register", { cache: "no-store" })
            .then((response) => readApi<GoogleConfigResponse>(response))
            .then(({ data }) => setGoogleClientId(data.clientId))
            .catch(() => setGoogleClientId(""));
    }, [loginFormVisible, transportAllowed]);

    useEffect(() => {
        const target = googleButton.current;
        const google = window.google;
        if (!loginFormVisible || !googleScriptReady || !googleClientId || !target || !google) return;
        target.replaceChildren();
        google.accounts.id.initialize({
            client_id: googleClientId,
            callback: ({ credential }) => {
                setSubmitting(true);
                setMessage("");
                void fetch("/api/v1/auth/google/quick-register", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "credential", credential }),
                })
                    .then((response) => readApi<GoogleConfigResponse>(response))
                    .then(({ data }) => {
                        if (data.registration) {
                            window.location.assign("/quick-register");
                            return;
                        }
                        window.location.replace("/overview");
                    })
                    .catch((error) => {
                        setMessageTone("error");
                        setMessage(error instanceof Error ? error.message : "Google 登入失敗，請重新選擇帳號。");
                    })
                    .finally(() => setSubmitting(false));
            },
        });
        google.accounts.id.renderButton(target, {
            locale: "zh_TW",
            shape: "pill",
            size: "small",
            text: "signin_with",
            theme: "outline",
            width: 138,
        });
    }, [googleClientId, googleScriptReady, loginFormVisible]);

    useEffect(() => {
        const handleExpired = () => clearExpiredAccount("登入狀態已失效，請重新登入。帳號資料已從此頁清除。");
        const handleStorage = (event: StorageEvent) => {
            if (isAuthSessionStorageEvent(event)) {
                handleExpired();
                return;
            }
            if (isAuthSessionContextStorageEvent(event)) window.location.reload();
        };
        window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleExpired);
        window.addEventListener("storage", handleStorage);
        return () => {
            window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleExpired);
            window.removeEventListener("storage", handleStorage);
        };
    }, [clearExpiredAccount]);

    useEffect(() => {
        const expiresAt = account?.expiresAt;
        if (!expiresAt) return;
        let active = true;
        let revalidating = false;
        const expireIfNeeded = (): boolean => {
            if (!isAuthSessionExpired(expiresAt)) return false;
            broadcastAuthSessionExpired();
            return true;
        };
        const revalidateAuthentication = async () => {
            if (expireIfNeeded() || revalidating) return;
            revalidating = true;
            try {
                const response = await fetch("/api/v1/auth/me", { cache: "no-store" });
                if (!active) return;
                if (response.status === 401) {
                    broadcastAuthSessionExpired();
                    return;
                }
                if (response.ok) {
                    const result = await readApi<AccountResponse>(response);
                    if (active) setAccount(result.data.account);
                }
            }
            catch {
                // Keep the current state during transient network failures; expiry still clears locally.
            }
            finally {
                revalidating = false;
            }
        };
        const expiresAtMillis = new Date(expiresAt).getTime();
        const delay = Math.max(0, Math.min(expiresAtMillis - Date.now(), 2_147_483_647));
        const timer = window.setTimeout(expireIfNeeded, delay);
        const handleFocus = () => { void revalidateAuthentication(); };
        const handleVisibility = () => {
            if (document.visibilityState === "visible") void revalidateAuthentication();
        };
        window.addEventListener("focus", handleFocus);
        document.addEventListener("visibilitychange", handleVisibility);
        expireIfNeeded();
        return () => {
            active = false;
            window.clearTimeout(timer);
            window.removeEventListener("focus", handleFocus);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [account?.expiresAt]);

    function switchMode(nextMode: AccountMode) {
        setMode(nextMode);
        setMessage("");
    }

    async function sendVerificationEmail(createdNow = false) {
        if (verificationSubmitting) return;
        setVerificationSubmitting(true);
        if (!createdNow) setMessage("");
        try {
            const response = await fetch("/api/v1/auth/email-verification", {
                method: "POST",
            });
            const result = await readApi<VerificationRequestResponse>(response);
            if (result.data.status === "already_verified") {
                const refreshed = await readApi<AccountResponse>(
                    await fetch("/api/v1/auth/me", { cache: "no-store" }),
                );
                setAccount(refreshed.data.account);
                setMessageTone("success");
                setMessage("信箱已完成驗證。");
                return;
            }
            setMessageTone("success");
            setMessage("驗證信已寄出，請在 60 分鐘內開啟信中的連結。");
        }
        catch (error) {
            setMessageTone(createdNow ? "warning" : "error");
            const detail = error instanceof Error ? error.message : "目前無法寄出驗證信。";
            setMessage(createdNow
                ? `帳號已建立並登入，但驗證信尚未寄出：${detail}`
                : detail);
        }
        finally {
            setVerificationSubmitting(false);
        }
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!transportAllowed || submitting) return;
        setSubmitting(true);
        setMessage("");
        try {
            const form = new FormData(event.currentTarget);
            const password = mode === "register"
                ? validateNewAccountPassword(form.get("password"))
                : form.get("password");
            const payload = { email: form.get("email"), password };
            const response = await fetch(`/api/v1/auth/${mode}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (mode === "register") {
                await readApi<{ data: { onboarding: true } }>(response);
                window.location.assign("/quick-register");
                return;
            }
            const result = await readApi<AccountResponse>(response);
            setAccount(result.data.account);
            const rawReturnPath = new URLSearchParams(window.location.search).get("returnTo");
            const destination = resolveAccountReturnPath(rawReturnPath) ?? "/overview";
            window.location.replace(destination);
        }
        catch (error) {
            setMessageTone("error");
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
            await logoutAuthSession();
            setMessageTone("success");
            setMessage("已安全登出。" );
        }
        catch (error) {
            setMessageTone("error");
            setMessage(error instanceof Error ? error.message : "目前無法登出。" );
        }
        finally {
            setSubmitting(false);
        }
    }

    async function switchRememberedAccount(accountId: string) {
        if (submitting) return;
        setSubmitting(true);
        setMessage("");
        try {
            const result = await readApi<AccountResponse>(await fetch(
                `/api/v1/auth/remembered-accounts/${encodeURIComponent(accountId)}`,
                { method: "POST" },
            ));
            setAccount(result.data.account);
            broadcastAuthSessionContextChanged();
            window.location.replace("/overview");
        }
        catch (error) {
            setMessageTone("error");
            setMessage(error instanceof Error ? error.message : "帳號切換失敗，請重新登入。");
        }
        finally {
            setSubmitting(false);
        }
    }

    async function removeRememberedAccount(accountId: string) {
        if (submitting) return;
        setSubmitting(true);
        setMessage("");
        try {
            await readApi<{ data: { removed: true } }>(await fetch(
                `/api/v1/auth/remembered-accounts/${encodeURIComponent(accountId)}`,
                { method: "DELETE" },
            ));
            setRememberedAccounts((accounts) => accounts.filter((candidate) => candidate.id !== accountId));
        }
        catch (error) {
            setMessageTone("error");
            setMessage(error instanceof Error ? error.message : "無法移除這個帳號。");
        }
        finally {
            setSubmitting(false);
        }
    }

    return (
        <main className={styles.page}>
            <Script
                onLoad={() => setGoogleScriptReady(true)}
                src="https://accounts.google.com/gsi/client"
                strategy="afterInteractive"
            />
            <div className={styles.ambient} aria-hidden="true">
                <span />
                <span />
                <span />
            </div>
            <span className={styles.floatingDecor} data-position="top-left" aria-hidden="true">
                <BookOpen />
            </span>
            <span className={styles.floatingDecor} data-position="bottom-right" aria-hidden="true">
                <Sparkles />
            </span>
            <section className={styles.shell}>
                <section className={styles.story} aria-labelledby="account-story-title">
                    <div className={styles.storyGlow} aria-hidden="true" />
                    <div className={styles.intro}>
                        <div className={styles.storyBrandRow}>
                            <Link className={styles.storyBrand} href="/overview" aria-label="返回 Lerniqa 首頁">
                                <LerniqaLogo className={styles.storyLogo} tone="inverse" />
                            </Link>
                            <span className={styles.kicker}><Sparkles aria-hidden="true" />題目變練習</span>
                        </div>
                        <h1 id="account-story-title">
                            <span>把題目，</span>
                            <span>變成有效練習</span>
                        </h1>
                        <p>整理自己的題目，或領取分享題本。作答、錯題與複習進度都會保存。</p>
                    </div>

                    <div className={styles.journeyCard} aria-label="Lerniqa 練習與複習流程">
                        <div className={styles.journeyHeading}>
                            <span>整理、練習、複習</span>
                            <small>一個地方完成</small>
                        </div>
                        <ol className={styles.journeySteps}>
                            <li>
                                <span className={styles.stepIcon}><BookOpenCheck aria-hidden="true" /></span>
                                <span><small>01</small><strong>整理題目</strong><em>建立題庫或領取分享</em></span>
                            </li>
                            <li>
                                <span className={styles.stepIcon}><ClipboardCheck aria-hidden="true" /></span>
                                <span><small>02</small><strong>開始練習</strong><em>選好範圍，立即作答</em></span>
                            </li>
                            <li>
                                <span className={styles.stepIcon}><Target aria-hidden="true" /></span>
                                <span><small>03</small><strong>複習錯題</strong><em>找出弱點，再練一次</em></span>
                            </li>
                        </ol>
                    </div>

                    <div className={styles.promiseGrid}>
                        <div><LockKeyhole aria-hidden="true" /><span><strong>保存練習進度</strong><small>作答與錯題都會留下</small></span></div>
                    </div>
                </section>

                <div className={styles.authColumn}>
                    <section className={styles.card} data-mode={account ? "account" : mode} aria-label="Lerniqa 帳號">
                        {loading ? (
                            <div className={styles.centerState} role="status">
                                <span className={styles.loadingMark}><LerniqaMark /></span>
                                <span>正在確認帳號狀態…</span>
                            </div>
                        ) : account && !switchRequested ? (
                            <div className={styles.accountState}>
                                <span className={styles.successIcon}><CheckCircle2 aria-hidden="true" /></span>
                                <div>
                                    <span className={styles.formEyebrow}>已登入</span>
                                    <h2>{account.displayName}</h2>
                                    <p>{account.email ?? "受管理學習者模式"}</p>
                                </div>
                                <dl className={styles.accountFacts}>
                                    <div><dt>目前模式</dt><dd>{ROLE_LABELS[account.activeRole]}</dd></div>
                                    <div><dt>目前學習者</dt><dd>{account.learner.displayName}</dd></div>
                                    <div><dt>年級</dt><dd>{account.learner.gradeName ?? "尚未設定"}</dd></div>
                                    <div>
                                        <dt>信箱狀態</dt>
                                        <dd><Badge tone={account.emailVerified ? "success" : "warning"}>{account.emailVerified === null ? "帳號資訊已隱藏" : account.emailVerified ? "已驗證" : "待驗證"}</Badge></dd>
                                    </div>
                                </dl>
                                {account.roles.some((role) => role === "parent" || role === "tutor") && (
                                    <Link className={styles.recoveryLink} href="/account/forgot-role-pin">
                                        <LockKeyhole aria-hidden="true" />
                                        <span>
                                            <strong>設定／重設角色 PIN</strong>
                                            <small>只更新 PIN 憑證；目前切換角色仍使用帳號密碼。</small>
                                        </span>
                                        <ArrowRight aria-hidden="true" />
                                    </Link>
                                )}
                                {account.emailVerified === false && (
                                    <div className={styles.verificationNote}>
                                        <div><MailCheck aria-hidden="true" /><span><strong>完成信箱驗證</strong><small>驗證連結只可使用一次，並會在 60 分鐘後失效。</small></span></div>
                                        <Button appearance="outline" disabled={verificationSubmitting || submitting} onClick={() => void sendVerificationEmail()} type="button">
                                            <MailCheck aria-hidden="true" />
                                            {verificationSubmitting ? "寄送中…" : "寄送驗證信"}
                                        </Button>
                                    </div>
                                )}
                                {message && <p className={styles.status} data-tone={messageTone} role={messageTone === "error" ? "alert" : "status"}>{message}</p>}
                                <div className={styles.actions}>
                                    <Link className={styles.primaryAction} href="/practice">前往練習<ArrowRight aria-hidden="true" /></Link>
                                    <Button appearance="outline" disabled={submitting} onClick={() => void logout()}><LogOut aria-hidden="true" />登出</Button>
                                </div>
                            </div>
                        ) : transportAllowed === false ? (
                            <div className={styles.transportWarning} role="alert">
                                <LockKeyhole aria-hidden="true" />
                                <h2>請改用安全入口</h2>
                                <p>這個網址不是 HTTPS，因此不接受密碼。請在執行 Lerniqa 的電腦開啟 <code>http://localhost:3500/account</code>，或先替跨裝置入口設定 HTTPS。</p>
                            </div>
                        ) : rememberedLoading ? (
                            <div className={styles.centerState} role="status">正在載入這台裝置的帳號…</div>
                        ) : !showLoginForm && (rememberedAccounts.length > 0 || account) ? (
                            <div className={styles.accountPicker}>
                                <div className={styles.formHeading}>
                                    <span className={styles.formEyebrow}>切換帳號</span>
                                    <h2>選擇要使用的帳號</h2>
                                    <p>已在這台裝置登入過的帳號，可直接繼續使用。</p>
                                </div>
                                <div className={styles.rememberedList}>
                                    {rememberedAccounts.map((candidate) => (
                                        <div className={styles.rememberedAccount} key={candidate.id}>
                                            <button
                                                className={styles.rememberedSelect}
                                                disabled={submitting || candidate.current}
                                                onClick={() => void switchRememberedAccount(candidate.id)}
                                                type="button"
                                            >
                                                <span className={styles.accountAvatar} aria-hidden="true">{candidate.displayName.slice(0, 1)}</span>
                                                <span><strong>{candidate.displayName}</strong><small>{candidate.email}</small></span>
                                                {candidate.current && <Badge tone="success">目前使用中</Badge>}
                                            </button>
                                            <button
                                                className={styles.removeAccount}
                                                disabled={submitting}
                                                onClick={() => void removeRememberedAccount(candidate.id)}
                                                aria-label={`從這台裝置移除 ${candidate.displayName}`}
                                                title="從這台裝置移除"
                                                type="button"
                                            ><Trash2 aria-hidden="true" /></button>
                                        </div>
                                    ))}
                                    {account && !rememberedAccounts.some((candidate) => candidate.current) && (
                                        <div className={styles.rememberedAccount}>
                                            <button className={styles.rememberedSelect} disabled type="button">
                                                <span className={styles.accountAvatar} aria-hidden="true">{account.displayName.slice(0, 1)}</span>
                                                <span><strong>{account.displayName}</strong><small>{account.email ?? "目前帳號"}</small></span>
                                                <Badge tone="success">目前使用中</Badge>
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {message && <p className={styles.status} data-tone={messageTone} role="alert">{message}</p>}
                                <Button appearance="outline" onClick={() => setShowLoginForm(true)} type="button"><UserPlus aria-hidden="true" />登入其他帳號</Button>
                                {account && <Link className={styles.cancelSwitch} href="/overview">取消切換</Link>}
                            </div>
                        ) : (
                            <>
                                <div className={styles.tabs} role="group" aria-label="帳號操作">
                                    <button aria-pressed={mode === "login"} onClick={() => switchMode("login")} type="button"><LogIn aria-hidden="true" />登入</button>
                                    <button aria-pressed={mode === "register"} onClick={() => switchMode("register")} type="button"><UserPlus aria-hidden="true" />建立帳號</button>
                                </div>
                                {rememberedAccounts.length > 0 && (
                                    <button className={styles.backToAccounts} onClick={() => setShowLoginForm(false)} type="button">返回帳號清單</button>
                                )}
                                <div className={styles.formHeading}>
                                    <span className={styles.formEyebrow}>{mode === "login" ? "歡迎回來" : "開始使用 Lerniqa"}</span>
                                    <h2>{mode === "login" ? "繼續你的學習旅程" : "建立你的學習帳號"}</h2>
                                    <p>{mode === "login" ? "使用註冊時的電子郵件與密碼，接續上次的練習。" : "先用電子郵件與密碼建立帳號，下一步再設定學習者資料。"}</p>
                                </div>
                                <form className={styles.form} onSubmit={(event) => void submit(event)}>
                                    <label>電子郵件<input autoCapitalize="none" autoComplete="email" inputMode="email" maxLength={320} name="email" placeholder="name@example.com" required spellCheck={false} type="email" /></label>
                                    <div className={styles.fieldGroup}>
                                        <span className={styles.fieldLabelRow}>
                                            <label htmlFor="account-password">密碼</label>
                                            {mode === "login" && <Link href="/account/forgot-password">忘記密碼？</Link>}
                                        </span>
                                        <input id="account-password" aria-describedby={mode === "register" ? "new-password-hint" : undefined} autoComplete={mode === "login" ? "current-password" : "new-password"} maxLength={ACCOUNT_PASSWORD_MAX_LENGTH} minLength={ACCOUNT_PASSWORD_MIN_LENGTH} name="password" required type="password" />
                                        {mode === "register" && <small id="new-password-hint">{ACCOUNT_PASSWORD_HINT}</small>}
                                    </div>
                                    {message && <p className={styles.status} data-tone={messageTone} role={messageTone === "error" ? "alert" : "status"}>{message}</p>}
                                    <Button disabled={submitting} type="submit">
                                        {mode === "login" ? <LogIn aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
                                        {submitting ? "處理中…" : mode === "login" ? "登入" : "建立帳號"}
                                    </Button>
                                    <div className={styles.quickRegisterDivider}><span>或</span></div>
                                    <div className={styles.socialRegisterActions}>
                                        <a href="/api/v1/auth/social/line/authorize">
                                            <img alt="" src="/social-line.svg" />
                                            LINE
                                        </a>
                                        <a href="/api/v1/auth/social/facebook/authorize">
                                            <img alt="" src="/social-facebook.svg" />
                                            Facebook
                                        </a>
                                        <div className={styles.googleRegisterAction} aria-label="使用 Google 登入">
                                            <span aria-hidden="true"><img alt="" src="/social-google.svg" />Google</span>
                                            <div ref={googleButton} className={styles.googleRegisterControl} />
                                        </div>
                                    </div>
                                </form>
                            </>
                        )}
                    </section>
                    <p className={styles.securityNote}><ShieldCheck aria-hidden="true" />使用共用裝置時，請從帳號清單移除已儲存的帳號。</p>
                </div>
            </section>
        </main>
    );
}
