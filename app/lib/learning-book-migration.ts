import type { LocalPracticeQuestion } from "./local-practice-types";
import type { PracticePreferences } from "./practice-client";
import type { LegacyBookMigration } from "./learning-book-client";

const receiptKey = (learnerId: string) => `lerniqa-learning-book-migration-v1:${learnerId}`;

export function readLearningBookMigrationReceipt(learnerId: string): { migrationId: string; completedAt?: string; result?: unknown } {
    const saved = window.localStorage.getItem(receiptKey(learnerId));
    if (saved) {
        const parsed = JSON.parse(saved) as { migrationId: string; completedAt?: string; result?: unknown };
        if (typeof parsed.migrationId === "string") return parsed;
    }
    const receipt = { migrationId: crypto.randomUUID() };
    window.localStorage.setItem(receiptKey(learnerId), JSON.stringify(receipt));
    return receipt;
}

export function completeLearningBookMigration(learnerId: string, migrationId: string, result: unknown): void {
    window.localStorage.setItem(receiptKey(learnerId), JSON.stringify({ migrationId, completedAt: new Date().toISOString(), result }));
}

/** Numeric route IDs are accepted only when they have a unique loaded server mapping. */
export function previewLearningBookMigration(
    learnerId: string, migrationId: string, preferences: PracticePreferences,
    catalog: ReadonlyMap<number, LocalPracticeQuestion>,
): LegacyBookMigration {
    const books: LegacyBookMigration["books"] = [];
    const unresolvedItems: LegacyBookMigration["unresolvedItems"] = [];
    for (const schedule of preferences.schedules) {
        if (schedule.result) {
            unresolvedItems.push({ legacyId: schedule.id, reason: "本機完成結果缺少可驗證的原始題目版本與作答關聯，保留原資料待核對。" });
            continue;
        }
        const questions = schedule.questionIds.map((id) => catalog.get(id));
        if (!questions.length || questions.some((question) => !question)) {
            unresolvedItems.push({ legacyId: schedule.id, reason: "部分題目無法對應目前已載入的正式題庫，整筆排程保留待處理。" });
            continue;
        }
        const scheduledFor = `${schedule.date}T${schedule.time || "00:00"}:00+08:00`;
        if (!Number.isFinite(Date.parse(scheduledFor))) {
            unresolvedItems.push({ legacyId: schedule.id, reason: "排程日期或時間無法辨識。" });
            continue;
        }
        books.push({
            legacyId: schedule.id, name: `${schedule.subjectLabel} · ${schedule.scopeLabel}`,
            checkMode: schedule.checkMode, filterSnapshot: { legacySource: "browser-schedule", scopeLabel: schedule.scopeLabel },
            questions: questions.map((question) => ({ questionId: question!.id, revisionId: question!.revisionId })),
            schedules: [{ legacyId: schedule.id, scheduledFor, hasTime: Boolean(schedule.time), timezone: "Asia/Taipei" }],
        });
    }
    if (preferences.plan) {
        books.unshift({
            legacyId: "browser-plan", name: `${preferences.plan.subject}學習本計畫`,
            checkMode: preferences.plan.checkMode, filterSnapshot: { ...preferences.plan },
            questions: [], schedules: [],
        });
    }
    return { learnerId, migrationId, books, unresolvedItems };
}
