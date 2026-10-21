"use client";

import { Button } from "@keel-design/ui";
import { ArrowLeft, ShieldCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AppSelect } from "../components/app-select";
import {
    findEducationStageByCode,
    type EducationCatalog,
    type EducationStage,
} from "../lib/education-catalog-contract";
import styles from "./quick-register.module.css";

type AccountRole = "parent" | "learner" | "tutor";
type LearnerEducationStatus = "enrolled" | "not_enrolled";

type SocialProvider = "google" | "line" | "facebook";

interface SocialRegistration {
    provider: SocialProvider;
    displayName: string;
    email: string;
}

interface EmailRegistration {
    provider: "email";
    displayName: null;
    email: string;
}

type Registration = SocialRegistration | EmailRegistration;

interface GoogleConfigResponse {
    data: {
        clientId: string;
        registration: SocialRegistration | null;
    };
}

interface SocialRegistrationResponse {
    data: { registration: SocialRegistration | null };
}

interface EmailRegistrationResponse {
    data: { registration: { email: string } | null };
}

interface EducationCatalogResponse {
    data: { catalog: EducationCatalog };
}

interface ApiErrorBody {
    error?: { message?: string };
}

async function readApi<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => ({})) as T & ApiErrorBody;
    if (!response.ok) throw new Error(body.error?.message || `要求失敗（${response.status}）`);
    return body;
}

export default function QuickRegisterPage() {
    const googleButton = useRef<HTMLDivElement>(null);
    const [clientId, setClientId] = useState("");
    const [scriptReady, setScriptReady] = useState(false);
    const [registration, setRegistration] = useState<Registration | null>(null);
    const [catalog, setCatalog] = useState<EducationCatalog>();
    const [role, setRole] = useState<AccountRole>("parent");
    const [educationStatus, setEducationStatus] = useState<LearnerEducationStatus>("enrolled");
    const [educationStage, setEducationStage] = useState<EducationStage | "">("");
    const [gradeCode, setGradeCode] = useState("");
    const [semesterCode, setSemesterCode] = useState("");
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState("");

    useEffect(() => {
        const callbackError = new URLSearchParams(window.location.search).get("error");
        if (callbackError) setMessage(callbackError);
        void Promise.all([
            fetch("/api/v1/auth/registration", { cache: "no-store" })
                .then((response) => readApi<EmailRegistrationResponse>(response)),
            fetch("/api/v1/auth/social/quick-register", { cache: "no-store" })
                .then((response) => readApi<SocialRegistrationResponse>(response)),
            fetch("/api/v1/auth/google/quick-register", { cache: "no-store" })
                .then((response) => readApi<GoogleConfigResponse>(response))
                .catch(() => null),
            fetch("/api/v1/auth/catalog", { cache: "no-store" })
                .then((response) => readApi<EducationCatalogResponse>(response)),
        ])
            .then(([emailResult, socialResult, googleResult, catalogResult]) => {
                const preferredStage = catalogResult.data.catalog.stages.find(
                    (stage) => stage.code === "junior_high",
                ) ?? catalogResult.data.catalog.stages[0];
                setClientId(googleResult?.data.clientId ?? "");
                const emailRegistration = emailResult.data.registration;
                setRegistration(emailRegistration
                    ? { provider: "email", displayName: null, email: emailRegistration.email }
                    : socialResult.data.registration ?? googleResult?.data.registration ?? null);
                setCatalog(catalogResult.data.catalog);
                setEducationStage(preferredStage?.code ?? "");
                setGradeCode(preferredStage?.grades[0]?.code ?? "");
                setSemesterCode(catalogResult.data.catalog.semesters[0]?.code ?? "");
            })
            .catch((error) => {
                setMessage(error instanceof Error ? error.message : "目前無法開始快速註冊。");
            })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        const target = googleButton.current;
        const google = window.google;
        if (!scriptReady || !clientId || !target || !google || registration) return;
        target.replaceChildren();
        google.accounts.id.initialize({
            client_id: clientId,
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
                            setRegistration(data.registration);
                            return;
                        }
                        window.location.replace("/overview");
                    })
                    .catch((error) => {
                        setMessage(error instanceof Error ? error.message : "Google 驗證失敗，請重新選擇帳號。");
                    })
                    .finally(() => setSubmitting(false));
            },
        });
        google.accounts.id.renderButton(target, {
            theme: "outline",
            size: "large",
            shape: "rectangular",
            text: "signup_with",
            width: Math.min(360, Math.max(240, target.clientWidth)),
            locale: "zh_TW",
        });
    }, [clientId, registration, scriptReady]);

    const stage = findEducationStageByCode(catalog, educationStage);

    async function completeRegistration(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!registration || submitting) return;
        if (educationStatus === "enrolled" && (!gradeCode || !semesterCode)) {
            setMessage("請選擇教育階段、年級與學期。");
            return;
        }
        const form = new FormData(event.currentTarget);
        setSubmitting(true);
        setMessage("");
        try {
            const endpoint = registration.provider === "email"
                ? "/api/v1/auth/registration"
                : "/api/v1/auth/social/quick-register";
            const registrationInput = {
                displayName: registration.provider === "email"
                    ? String(form.get("displayName") ?? "")
                    : registration.displayName,
                role,
                learnerName: role === "learner" ? "" : String(form.get("learnerName") ?? ""),
                educationStatus,
                gradeCode: educationStatus === "enrolled" ? gradeCode : null,
                semesterCode: educationStatus === "enrolled" ? semesterCode : null,
            };
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(registration.provider === "email"
                    ? registrationInput
                    : { action: "complete", registration: registrationInput }),
            });
            await readApi(response);
            window.location.replace("/overview");
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "目前無法完成註冊。");
        }
        finally {
            setSubmitting(false);
        }
    }

    return (
        <main className={styles.page}>
            <Script
                onLoad={() => setScriptReady(true)}
                src="https://accounts.google.com/gsi/client"
                strategy="afterInteractive"
            />
            <section className={styles.card} aria-labelledby="quick-register-title">
                <Link className={styles.back} href="/account"><ArrowLeft aria-hidden="true" />返回登入</Link>
                <span className={styles.icon}><UserPlus aria-hidden="true" /></span>
                <div className={styles.heading}>
                    <span>{registration?.provider === "email" ? "首次登入設定" : "快速註冊"}</span>
                    <h1 id="quick-register-title">建立學習者資料</h1>
                    <p>{registration?.provider === "email"
                        ? "帳號資料已確認。完成以下設定後，就能開始使用 Lerniqa。"
                        : "確認帳號後，補上身分與學習者資料。"}</p>
                </div>

                {loading && <p className={styles.status}>正在載入註冊設定…</p>}
                {!loading && !registration && (
                    <div className={styles.providerStep}>
                        {clientId && <div ref={googleButton} className={styles.googleButton} aria-label="使用 Google 註冊" />}
                        <a className={`${styles.providerButton} ${styles.lineButton}`} href="/api/v1/auth/social/line/authorize">
                            使用 LINE 註冊
                        </a>
                        <a className={`${styles.providerButton} ${styles.facebookButton}`} href="/api/v1/auth/social/facebook/authorize">
                            使用 Facebook 註冊
                        </a>
                        {submitting && <p className={styles.status}>正在驗證社群帳號…</p>}
                    </div>
                )}

                {registration && (
                    <form className={styles.form} onSubmit={(event) => void completeRegistration(event)}>
                        <div className={styles.identity}>
                            {registration.displayName && <strong>{registration.displayName}</strong>}
                            <span className={styles.providerName}>{registration.provider === "google" ? "Google" : registration.provider === "line" ? "LINE" : registration.provider === "facebook" ? "Facebook" : "電子郵件"}</span>
                            <span>{registration.email}</span>
                        </div>
                        {registration.provider === "email" && (
                            <label>
                                <span>帳號稱呼</span>
                                <input autoComplete="name" maxLength={80} name="displayName" required type="text" />
                            </label>
                        )}
                        <fieldset>
                            <legend>你使用帳號的身分</legend>
                            <div className={styles.options}>
                                {([
                                    ["parent", "家長"],
                                    ["learner", "學習者本人"],
                                    ["tutor", "一對一家教"],
                                ] as const).map(([value, label]) => (
                                    <label key={value}>
                                        <input
                                            checked={role === value}
                                            name="role"
                                            onChange={() => setRole(value)}
                                            type="radio"
                                            value={value}
                                        />
                                        <span>{label}</span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>

                        {role !== "learner" && (
                            <label>
                                <span>學習者稱呼</span>
                                <input maxLength={80} name="learnerName" required type="text" />
                            </label>
                        )}

                        <fieldset>
                            <legend>目前是否在學</legend>
                            <div className={styles.options}>
                                <label>
                                    <input checked={educationStatus === "enrolled"} onChange={() => setEducationStatus("enrolled")} type="radio" />
                                    <span>在學</span>
                                </label>
                                <label>
                                    <input checked={educationStatus === "not_enrolled"} onChange={() => setEducationStatus("not_enrolled")} type="radio" />
                                    <span>非在學</span>
                                </label>
                            </div>
                        </fieldset>

                        {educationStatus === "enrolled" && (
                            <div className={styles.educationGrid}>
                                <label>
                                    <span>教育階段</span>
                                    <AppSelect
                                        onChange={(event) => {
                                            const nextStage = findEducationStageByCode(
                                                catalog,
                                                event.target.value,
                                            );
                                            setEducationStage(nextStage?.code ?? "");
                                            setGradeCode(nextStage?.grades[0]?.code ?? "");
                                        }}
                                        options={catalog?.stages.map((item) => ({ label: item.name, value: item.code })) ?? []}
                                        value={educationStage}
                                    />
                                </label>
                                <label>
                                    <span>年級</span>
                                    <AppSelect onChange={(event) => setGradeCode(event.target.value)} options={stage?.grades.map((grade) => ({ label: grade.name, value: grade.code })) ?? []} value={gradeCode} />
                                </label>
                                <label>
                                    <span>學期</span>
                                    <AppSelect onChange={(event) => setSemesterCode(event.target.value)} options={catalog?.semesters.map((semester) => ({ label: semester.name, value: semester.code })) ?? []} value={semesterCode} />
                                </label>
                            </div>
                        )}

                        <Button disabled={submitting} type="submit">
                            <UserPlus aria-hidden="true" />
                            {submitting ? "設定中…" : "完成設定"}
                        </Button>
                    </form>
                )}

                {message && <p className={styles.error} role="alert">{message}</p>}
                <p className={styles.note}><ShieldCheck aria-hidden="true" />社群帳號只用來確認身份與電子郵件，不會自動合併既有密碼帳號。</p>
            </section>
        </main>
    );
}
