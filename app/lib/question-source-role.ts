export const QUESTION_SOURCE_ROLES = ["auto", "question", "answer", "explanation", "supplement"] as const;

export type QuestionSourceRole = (typeof QUESTION_SOURCE_ROLES)[number];
export type QuestionSourceRoleSource = "pending" | "ai" | "user";

export const QUESTION_SOURCE_ROLE_LABELS: Record<QuestionSourceRole, string> = {
    auto: "由 AI 判斷",
    question: "題目內容",
    answer: "答案頁",
    explanation: "解析頁",
    supplement: "補充圖片",
};

export function isQuestionSourceRole(value: unknown): value is QuestionSourceRole {
    return typeof value === "string" && QUESTION_SOURCE_ROLES.some((role) => role === value);
}
