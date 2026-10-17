import {
    Card,
    CardContent,
    Skeleton,
    type CardProps,
} from "@keel-design/ui";
import type { ReactNode } from "react";

import styles from "./admin-components.module.css";

export type AdminMetricCardProps = Omit<CardProps, "children"> & {
    label: ReactNode;
    value: ReactNode;
    detail?: ReactNode;
    icon?: ReactNode;
    loading?: boolean;
};

/** Compact KPI card. Values come from the caller; the component never invents data. */
export function AdminMetricCard({
    label,
    value,
    detail,
    icon,
    loading = false,
    className,
    ...props
}: AdminMetricCardProps) {
    return (
        <Card
            className={[styles.metricCard, className].filter(Boolean).join(" ")}
            {...props}
        >
            <CardContent className={styles.metricContent}>
                <div className={styles.metricBody}>
                    <p className={styles.metricLabel}>{label}</p>
                    {loading ? (
                        <div
                            className={styles.metricLoading}
                            aria-label="正在載入指標"
                            aria-live="polite"
                            role="status"
                        >
                            <Skeleton className="mt-2 h-8 w-24" />
                            <Skeleton className="h-4 w-36" />
                        </div>
                    ) : (
                        <>
                            <p className={styles.metricValue}>{value}</p>
                            {detail ? (
                                <p className={styles.metricDetail}>{detail}</p>
                            ) : null}
                        </>
                    )}
                </div>
                {icon ? (
                    <span className={styles.metricIcon} aria-hidden="true">
                        {icon}
                    </span>
                ) : null}
            </CardContent>
        </Card>
    );
}
