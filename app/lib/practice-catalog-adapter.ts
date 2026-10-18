import type { Attempt, Question } from "./demo-data";
import type { LocalPracticeAnswerInput, LocalPracticeAttempt, LocalPracticeQuestion } from "./local-practice-types";
import { normalizeQuestionSourceCategory } from "./question-filters";
import { normalizeSubjectLabel } from "./subject-labels";
import { mathFormulaSearchText } from "./math-formula";

/** Stable, safe numeric route key; the UUID remains the server's authoritative ID. */
export function practiceRouteId(id: string): number {
    return Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);
}

/** Hides the import document hash while preserving the publisher's visible number. */
export function publisherQuestionNumber(code: string | null): string | undefined {
    if (!code) return undefined;
    const match = code.match(/^[0-9a-f]{16}:(.+)$/iu);
    return (match?.[1] ?? code).trim() || undefined;
}

/** Projects public content into existing catalog filters. No accepted answers are available here. */
export function adaptPracticeQuestion(question: LocalPracticeQuestion): Question {
    const mode = question.parts[0]?.answerMode;
    const difficulty = question.difficulty?.name;
    const knowledge = question.knowledgePoints?.find((point) => point.isPrimary)?.name
        ?? question.knowledgePoints?.[0]?.name
        ?? "";
    const sourceMetadata = question.metadata?.find((field) => field.key === "source_category");
    const sourceCategory = normalizeQuestionSourceCategory(
        question.sourceCategory?.name ?? sourceMetadata?.rawValue ?? "題庫題目",
    );
    const formulaSearchText = [
        ...question.promptBlocks,
        ...question.parts.flatMap((part) => [
            ...part.promptBlocks,
            ...part.options.flatMap((option) => option.contentBlocks),
        ]),
    ].flatMap((block) => block.contentType === "formula" && block.text
        ? [mathFormulaSearchText(block.text)]
        : []).join(" ");
    return {
        id: practiceRouteId(question.id),
        code: publisherQuestionNumber(question.code),
        subject: normalizeSubjectLabel(question.subject.name),
        grade: question.grade.name,
        semester: question.semester?.name,
        bookVersion: question.publisher?.name.replace(/版$/u, "") ?? question.bookVersion.name,
        chapter: "第一冊",
        unit: `第一冊 · ${question.unit.name}`,
        knowledge,
        difficulty: difficulty === "易" || difficulty === "基礎" ? "基礎" : difficulty === "難" || difficulty === "進階" ? "進階" : "中等",
        kind: question.parts.length > 1 || mode === "multiple_choice" ? "multi-choice" : mode === "text" ? "written" : mode === "boolean" ? "boolean" : "choice",
        typeLabel: question.originalTypeLabel?.trim() || question.type.name,
        prompt: question.prompt,
        searchText: formulaSearchText,
        options: question.parts.length === 1 ? question.parts[0].options.map((option) => option.label) : undefined,
        parts: question.parts.map((part) => ({ id: part.id, prompt: part.prompt, options: part.options.map((option) => option.label), answer: "" })),
        answer: "",
        explanation: "判分由伺服器完成；參考答案尚未提供查閱。",
        source: sourceCategory,
        sourceCategory,
        metadata: question.metadata?.map((field) => ({
            ...field,
            values: [...field.values],
            confidence: field.confidence ?? 1,
        })) ?? [],
    };
}

export function formatPracticeResponse(question: LocalPracticeQuestion, answer: string): string {
    const values = new Map(parsePracticeAnswers(answer).map((entry) => [entry.partId, entry.value]));
    if (!values.size) return answer;
    return question.parts.filter((part) => values.has(part.id)).map((part) => {
        const value = values.get(part.id)!;
        const label = (key: string) => part.options.find((option) => option.key === key)?.label ?? key;
        return Array.isArray(value) ? value.map(label).join("、") : label(value);
    }).join("；");
}

export function adaptPracticeAttempt(attempt: LocalPracticeAttempt, answer = "已保存的作答"): Attempt {
    const handwriting = attempt.parts
        .flatMap((part) => part.handwritingAssets ?? [])
        .find((asset) => asset.mimeType === "image/png")?.url;
    return {
        sessionId: attempt.sessionId,
        sessionItemId: attempt.sessionItemId,
        sessionMode: attempt.sessionMode ?? "practice",
        questionId: practiceRouteId(attempt.questionId),
        revisionId: attempt.revisionId,
        answer,
        correct: attempt.overallResult === "pending" ? null : attempt.overallResult === "correct",
        partResults: attempt.parts.flatMap((part) => part.result === "pending" ? [] : [{
            partId: part.partId,
            answer: "",
            correct: part.result === "correct",
        }]),
        date: attempt.submittedAt,
        durationSeconds: attempt.durationSeconds ?? 0,
        ...(handwriting ? { handwriting } : {}),
        recognizedAnswers: Object.fromEntries(attempt.parts.flatMap((part) => (
            part.recognizedText ? [[part.partId, part.recognizedText] as const] : []
        ))),
        referenceAnswers: attempt.referenceAnswers,
    };
}

/** The UI stores only the learner's entered values, keyed by the public part UUID. */
export function parsePracticeAnswers(answer: string): LocalPracticeAnswerInput[] {
    try {
        const values: unknown = JSON.parse(answer);
        if (!values || typeof values !== "object" || Array.isArray(values)) return [];
        return Object.entries(values).flatMap(([partId, value]) =>
            typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string"))
                ? [{ partId, value }]
                : []);
    }
    catch {
        return [];
    }
}
