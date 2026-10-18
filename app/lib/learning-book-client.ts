import { practiceApi, PracticeApiError } from "./practice-client";
import type {
    LearningBookContent, LearningBookListQuery, LearningBookDto, LearningBookListResult,
    LearningBookDetail, LearningBookScheduleDto,
} from "./learning-book-contract";
export interface LegacyBookMigration {
    learnerId: string; migrationId: string;
    books: Array<LearningBookContent & {
        legacyId: string;
        schedules: Array<{ legacyId: string; scheduledFor: string; hasTime: boolean; timezone: "Asia/Taipei" }>;
    }>;
    unresolvedItems: Array<{ legacyId: string; reason: string }>;
}

export function learningBookQuery(learnerId: string, filters: Partial<LearningBookListQuery> = {}) {
    const query = new URLSearchParams({ learnerId });
    for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null && value !== "") query.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
    return query;
}
export function listLearningBooks(learnerId: string, filters: Partial<LearningBookListQuery> = {}) {
    return practiceApi<LearningBookListResult>(`/api/v1/learning-books?${learningBookQuery(learnerId, filters)}`);
}
export function getLearningBook(learnerId: string, id: string) {
    return practiceApi<LearningBookDetail>(`/api/v1/learning-books/${encodeURIComponent(id)}?${learningBookQuery(learnerId)}`);
}
const pendingMutationKeys = new Map<string, string>();
export async function learningBookMutation<T>(path: string, body: object, method = "POST") {
    const fingerprint = JSON.stringify([method, path, body]);
    const idempotencyKey = "idempotencyKey" in body ? body.idempotencyKey : pendingMutationKeys.get(fingerprint) ?? crypto.randomUUID();
    pendingMutationKeys.set(fingerprint, String(idempotencyKey));
    try {
        const result = await practiceApi<T>(`/api/v1/learning-books${path}`, {
            method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, idempotencyKey }),
        });
        pendingMutationKeys.delete(fingerprint);
        return result;
    }
    catch (failure) {
        if (failure instanceof PracticeApiError && failure.status >= 400 && failure.status < 500 && failure.status !== 429) pendingMutationKeys.delete(fingerprint);
        throw failure;
    }
}
export function createLearningBook(learnerId: string, content: LearningBookContent, publish = true, idempotencyKey = crypto.randomUUID()) {
    return learningBookMutation<LearningBookDto>("", { learnerId, ...content, publish, idempotencyKey });
}
export function listLearningBookSchedules(learnerId: string) {
    return practiceApi<{ schedules: LearningBookScheduleDto[] }>(`/api/v1/learning-books/schedules?${learningBookQuery(learnerId)}`);
}
