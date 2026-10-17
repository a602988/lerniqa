import { Button } from "@keel-design/ui";

import { AdminNotice } from "../admin-notice";
import { AdminPage } from "../admin-page";
import type { DashboardViewProps } from "./view-types";
import {
    ViewLoadNotice,
    ViewMetricGrid,
    ViewSection,
} from "./view-shared";

import styles from "./views.module.css";

export function DashboardView({
    state,
    metrics,
    notices = [],
    activity,
    quickLinks = [],
}: DashboardViewProps) {
    return (
        <AdminPage
            title="管理總覽"
            eyebrow="Administration"
            description="以實際資料檢視帳號、題庫、學習活動與管理工作；未取得的資料不會以示意數字補齊。"
        >
            <div className={styles.viewStack}>
                <ViewLoadNotice state={state} />

                {state.kind === "ready" ? (
                    <>
                        {notices.map((notice) => (
                            <AdminNotice
                                key={notice.key}
                                title={notice.title}
                                tone={notice.tone ?? "info"}
                            >
                                {notice.message}
                            </AdminNotice>
                        ))}

                        <ViewMetricGrid metrics={metrics} />

                        <div className={styles.twoColumnGrid}>
                            <ViewSection
                                title="近期管理活動"
                                description="時間與內容均由稽核或管理資料來源提供。"
                            >
                                {activity.length === 0 ? (
                                    <AdminNotice tone="muted">無資料</AdminNotice>
                                ) : (
                                    <ol className={styles.activityList}>
                                        {activity.map((item) => (
                                            <li key={item.id} className={styles.activityItem}>
                                                <div className={styles.activityCopy}>
                                                    {item.href ? (
                                                        <a href={item.href}>{item.title}</a>
                                                    ) : (
                                                        <strong>{item.title}</strong>
                                                    )}
                                                    {item.description ? (
                                                        <p>{item.description}</p>
                                                    ) : null}
                                                </div>
                                                <time dateTime={item.occurredAtIso}>
                                                    {item.occurredAt}
                                                </time>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </ViewSection>

                            <ViewSection
                                title="常用入口"
                                description="依管理任務前往各項資料頁。"
                            >
                                {quickLinks.length === 0 ? (
                                    <AdminNotice tone="muted">無可用入口</AdminNotice>
                                ) : (
                                    <div className={styles.quickLinkList}>
                                        {quickLinks.map((link) => (
                                            <div className={styles.quickLinkItem} key={link.href}>
                                                <div>
                                                    <strong>{link.label}</strong>
                                                    {link.description ? (
                                                        <p>{link.description}</p>
                                                    ) : null}
                                                </div>
                                                <Button asChild appearance="outline" tone="primary">
                                                    <a href={link.href}>開啟</a>
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </ViewSection>
                        </div>
                    </>
                ) : null}
            </div>
        </AdminPage>
    );
}
