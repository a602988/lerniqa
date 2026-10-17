import type { QuestionRevisionDto } from "./view-types";

export const EDITABLE_TEXT_CONTENT_TYPES = new Set([
    "text",
    "transcript",
    "formula",
    "table",
]);

export interface QuestionDraftContentPatch {
    textBlocks: Array<{ blockId: string; textContent: string }>;
    answers: Array<{
        answerId: string;
        answerKey: string | null;
        acceptedValue: string | null;
    }>;
}

function normalizedContent(value: string): string {
    return value.normalize("NFKC").trim();
}

/** Includes the route target and operation so retries never cross revisions. */
export function questionMutationRetryIdentity(
    url: string,
    serializedBody: string,
): string {
    return `${url}\u0000${serializedBody}`;
}

/** Builds a sparse patch so an unchanged form cannot create a duplicate revision. */
export function buildQuestionDraftContentPatch(
    revision: QuestionRevisionDto,
    readField: (name: string) => string,
): QuestionDraftContentPatch {
    const textBlocks = revision.contentBlocks
        .filter((block) => EDITABLE_TEXT_CONTENT_TYPES.has(block.contentType))
        .flatMap((block) => {
            const next = readField(`block:${block.id}`);
            const previous = block.textContent ?? "";
            return normalizedContent(next) === normalizedContent(previous)
                ? []
                : [{ blockId: block.id, textContent: next }];
        });
    const answers: QuestionDraftContentPatch["answers"] = [];
    for (const part of revision.parts) {
        for (const answer of part.answers) {
            const next = readField(`answer:${answer.id}`);
            if (part.answerMode === "text") {
                if (normalizedContent(next) !== normalizedContent(answer.acceptedValue ?? "")) {
                    answers.push({
                        answerId: answer.id,
                        answerKey: null,
                        acceptedValue: next,
                    });
                }
            }
            else if (next !== (answer.answerKey ?? "")) {
                answers.push({
                    answerId: answer.id,
                    answerKey: next,
                    acceptedValue: null,
                });
            }
        }
    }
    return { textBlocks, answers };
}
