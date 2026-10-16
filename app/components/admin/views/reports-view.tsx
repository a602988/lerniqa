import type { CSSProperties } from "react";

import { AdminNotice } from "../admin-notice";
import { AdminPage } from "../admin-page";
import type {
    ReportMetricGroupDto,
    ReportsViewProps,
    ReportSeriesDto,
} from "./view-types";
import {
    ViewFilters,
    ViewLoadNotice,
    ViewMetricGrid,
    ViewSection,
    formatMetricValue,
} from "./view-shared";

import styles from "./views.module.css";

function validBarPercent(value: number | null): number | null {
    return value !== null && Number.isFinite(value) && value >= 0 && value <= 100
        ? value
        : null;
}

function ReportSeries({ series }: { series: ReportSeriesDto }) {
    return (
        <ViewSection title={series.title} description={series.description}>
            {series.summary ? (
                <div className={styles.reportSeriesSummary}>
                    <ViewMetricGrid metrics={[series.summary]} />
                </div>
            ) : null}
            {series.rows.length === 0 ? (
                <AdminNotice tone="muted">無資料</AdminNotice>
            ) : (
                <div className={styles.seriesLayout}>
                    <div
                        className={styles.barChart}
                        role="img"
                        aria-label={`${series.title}長條圖`}
                    >
                        {series.rows.map((row) => {
                            const percent = validBarPercent(row.barPercent);
                            return (
                                <div className={styles.barRow} key={row.key}>
                                    <span className={styles.barLabel}>{row.label}</span>
                                    <span className={styles.barTrack} aria-hidden="true">
                                        {percent === null ? null : (
                                            <span
                                                className={styles.barFill}
                                                style={
                                                    {
                                                        "--report-bar-percent": `${percent}%`,
                                                    } as CSSProperties
                                                }
                                            />
                                        )}
                                    </span>
                                    <strong>{formatMetricValue(row.value)}</strong>
                                </div>
                            );
                        })}
                    </div>

                    <div className={styles.reportTableViewport}>
                        <table className={styles.reportTable}>
                            <caption>{series.title}資料表</caption>
                            <thead>
                                <tr>
                                    <th scope="col">分類</th>
                                    <th scope="col">數值</th>
                                </tr>
                            </thead>
                            <tbody>
                                {series.rows.map((row) => (
                                    <tr key={row.key}>
                                        <th scope="row">{row.label}</th>
                                        <td>{formatMetricValue(row.value)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </ViewSection>
    );
}

function MetricGroup({ group }: { group: ReportMetricGroupDto }) {
    return (
        <ViewSection title={group.title} description={group.description}>
            <ViewMetricGrid metrics={group.metrics} />
        </ViewSection>
    );
}

export function ReportsView({
    state,
    filters,
    periodLabel,
    timeZone,
    startLocalDate,
    endLocalDate,
    generatedAt,
    granularityLabel,
    privacyPolicyNotice,
    registrationTrend,
    accountStatusDistribution,
    activeRoleDistribution,
    gradeDistribution,
    region,
    activity,
    completion,
    questionQuality,
}: ReportsViewProps) {
    return (
        <AdminPage
            title="管理報表"
            eyebrow="Reports"
            description="所有期間統計以臺北時區分組，缺值、空查詢、真實零與隱私抑制各自保留其語意。"
        >
            <div className={styles.viewStack}>
                <ViewFilters filters={filters} />

                <AdminNotice title={`統計期間：${periodLabel}`} tone="info">
                    時區：{timeZone}；實際日期：{startLocalDate} 至 {endLocalDate}；
                    趨勢粒度：{granularityLabel}。日期範圍包含開始日，並以下一日零時作為不包含的查詢上界。
                    資料產生時間：{generatedAt ?? "尚未產生"}。
                </AdminNotice>

                {privacyPolicyNotice ? (
                    <AdminNotice
                        title={privacyPolicyNotice.title}
                        tone={privacyPolicyNotice.tone}
                    >
                        {privacyPolicyNotice.message}
                    </AdminNotice>
                ) : null}

                <ViewLoadNotice state={state} />

                {state.kind === "ready" ? (
                    <>
                        <div className={styles.twoColumnGrid}>
                            <ReportSeries series={registrationTrend} />
                            <ReportSeries series={gradeDistribution} />
                        </div>

                        <div className={styles.twoColumnGrid}>
                            <ReportSeries series={accountStatusDistribution} />
                            <ReportSeries series={activeRoleDistribution} />
                        </div>

                        <ViewSection
                            title="學習者地區分布"
                            description="目前資料模型沒有可用的地區欄位，且不從學校名稱推測。"
                        >
                            <AdminNotice title="無資料（尚未蒐集）" tone="muted">
                                {region.reason}
                            </AdminNotice>
                        </ViewSection>

                        <MetricGroup group={activity} />
                        <MetricGroup group={completion} />
                        <MetricGroup group={questionQuality} />
                    </>
                ) : null}
            </div>
        </AdminPage>
    );
}
