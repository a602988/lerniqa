import {
    Alert,
    type AlertAppearance,
    type AlertProps,
    type AlertTone,
} from "@keel-design/ui";
import type { ReactNode } from "react";

import styles from "./admin-components.module.css";

export type AdminNoticeProps = Omit<
    AlertProps,
    | "appearance"
    | "aria-live"
    | "children"
    | "description"
    | "messageTitle"
    | "role"
    | "tone"
> & {
    title?: ReactNode;
    children: ReactNode;
    actions?: ReactNode;
    actionsLabel?: string;
    tone?: AlertTone;
    appearance?: AlertAppearance;
    /** Announce a notice that was added or changed after the page loaded. */
    live?: "off" | "polite" | "assertive";
    /** Override the derived ARIA role. Static notices default to `note`. */
    role?: AlertProps["role"];
};

/**
 * Admin feedback block for explanatory, success, warning, and error states.
 * Static notices are notes, not live regions; opt into announcements with `live`.
 */
export function AdminNotice({
    title,
    children,
    actions,
    actionsLabel = "提示操作",
    tone = "info",
    appearance = "label",
    live,
    role,
    className,
    ...props
}: AdminNoticeProps) {
    const resolvedRole =
        role ??
        (live === "assertive"
            ? "alert"
            : live === "polite"
              ? "status"
              : "note");

    return (
        <Alert
            className={[styles.notice, className].filter(Boolean).join(" ")}
            appearance={appearance}
            tone={tone}
            messageTitle={title}
            role={resolvedRole}
            aria-live={live}
            {...props}
        >
            <div className={styles.noticeBody}>{children}</div>
            {actions ? (
                <div
                    className={styles.noticeActions}
                    role="group"
                    aria-label={actionsLabel}
                >
                    {actions}
                </div>
            ) : null}
        </Alert>
    );
}
