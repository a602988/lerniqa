export interface SubjectProgressQuestion {
    id: number;
    subject: string;
    unit: string;
}

export interface SubjectProgressAttempt {
    questionId: number;
    correct: boolean | null;
}

export interface UnitProgress {
    unit: string;
    answered: number;
    correct: number;
    total: number;
    value: number;
}

export interface SubjectUnitProgress {
    subject: string;
    units: UnitProgress[];
}

/** 依題庫中的科目與單元順序，整理每科各單元的最新作答進度。 */
export function getSubjectUnitProgress(
    questions: readonly SubjectProgressQuestion[],
    latestAttempts: readonly SubjectProgressAttempt[],
): SubjectUnitProgress[] {
    const attemptsByQuestionId = new Map(
        latestAttempts.map((attempt) => [attempt.questionId, attempt]),
    );
    const progressBySubject = new Map<string, Map<string, Omit<UnitProgress, "value">>>();

    for (const question of questions) {
        const progressByUnit = progressBySubject.get(question.subject) ?? new Map();
        const progress = progressByUnit.get(question.unit) ?? {
            unit: question.unit,
            answered: 0,
            correct: 0,
            total: 0,
        };
        const attempt = attemptsByQuestionId.get(question.id);

        progress.total += 1;
        if (attempt) progress.answered += 1;
        if (attempt?.correct === true) progress.correct += 1;
        progressByUnit.set(question.unit, progress);
        progressBySubject.set(question.subject, progressByUnit);
    }

    return [...progressBySubject.entries()].map(([subject, progressByUnit]) => ({
        subject,
        units: [...progressByUnit.values()].map((progress) => ({
            ...progress,
            value: Math.round(progress.answered / progress.total * 100),
        })),
    }));
}
