import {
    Badge,
    type BadgeAppearance,
    type BadgeProps,
    type BadgeTone,
} from "@keel-design/ui";

import styles from "./admin-components.module.css";

const STATUS_TONES: Record<string, BadgeTone> = {
    active: "success",
    approved: "success",
    completed: "success",
    published: "success",
    suspended: "danger",
    closed: "danger",
    error: "danger",
    failed: "danger",
    rejected: "danger",
    draft: "warning",
    pending: "warning",
    review: "warning",
    in_review: "warning",
    processing: "info",
    system_admin: "primary",
    superseded: "muted",
    archived: "muted",
    retired: "muted",
    revoked: "muted",
    inactive: "muted",
    changes_requested: "warning",
};

const STATUS_LABELS: Record<string, string> = {
    active: "啟用",
    approved: "已核准",
    completed: "已完成",
    published: "已發布",
    suspended: "已停權",
    closed: "已關閉",
    error: "錯誤",
    failed: "失敗",
    rejected: "已退回",
    draft: "草稿",
    pending: "待處理",
    review: "待審核",
    in_review: "審核中",
    processing: "處理中",
    system_admin: "系統管理員",
    superseded: "已取代",
    archived: "已封存",
    retired: "已停用",
    revoked: "已撤銷",
    inactive: "未啟用",
    changes_requested: "需修改",
};

export type AdminStatusBadgeProps = Omit<
    BadgeProps,
    "children" | "tone" | "appearance"
> & {
    status: string;
    label?: string;
    tone?: BadgeTone;
    appearance?: BadgeAppearance;
};

/** Consistent status presentation with caller-overridable labels and tones. */
export function AdminStatusBadge({
    status,
    label,
    tone,
    appearance = "subtle",
    className,
    ...props
}: AdminStatusBadgeProps) {
    const normalizedStatus = status.trim().toLowerCase();

    return (
        <Badge
            className={[styles.statusBadge, className].filter(Boolean).join(" ")}
            appearance={appearance}
            tone={tone ?? STATUS_TONES[normalizedStatus] ?? "light"}
            {...props}
        >
            {label ?? STATUS_LABELS[normalizedStatus] ?? status}
        </Badge>
    );
}
