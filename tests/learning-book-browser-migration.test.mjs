import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/lib/learning-book-migration.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const migration = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
const workspaceSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const question = { id: "10000000-0000-4000-8000-000000000001", revisionId: "20000000-0000-4000-8000-000000000001" };
const settings = { subject: "國語", checkMode: "complete", questionLimit: 15, metadataFilters: { cognitive_dimension: ["基本語文知識"] }, search: "論語" };
const schedule = { id: "legacy-1", subjectLabel: "國語", scopeLabel: "第四課", date: "2026-10-18", time: "13:30", checkMode: "complete", questionIds: [91] };

test("migration preserves exact dynamic filters without inventing fixed question targets", () => {
    const result = migration.previewLearningBookMigration("learner-1", "migration-1", { plan: settings, schedules: [] }, new Map());
    assert.equal(result.books.length, 1);
    assert.deepEqual(result.books[0].questions, []);
    assert.deepEqual(result.books[0].filterSnapshot, settings);
    assert.deepEqual(result.books[0].schedules, []);
    assert.equal(result.unresolvedItems.length, 0);
});

test("fixed schedules require every route ID and retain explicit revision and timezone", () => {
    const catalog = new Map([[91, question]]);
    const result = migration.previewLearningBookMigration("learner-1", "migration-1", { plan: null, schedules: [schedule, { ...schedule, id: "missing", questionIds: [91, 92] }] }, catalog);
    assert.equal(result.books.length, 1);
    assert.deepEqual(result.books[0].questions, [{ questionId: question.id, revisionId: question.revisionId }]);
    assert.equal(result.books[0].schedules[0].scheduledFor, "2026-10-18T13:30:00+08:00");
    assert.equal(result.unresolvedItems.length, 1);
    assert.equal(result.unresolvedItems[0].legacyId, "missing");
});

test("unverifiable completed results are held instead of rewritten into new attempts", () => {
    const result = migration.previewLearningBookMigration("learner-1", "migration-1", { plan: null, schedules: [{ ...schedule, result: { accuracy: 100 } }] }, new Map([[91, question]]));
    assert.equal(result.books.length, 0);
    assert.equal(result.unresolvedItems.length, 1);
    assert.match(result.unresolvedItems[0].reason, /原始題目版本/u);
});

test("migration receipt uses a stable key and preserves report for network retries", () => {
    const originalWindow = globalThis.window;
    const storage = new Map();
    globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
    try {
        const first = migration.readLearningBookMigrationReceipt("learner-1");
        assert.deepEqual(migration.readLearningBookMigrationReceipt("learner-1"), first);
        assert.notEqual(migration.readLearningBookMigrationReceipt("learner-2").migrationId, first.migrationId);
        const report = { importedBooks: 1, importedSchedules: 1, unresolvedItems: [] };
        migration.completeLearningBookMigration("learner-1", first.migrationId, report);
        const complete = migration.readLearningBookMigrationReceipt("learner-1");
        assert.equal(complete.migrationId, first.migrationId);
        assert.ok(complete.completedAt);
        assert.deepEqual(complete.result, report);
    }
    finally { globalThis.window = originalWindow; }
});

async function loadClient(api) {
    const clientSource = await readFile(new URL("../app/lib/learning-book-client.ts", import.meta.url), "utf8");
    const stub = `export const practiceApi = globalThis.__learningBookTestApi; export class PracticeApiError extends Error { constructor(status) { super("request failed"); this.status = status; } }`;
    const stubUrl = `data:text/javascript;base64,${Buffer.from(stub).toString("base64")}#${crypto.randomUUID()}`;
    const compiled = ts.transpileModule(clientSource.replace('"./practice-client"', JSON.stringify(stubUrl)), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    globalThis.__learningBookTestApi = api;
    try { return await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}#${crypto.randomUUID()}`); }
    finally { delete globalThis.__learningBookTestApi; }
}

test("mutation retries reuse a receipt key, while a later intentional action gets a new key", async () => {
    const calls = [];
    let fail = true;
    const client = await loadClient(async (url, init) => {
        calls.push({ url, ...init, body: JSON.parse(init.body) });
        if (fail) { fail = false; throw new Error("network interrupted"); }
        return { ok: true };
    });
    const body = { learnerId: "learner-1", action: "archive" };
    await assert.rejects(client.learningBookMutation("/book-1", body, "PATCH"), /network interrupted/);
    await client.learningBookMutation("/book-1", body, "PATCH");
    await client.learningBookMutation("/book-1", body, "PATCH");
    assert.equal(calls[0].body.idempotencyKey, calls[1].body.idempotencyKey);
    assert.notEqual(calls[1].body.idempotencyKey, calls[2].body.idempotencyKey);
    assert.equal(calls[0].method, "PATCH");
});

test("explicit mutation receipts survive PATCH and DELETE serialization", async () => {
    const calls = [];
    const client = await loadClient(async (_url, init) => { calls.push({ ...init, body: JSON.parse(init.body) }); return {}; });
    const idempotencyKey = crypto.randomUUID();
    await client.learningBookMutation("/schedules", { learnerId: "learner-1", idempotencyKey, status: "cancelled" }, "PATCH");
    await client.learningBookMutation("/book-1/share", { learnerId: "learner-1", idempotencyKey, inviteId: "invite-1" }, "DELETE");
    assert.deepEqual(calls.map((call) => call.body.idempotencyKey), [idempotencyKey, idempotencyKey]);
    assert.deepEqual(calls.map((call) => call.method), ["PATCH", "DELETE"]);
});

test("list filters preserve opaque cursor and omit the first-page null cursor", async () => {
    const client = await loadClient(async () => ({}));
    const query = client.learningBookQuery("learner-1", { creatorIds: ["a", "b"], sharerIds: [], cursor: "opaque+/cursor=", sync: "updated" });
    assert.equal(query.get("creatorIds"), "a,b");
    assert.equal(query.get("cursor"), "opaque+/cursor=");
    assert.equal(query.get("sync"), "updated");
    assert.equal(client.learningBookQuery("learner-1", { cursor: null }).has("cursor"), false);
});

test("the learning-book route remains reachable before a learner has any questions", () => {
    const scheduleRouteGuard = workspaceSource.indexOf("if (browserPath === PRACTICE_SCHEDULES_PATH)");
    const emptyQuestionGuard = workspaceSource.indexOf("if (!sessionDisplayQuestions.length) return;", scheduleRouteGuard);
    assert.ok(scheduleRouteGuard >= 0);
    assert.ok(emptyQuestionGuard > scheduleRouteGuard, "the schedule route must be handled before the empty-question guard");
    assert.match(workspaceSource, /async function openScheduleList\(\)[\s\S]*?setSection\("practice"\);[\s\S]*?router\.push\(PRACTICE_SCHEDULES_PATH\);/u);
});
