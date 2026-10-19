"use client";

import { Button } from "@keel-design/ui";
import { ArrowLeft, ShieldCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
    findEducationStage,
    type EducationCatalog,
    type EducationStage,
} from "../lib/education-catalog-contract";
import styles from "./quick-register.module.css";

type AccountRole = "parent" | "learner" | "tutor";
type LearnerEducationStatus = "enrolled" | "not_enrolled";

interface GoogleRegistration {
    displayName: string;
    email: string;
}

interface GoogleConfigResponse {
    data: {
        clientId: string;
        registration: GoogleRegistration | null;
    };
}

interface EducationCatalogResponse {
    data: { catalog: EducationCatalog };
}

interface ApiErrorBody {
    error?: { message?: string };
}

declare global {
    interface Window {
        google?: {
            accounts: {
                id: {
                    initialize(options: {
                        client_id: string;
                        callback(response: { credential: string }): void;
                    }): void;
                    renderButton(
                        parent: HTMLElement,
                        options: {
                            theme: "outline";
                            size: "large";
                            shape: "rectangular";
                            text: "signup_with";
                            width: number;
                            locale: "zh_TW";
                        },
                    ): void;
                };
            };
        };
    }
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
    const [registration, setRegistration] = useState<GoogleRegistration | null>(null);
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
        void Promise.all([
            fetch("/api/v1/auth/google/quick-register", { cache: "no-store" })
                .then((response) => readApi<GoogleConfigResponse>(response)),
            fetch("/api/v1/auth/catalog", { cache: "no-store" })
                .then((response) => readApi<EducationCatalogResponse>(response)),
        ])
            .then(([googleResult, catalogResult]) => {
                const preferredStage = catalogResult.data.catalog.stages.find(
                    (stage) => stage.code === "junior_high",
                ) ?? catalogResult.data.catalog.stages[0];
                setClientId(googleResult.data.clientId);
                setRegistration(googleResult.data.registration);
                setCatalog(catalogResult.data.catalog);
                setEducationStage(preferredStage?.code ?? "");
                setGradeCode(preferredStage?.grades[0]?.code ?? "");
                setSemesterCode(catalogResult.data.catalog.semesters[0]?.code ?? "");
            })
            .catch((error) => {
                setMessage(error instanceof Error ? error.message : "目前無法開始 Google 快速註冊。");
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

    const stage = findEducationStage(catalog, educationStage);

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
            const response = await fetch("/api/v1/auth/google/quick-register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "complete",
                    registration: {
                        role,
                        learnerName: role === "learner" ? "" : String(form.get("learnerName") ?? ""),
                        educationStatus,
                        gradeCode: educationStatus === "enrolled" ? gradeCode : null,
                        semesterCode: educationStatus === "enrolled" ? semesterCode : null,
                    },
                }),
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
                    <span>Google 快速註冊</span>
                    <h1 id="quick-register-title">建立 Lerniqa 帳號</h1>
                    <p>先確認 Google 帳號，再補上學習者資料。Lerniqa 不會取得你的 Google Drive、Gmail 或 Calendar 內容。</p>
                </div>

                {loading && <p className={styles.status}>正在載入註冊設定…</p>}
                {!loading && !registration && (
                    <div className={styles.googleStep}>
                        <div ref={googleButton} className={styles.googleButton} aria-label="使用 Google 註冊" />
                        {submitting && <p className={styles.status}>正在驗證 Google 帳號…</p>}
                    </div>
                )}

                {registration && (
                    <form className={styles.form} onSubmit={(event) => void completeRegistration(event)}>
                        <div className={styles.identity}>
                            <strong>{registration.displayName}</strong>
                            <span>{registration.email}</span>
                        </div>
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
                                    <select
                                        onChange={(event) => {
                                            const nextStage = findEducationStage(catalog, event.target.value);
                                            setEducationStage(nextStage?.code ?? "");
                                            setGradeCode(nextStage?.grades[0]?.code ?? "");
                                        }}
                                        value={educationStage}
                                    >
                                        {catalog?.stages.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
                                    </select>
                                </label>
                                <label>
                                    <span>年級</span>
                                    <select onChange={(event) => setGradeCode(event.target.value)} value={gradeCode}>
                                        {stage?.grades.map((grade) => <option key={grade.code} value={grade.code}>{grade.name}</option>)}
                                    </select>
                                </label>
                                <label>
                                    <span>學期</span>
                                    <select onChange={(event) => setSemesterCode(event.target.value)} value={semesterCode}>
                                        {catalog?.semesters.map((semester) => <option key={semester.code} value={semester.code}>{semester.name}</option>)}
                                    </select>
                                </label>
                            </div>
                        )}

                        <Button disabled={submitting} type="submit">
                            <UserPlus aria-hidden="true" />
                            {submitting ? "建立中…" : "建立帳號並登入"}
                        </Button>
                    </form>
                )}

                {message && <p className={styles.error} role="alert">{message}</p>}
                <p className={styles.note}><ShieldCheck aria-hidden="true" />Google 只用來確認身份與電子郵件，不會自動合併既有密碼帳號。</p>
            </section>
        </main>
    );
}
