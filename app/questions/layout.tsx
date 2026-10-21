import type { ReactNode } from "react";
import { QuestionImportWorkspace } from "./new/question-import-workspace";

/**
 * 在題目建立與草稿路由之間保留同一份尚未送出的工作區狀態。
 *
 * @param props 題目路由的子頁面。
 * @returns 共用題目工作區與目前子頁面。
 */
export default function QuestionsLayout({ children }: { children: ReactNode }) {
    return <><QuestionImportWorkspace />{children}</>;
}
