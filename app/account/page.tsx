"use client";

import { Badge, Button } from "@keel-design/ui";
import {
    ArrowRight,
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
    UserPlus,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { LerniqaMark } from "../components/lerniqa-mark";
import {
    ACCOUNT_PASSWORD_HINT,
    ACCOUNT_PASSWORD_MAX_LENGTH,
    ACCOUNT_PASSWORD_MIN_LENGTH,
    validateNewAccountPassword,
} from "../lib/auth-input";
import { resolveAdminReturnPath } from "../lib/admin-return-path";
import {
    AUTH_SESSION_EXPIRED_EVENT,
    broadcastAuthSessionExpired,
    isAuthSessionExpired,
    isAuthSessionContextStorageEvent,
    isAuthSessionStorageEvent,
} from "../lib/auth-session-client";
import {
    findEducationStage,
    type EducationCatalog,
    type EducationStage,
} from "../lib/education-catalog-contract";
import styles from "./account.module.css";

type AccountRole = "parent" | "learner" | "tutor";
type LearnerEducationStatus = "enrolled" | "not_enrolled";
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

interface EducationCatalogResponse {
    data: { catalog: EducationCatalog };
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
    const [verificationSubmitting, setVerificationSubmitting] = useState(false);
    const [message, setMessage] = useState("");
    const [messageTone, setMessageTone] = useState<MessageTone>("success");
    const [transportAllowed, setTransportAllowed] = useState<boolean | null>(null);
    const [registerRole, setRegisterRole] = useState<AccountRole>("parent");
    const [educationStatus, setEducationStatus] = useState<LearnerEducationStatus>("enrolled");
    const [educationCatalog, setEducationCatalog] = useState<EducationCatalog>();
    const [educationCatalogError, setEducationCatalogError] = useState("");
    const [educationStage, setEducationStage] = useState<EducationStage | "">("");
    const [gradeCode, setGradeCode] = useState("");
    const [semesterCode, setSemesterCode] = useState("");

    const clearExpiredAccount = useCallback((nextMessage: string) => {
        setAccount(null);
        setMode("login");
        setMessageTone("error");
        setMessage(nextMessage);
    }, []);

    useEffect(() => {
        setTransportAllowed(credentialTransportAllowed());
        void fetch("/api/v1/auth/me", { cache: "no-store" })
            .then(async (response) => {
                if (response.status === 401) return null;
                return readApi<AccountResponse>(response);
            })
            .then((result) => setAccount(result?.data.account ?? null))
            .catch((error) => {
                setMessageTone("error");
                setMessage(error instanceof Error ? error.message : "無法讀取帳號狀態。");
            })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        void fetch("/api/v1/auth/catalog", { cache: "no-store" })
            .then((response) => readApi<EducationCatalogResponse>(response))
            .then(({ data }) => {
                const preferredStage = data.catalog.stages.find((stage) => stage.code === "junior_high")
                    ?? data.catalog.stages[0];
                setEducationCatalog(data.catalog);
                setEducationStage(preferredStage?.code ?? "");
                setGradeCode(preferredStage?.grades[0]?.code ?? "");
                setSemesterCode(data.catalog.semesters[0]?.code ?? "");
                setEducationCatalogError("");
            })
            .catch((error) => {
                setEducationCatalogError(error instanceof Error ? error.message : "目前無法讀取教育階段與年級。");
            });
    }, []);

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
        if (mode === "register" && educationStatus === "enrolled" && (!gradeCode || !semesterCode)) {
            setMessageTone("error");
            setMessage("請先選擇教育階段、年級與學期。");
            return;
        }
        setSubmitting(true);
        setMessage("");
        try {
            const form = new FormData(event.currentTarget);
            const password = mode === "register"
                ? validateNewAccountPassword(form.get("password"))
                : form.get("password");
            const payload = mode === "login"
                ? {
                    email: form.get("email"),
                    password,
                }
                : {
                    displayName: form.get("displayName"),
                    learnerName: registerRole === "learner"
                        ? form.get("displayName")
                        : form.get("learnerName"),
                    email: form.get("email"),
                    password,
                    role: registerRole,
                    educationStatus,
                    gradeCode: educationStatus === "enrolled" ? gradeCode : null,
                    semesterCode: educationStatus === "enrolled" ? semesterCode : null,
                };
            const response = await fetch(`/api/v1/auth/${mode}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const result = await readApi<AccountResponse>(response);
            setAccount(result.data.account);
            setMessageTone("success");
            setMessage(mode === "register" ? "帳號已建立，學習者資料也已連結。" : "登入成功。" );
            const returnPath = mode === "login"
                ? resolveAdminReturnPath(new URLSearchParams(window.location.search).get("returnTo"))
                : null;

            if (returnPath !== null) {
                window.location.replace(returnPath);
                return;
            }

            if (mode === "register" && result.data.account.emailVerified === false) {
                await sendVerificationEmail(true);
            }
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
            const response = await fetch("/api/v1/auth/logout", { method: "POST" });
            await readApi<{ data: { loggedOut: boolean } }>(response);
            broadcastAuthSessionExpired();
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

    return (
        <main className={styles.page}>
            <div className={styles.ambient} aria-hidden="true">
                <span />
                <span />
                <span />
            </div>
            <header className={styles.topbar}>
                <Link className={styles.brand} href="/overview" aria-label="返回 Lerniqa 首頁">
                    <span className={styles.brandMark}><LerniqaMark /></span>
                    <span><strong>Lerniqa</strong><small>讓每次練習接得起來</small></span>
                </Link>
                <Link aria-label="前往練習" className={styles.practiceLink} href="/practice"><span>前往練習</span><ArrowRight aria-hidden="true" /></Link>
            </header>

            <section className={styles.shell}>
                <section className={styles.story} aria-labelledby="account-story-title">
                    <div className={styles.storyGlow} aria-hidden="true" />
                    <div className={styles.intro}>
                        <span className={styles.kicker}><Sparkles aria-hidden="true" />讓學習有方向，也有下一步</span>
                        <h1 id="account-story-title">從今天的練習，接回下一次進步</h1>
                        <p>登入後，依年級、科目與版本安排練習；作答、錯題與最近紀錄都會依學習者分開保存。</p>
                    </div>

                    <div className={styles.journeyCard} aria-label="Lerniqa 學習流程">
                        <div className={styles.journeyHeading}>
                            <span>自己的學習路徑</span>
                            <small>每次回來，都知道從哪裡繼續</small>
                        </div>
                        <ol className={styles.journeySteps}>
                            <li>
                                <span className={styles.stepIcon}><BookOpenCheck aria-hidden="true" /></span>
                                <span><small>01</small><strong>選擇範圍</strong><em>年級・科目・版本・課次</em></span>
                            </li>
                            <li>
                                <span className={styles.stepIcon}><ClipboardCheck aria-hidden="true" /></span>
                                <span><small>02</small><strong>完成練習</strong><em>依自己的節奏作答</em></span>
                            </li>
                            <li>
                                <span className={styles.stepIcon}><Target aria-hidden="true" /></span>
                                <span><small>03</small><strong>回顧錯題</strong><em>找出下一次練習重點</em></span>
                            </li>
                        </ol>
                    </div>

                    <div className={styles.promiseGrid}>
                        <div><ShieldCheck aria-hidden="true" /><span><strong>學習紀錄分開保存</strong><small>每次作答綁定目前學習者</small></span></div>
                        <div><LockKeyhole aria-hidden="true" /><span><strong>密碼只存安全雜湊</strong><small>不把原始密碼寫進頁面或紀錄</small></span></div>
                    </div>
                </section>

                <div className={styles.authColumn}>
                    <section className={styles.card} data-mode={account ? "account" : mode} aria-label="Lerniqa 帳號">
                        {loading ? (
                            <div className={styles.centerState} role="status">
                                <span className={styles.loadingMark}><LerniqaMark /></span>
                                <span>正在確認帳號狀態…</span>
                            </div>
                        ) : account ? (
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
                        ) : (
                            <>
                                <div className={styles.tabs} role="group" aria-label="帳號操作">
                                    <button aria-pressed={mode === "login"} onClick={() => switchMode("login")} type="button"><LogIn aria-hidden="true" />登入</button>
                                    <button aria-pressed={mode === "register"} onClick={() => switchMode("register")} type="button"><UserPlus aria-hidden="true" />建立帳號</button>
                                </div>
                                <div className={styles.formHeading}>
                                    <span className={styles.formEyebrow}>{mode === "login" ? "歡迎回來" : "開始使用 Lerniqa"}</span>
                                    <h2>{mode === "login" ? "繼續你的學習旅程" : "建立你的學習帳號"}</h2>
                                    <p>{mode === "login" ? "使用註冊時的電子郵件與密碼，接續上次的練習。" : "先選擇你使用帳號的身分，系統會依身分建立或連結學習者資料。"}</p>
                                </div>
                                <form className={styles.form} onSubmit={(event) => void submit(event)}>
                                    {mode === "register" && (
                                        <label>你的身分
                                            <select aria-describedby="register-role-hint" name="role" onChange={(event) => setRegisterRole(event.target.value as AccountRole)} required value={registerRole}>
                                                <option value="parent">家長</option>
                                                <option value="learner">學習者本人</option>
                                                <option value="tutor">一對一家教</option>
                                            </select>
                                            <small id="register-role-hint">
                                                {registerRole === "learner"
                                                    ? "系統會用帳號稱呼建立本人學習者資料，不必再輸入另一個名稱。"
                                                    : "先連結一位受管理學習者；建立帳號後可在系統設定新增或管理其他學習者。"}
                                            </small>
                                        </label>
                                    )}
                                    {mode === "register" && (
                                        <div className={styles.identityFields} data-single={registerRole === "learner" ? "true" : "false"}>
                                            <label>帳號稱呼
                                                <input autoComplete="name" maxLength={80} name="displayName" placeholder={registerRole === "learner" ? "例如：小宇" : "例如：王小姐"} required />
                                            </label>
                                            {registerRole !== "learner" && (
                                                <label>首位受管理學習者稱呼
                                                    <input autoComplete="off" maxLength={80} name="learnerName" placeholder="可使用暱稱" required />
                                                </label>
                                            )}
                                        </div>
                                    )}
                                    {mode === "register" && (
                                        <div className={styles.identityFields}>
                                            <label>學習身分
                                                <select name="educationStatus" onChange={(event) => {
                                                    const nextStatus = event.target.value as LearnerEducationStatus;
                                                    setEducationStatus(nextStatus);
                                                    if (nextStatus === "enrolled" && educationCatalog) {
                                                        const stage = findEducationStage(educationCatalog, gradeCode)
                                                            ?? educationCatalog.stages[0];
                                                        setEducationStage(stage?.code ?? "");
                                                        setGradeCode(stage?.grades[0]?.code ?? "");
                                                        setSemesterCode((current) => current || educationCatalog.semesters[0]?.code || "");
                                                    }
                                                }} required value={educationStatus}>
                                                    <option value="enrolled">學生</option>
                                                    <option value="not_enrolled">社會人士</option>
                                                </select>
                                            </label>
                                            {educationStatus === "enrolled" && <>
                                                <label>教育階段
                                                    <select disabled={!educationCatalog?.stages.length} onChange={(event) => {
                                                        const nextStage = event.target.value as EducationStage;
                                                        const stage = educationCatalog?.stages.find((candidate) => candidate.code === nextStage);
                                                        setEducationStage(nextStage);
                                                        setGradeCode(stage?.grades[0]?.code ?? "");
                                                    }} required value={educationStage}>
                                                        {educationCatalog?.stages.map((stage) => <option key={stage.code} value={stage.code}>{stage.name}</option>)}
                                                    </select>
                                                </label>
                                                <label>年級
                                                    <select disabled={!educationStage} name="gradeCode" onChange={(event) => setGradeCode(event.target.value)} required value={gradeCode}>
                                                        {educationCatalog?.stages.find((stage) => stage.code === educationStage)?.grades.map((grade) => <option key={grade.code} value={grade.code}>{grade.name}</option>)}
                                                    </select>
                                                </label>
                                                <label>學期
                                                    <select disabled={!educationCatalog?.semesters.length} name="semesterCode" onChange={(event) => setSemesterCode(event.target.value)} required value={semesterCode}>
                                                        {educationCatalog?.semesters.map((semester) => <option key={semester.code} value={semester.code}>{semester.name}</option>)}
                                                    </select>
                                                </label>
                                            </>}
                                        </div>
                                    )}
                                    {mode === "register" && educationCatalogError && <p className={styles.status} data-tone="error" role="alert">{educationCatalogError}</p>}
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
                                    <Button disabled={submitting || (mode === "register" && educationStatus === "enrolled" && (!gradeCode || !semesterCode))} type="submit">
                                        {mode === "login" ? <LogIn aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
                                        {submitting ? "處理中…" : mode === "login" ? "登入" : "建立帳號並登入"}
                                    </Button>
                                </form>
                            </>
                        )}
                    </section>
                    <p className={styles.securityNote}><ShieldCheck aria-hidden="true" />跨裝置登入只接受 HTTPS；密碼不會以原文保存。</p>
                </div>
            </section>
        </main>
    );
}
