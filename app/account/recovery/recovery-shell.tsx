import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";

import { LerniqaMark } from "../../components/lerniqa-mark";
import styles from "./recovery.module.css";

interface RecoveryShellProps {
    eyebrow: string;
    title: string;
    description: string;
    icon: LucideIcon;
    children: ReactNode;
}

interface RecoveryStatusProps {
    children: ReactNode;
    tone: "error" | "success" | "warning";
}

export function RecoveryShell({ eyebrow, title, description, icon: Icon, children }: RecoveryShellProps) {
    return (
        <main className={styles.page}>
            <div className={styles.ambient} aria-hidden="true"><span /><span /><span /></div>
            <section className={styles.shell} aria-labelledby="recovery-title">
                <aside className={styles.guide} aria-label="帳號安全說明">
                    <Link className={styles.brand} href="/overview" aria-label="返回 Lerniqa 首頁">
                        <span><LerniqaMark /></span>
                        <strong>Lerniqa</strong>
                    </Link>
                    <div className={styles.guideCopy}>
                        <span className={styles.guideIcon}><Icon aria-hidden="true" /></span>
                        <p>帳號安全</p>
                        <h2>一次性連結，<br />只完成這次變更</h2>
                        <ul>
                            <li><span>01</span>連結有時效且只能使用一次</li>
                            <li><span>02</span>新密碼與 PIN 由你在此頁輸入</li>
                            <li><span>03</span>系統不會在頁面顯示既有憑證</li>
                        </ul>
                    </div>
                </aside>

                <section className={styles.card}>
                    <div className={styles.cardIcon}><Icon aria-hidden="true" /></div>
                    <header className={styles.heading}>
                        <span>{eyebrow}</span>
                        <h1 id="recovery-title">{title}</h1>
                        <p>{description}</p>
                    </header>
                    {children}
                </section>
            </section>
        </main>
    );
}

export function RecoveryStatus({ children, tone }: RecoveryStatusProps) {
    return <p className={styles.status} data-tone={tone} role={tone === "error" ? "alert" : "status"}>{children}</p>;
}

export { styles as recoveryStyles };
