"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, FormField } from "@keel-design/ui";
import { BookOpen, CheckCircle2, LogIn } from "lucide-react";
import { learningBookMutation } from "../lib/learning-book-client";
import { practiceApi, PracticeApiError, selectPracticeLearner, type PracticeAccount } from "../lib/practice-client";
import "./learning-book-workspace.css";

interface InvitePreview { name: string; sharerName: string; expiresAt: string; redeemed: boolean }

export function LearningBookSharePage({ token }: { token: string }) {
    const router = useRouter();
    const [account, setAccount] = useState<PracticeAccount>();
    const [preview, setPreview] = useState<InvitePreview>();
    const [learnerId, setLearnerId] = useState("");
    const [loading, setLoading] = useState(true);
    const [needsLogin, setNeedsLogin] = useState(false);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [received, setReceived] = useState(false);
    const requestKey = useRef<string | undefined>(undefined);
    const returnPath = `/learning-books/share/${encodeURIComponent(token)}`;

    useEffect(() => {
        let active = true;
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
            setLoading(false); setError("分享網址格式不正確，請向分享者索取新網址。");
            return;
        }
        void (async () => {
            try {
                const [identity, invitation] = await Promise.all([
                    practiceApi<{ account: PracticeAccount }>("/api/v1/auth/me"),
                    practiceApi<InvitePreview>(`/api/v1/learning-books/share?${new URLSearchParams({ token })}`),
                ]);
                if (!active) return;
                setAccount(identity.account); setPreview(invitation);
                const selected = identity.account.learner;
                if (selected) setLearnerId(selected.id);
                else if (identity.account.learners.length === 1) setLearnerId(identity.account.learners[0].id);
            }
            catch (failure) {
                if (!active) return;
                if (failure instanceof PracticeApiError && failure.status === 401) setNeedsLogin(true);
                else setError(failure instanceof Error ? failure.message : "目前無法讀取分享邀請。");
            }
            finally { if (active) setLoading(false); }
        })();
        return () => { active = false; };
    }, [token]);

    async function redeem() {
        if (!learnerId || busy) return;
        setBusy(true); setError("");
        requestKey.current ??= crypto.randomUUID();
        try {
            await learningBookMutation("/share/redeem", { learnerId, token, idempotencyKey: requestKey.current });
            requestKey.current = undefined; setReceived(true);
        }
        catch (failure) { setError(failure instanceof Error ? failure.message : "領取未完成，請重試。"); }
        finally { setBusy(false); }
    }

    return <main className="learning-book-share-page"><Link href="/overview" aria-label="Lerniqa 首頁"><BookOpen size={32} /></Link><h1>領取學習本計畫</h1>
        {loading && <p role="status">正在確認分享邀請…</p>}
        {error && <p role="alert" className="learning-book-message learning-book-error">{error}</p>}
        {needsLogin && <><p>登入後選擇你有權管理的學習者，即可領取這份學習本。每個分享網址只能領取一次。</p><Button asChild><Link href={`/account?returnTo=${encodeURIComponent(returnPath)}`}><LogIn />登入並返回領取</Link></Button></>}
        {received && <><p className="learning-book-message" role="status"><CheckCircle2 />已領取學習本，可從學習本清單安排或開始練習。</p><Button disabled={busy} onClick={async () => { setBusy(true); try { await selectPracticeLearner(learnerId); router.push("/practice/schedules"); } catch (failure) { setError(failure instanceof Error ? failure.message : "無法切換學習者。"); setBusy(false); } }}>前往學習本計畫</Button></>}
        {preview && account && !received && <Card><CardContent className="learning-book-detail" style={{ padding: "1.5rem" }}><h2>{preview.name}</h2><p>分享者：{preview.sharerName}</p><p>有效至 {new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(new Date(preview.expiresAt))}</p>
            <p>領取後會接收來源已發布的更新。你安排的練習與作答保留當時版本；分享者不會因此取得你的作答或成績權限。</p>
            {preview.redeemed && <p className="learning-book-message">此邀請已領取。如先前領取尚未完成，可使用原帳號與學習者再次確認。</p>}
            {account.learners.length ? <form onSubmit={(event) => { event.preventDefault(); void redeem(); }}><FormField label="領取的學習者"><select className="learning-book-select" value={learnerId} disabled={busy} onChange={(event) => { setLearnerId(event.target.value); requestKey.current = undefined; }}><option value="">請選擇學習者</option>{account.learners.map((learner) => <option key={learner.id} value={learner.id}>{learner.displayName}</option>)}</select></FormField><Button type="submit" disabled={busy || !learnerId}>{busy ? "領取中…" : "確認領取"}</Button></form> : <p>此帳號尚未具有可用的學習者，請先到<Link href="/system-settings">系統設定</Link>建立或取得學習者存取權，再回到此網址領取。</p>}
        </CardContent></Card>}
    </main>;
}
