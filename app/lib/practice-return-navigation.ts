export type PracticeReturnTarget =
    | { kind: "question"; questionId: number }
    | { kind: "section"; section: "practice" | "mistakes" };

export interface PracticeReturnDestination {
    section: "questions" | "practice" | "mistakes";
    path: string;
}

/** Resolves where the learner should land after leaving a practice session. */
export function resolvePracticeReturnDestination(
    target: PracticeReturnTarget | undefined,
    mode: "practice" | "review" | "similar",
): PracticeReturnDestination {
    if (target?.kind === "question") {
        return { section: "questions", path: `/questions/${target.questionId}` };
    }
    const section = target?.kind === "section"
        ? target.section
        : mode === "practice" ? "practice" : "mistakes";
    return { section, path: `/${section}` };
}
