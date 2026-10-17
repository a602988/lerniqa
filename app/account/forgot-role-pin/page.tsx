"use client";

import { Button } from "@keel-design/ui";
import { ArrowLeft, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { readApiError } from "../recovery/recovery-client";
import { RecoveryShell, RecoveryStatus, recoveryStyles as styles } from "../recovery/recovery-shell";

type AdultRole = "parent" | "tutor";

interface AccountResponse {
    data: {
        account: {
            roles: string[];
        };
    };
}

const ROLE_COPY: Record<AdultRole, { label: string; detail: string }> = {
    parent: { label: "家長 PIN", detail: "設定或重設家長角色的六位數 PIN" },
    tutor: { label: "家教 PIN", detail: "設定或重設一對一家教角色的六位數 PIN" },
};

export default function ForgotRolePinPage() {
    const [roles, setRoles] = useState<AdultRole[]>([]);
    const [targetRole, setTargetRole] = useState<AdultRole | "">("");
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [accepted, setAccepted] = useState(false);
    const [needsLogin, setNeedsLogin] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        void fetch("/api/v1/auth/me", { cache: "no-store" })
            .then(async (response) => {
                if (response.status === 401) {
                    setNeedsLogin(true);
                    return;
                }
                if (!response.ok) throw await readApiError(response, "目前無法讀取帳號角色。");
                const result = await response.json() as AccountResponse;
                const available = result.data.account.roles.filter(
                    (role): role is AdultRole => role === "parent" || role === "tutor",
                );
                setRoles(available);
                setTargetRole(available[0] ?? "");
            })
            .catch((caught) => setError(caught instanceof Error ? caught.message : "目前無法讀取帳號角色。"))
            .finally(() => setLoading(false));
    }, []);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!targetRole || submitting) return;
        setSubmitting(true);
        setError("");
        try {
            const response = await fetch("/api/v1/auth/role-pin-reset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ targetRole }),
            });
            if (response.status === 401) {
                setNeedsLogin(true);
                return;
            }
            if (!response.ok) throw await readApiError(response, "目前無法受理角色 PIN 設定要求。");
            setAccepted(true);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : "目前無法受理角色 PIN 設定要求。");
        }
        finally {
            setSubmitting(false);
        }
    }

    return (
        <RecoveryShell
            description="這個流程只設定或重設角色 PIN。正式切換到家長或家教模式時，目前仍會要求帳號密碼。"
            eyebrow="角色 PIN"
            icon={ShieldCheck}
            title="設定或重設角色 PIN"
        >
            {loading ? (
                <p className={styles.loading} role="status"><LoaderCircle aria-hidden="true" />正在讀取可設定的角色…</p>
            ) : needsLogin ? (
                <div className={styles.content}>
                    <RecoveryStatus tone="warning">請先登入帳號，再設定或重設家長／家教角色 PIN。</RecoveryStatus>
                    <Button asChild><Link href="/account">前往登入</Link></Button>
                </div>
            ) : accepted ? (
                <div className={styles.content}>
                    <RecoveryStatus tone="success">要求已受理。請檢查帳號信箱是否收到一次性設定連結；連結有時效且只能使用一次。</RecoveryStatus>
                    <p className={styles.note}>角色 PIN 不會取代目前切換角色時使用的帳號密碼。</p>
                    <Button asChild appearance="outline"><Link href="/account"><ArrowLeft aria-hidden="true" />返回帳號中心</Link></Button>
                </div>
            ) : roles.length === 0 ? (
                <div className={styles.content}>
                    <RecoveryStatus tone="warning">此帳號目前沒有可設定 PIN 的家長或家教角色。</RecoveryStatus>
                    <Button asChild appearance="outline"><Link href="/account"><ArrowLeft aria-hidden="true" />返回帳號中心</Link></Button>
                </div>
            ) : (
                <form className={styles.form} onSubmit={(event) => void submit(event)}>
                    <fieldset className={styles.roleChoices}>
                        <legend>選擇要設定的角色</legend>
                        {roles.map((role) => (
                            <label className={styles.roleChoice} key={role}>
                                <input
                                    checked={targetRole === role}
                                    name="targetRole"
                                    onChange={() => setTargetRole(role)}
                                    type="radio"
                                    value={role}
                                />
                                <span><strong>{ROLE_COPY[role].label}</strong><small>{ROLE_COPY[role].detail}</small></span>
                            </label>
                        ))}
                    </fieldset>
                    {error && <RecoveryStatus tone="error">{error}</RecoveryStatus>}
                    <Button disabled={submitting || !targetRole} type="submit">
                        <Mail aria-hidden="true" />{submitting ? "正在送出…" : "取得設定連結"}
                    </Button>
                    <Link className={styles.textLink} href="/account"><ArrowLeft aria-hidden="true" />返回帳號中心</Link>
                </form>
            )}
        </RecoveryShell>
    );
}
