import type { ReactNode } from "react";

/**
 * 在每次路由頁面建立時套用一致的進場效果。
 *
 * @param props 目前路由的頁面內容。
 * @returns 套用全站頁面轉場的容器。
 */
export default function Template({ children }: { children: ReactNode }) {
    return <div className="app-page-transition">{children}</div>;
}
