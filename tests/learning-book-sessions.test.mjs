import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const actor = { userId: "10000000-0000-4000-8000-000000000001", learnerId: "20000000-0000-4000-8000-000000000001" };
const ids = {
    plan: "30000000-0000-4000-8000-000000000001",
    revision: "40000000-0000-4000-8000-000000000001",
    schedule: "50000000-0000-4000-8000-000000000001",
    subscription: "60000000-0000-4000-8000-000000000001",
    question: "70000000-0000-4000-8000-000000000001",
    questionRevision: "80000000-0000-4000-8000-000000000001",
    session: "90000000-0000-4000-8000-000000000001",
};

async function load(relativePath, dependencies) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    const javascript = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(javascript, {
        module, exports: module.exports, console, URL, URLSearchParams,
        require: (name) => name.startsWith("node:") ? require(name) : dependencies[name] ?? {},
    });
    return module.exports;
}

async function storeWith(options = {}) {
    const calls = [];
    let session = options.existing ?? null;
    const item = { id: "item", question_id: ids.question, question_revision_id: ids.questionRevision, question_part_id: null, position: 0, answered: false };
    const resolved = {
        practice_plan_id: options.subscription ? null : ids.plan,
        practice_plan_revision_id: ids.revision,
        practice_plan_subscription_id: options.subscription ? ids.subscription : null,
        check_mode: options.checkMode ?? "instant",
        status: options.scheduleStatus ?? "scheduled",
    };
    const client = { query: async (sql, values = []) => {
        calls.push({ sql, values });
        if (sql.includes("FROM practice_sessions AS session") && sql.includes("asset.id = $4")) return { rows: options.noAsset ? [] : [{
            id: ids.question, storage_key: "synthetic/pinned.png", mime_type: "image/png", byte_size: "12", checksum: "hash",
        }] };
        if (sql.includes("FROM learner_access")) return { rows: options.noAccess ? [] : [{ id: "access" }] };
        if (sql.includes("SELECT *, practice_plan_subscription_id")) return { rows: session ? [session] : [] };
        if (sql.includes("FROM practice_schedules WHERE")) return { rows: options.missingSchedule ? [] : [resolved] };
        if (sql.includes("FROM practice_sessions WHERE practice_schedule_id")) return { rows: options.scheduleSession ? [options.scheduleSession] : [] };
        if (sql.includes("SELECT revision.id\n")) return { rows: options.revoked ? [] : [{ id: ids.revision }] };
        if (sql.includes("FROM practice_plans AS plan") || sql.includes("FROM practice_plan_subscriptions AS subscription")) {
            return { rows: options.unavailable ? [] : [resolved] };
        }
        if (sql.includes("FROM practice_plan_revision_items") || sql.includes("FROM practice_schedule_items")) return { rows: options.items ?? [item] };
        if (sql.includes("SELECT requested.question_id")) return { rows: options.invalidItems ? [] : [{ question_id: ids.question }] };
        if (sql.includes("INSERT INTO practice_sessions")) {
            session = { id: values[0], learner_id: values[1], created_by_user_id: values[2], mode: "practice", check_mode: values[3], status: "active", started_at: "2026-10-18T00:00:00Z", completed_at: null };
        }
        if (sql.includes("FROM practice_sessions\n") && sql.includes("created_by_user_id = $3")) return { rows: session ? [session] : [] };
        if (sql.includes("FROM practice_session_items AS item") && sql.includes("candidate_revision.id = item.question_revision_id")) {
            const row = {
                question_id: ids.question, revision_id: ids.questionRevision, revision_number: 1,
                scoped_part_id: options.scopedPartId ?? null,
                question_code: "test", question_type_id: "type", question_type_code: "text", question_type_name: "填充",
                grade_id: "grade", grade_name: "國一", subject_id: "subject", subject_name: "國文",
                book_version_id: "book", book_version_name: "第一冊", unit_id: "unit", unit_name: "第一課", volume_name: "第一冊",
            };
            return { rows: options.pinnedRows ?? (options.scopedPartIds
                ? options.scopedPartIds.map((scoped_part_id) => ({ ...row, scoped_part_id }))
                : [row]) };
        }
        if (sql.includes("FROM practice_session_items AS item")) return { rows: [item] };
        if (sql.includes("FROM question_parts\n") && options.parts) return { rows: options.parts };
        if (sql.includes("FROM question_options AS option") && options.options) return { rows: options.options };
        if (sql.includes("FROM question_content_blocks AS block") && options.blocks) return { rows: options.blocks };
        if (sql.includes("FROM question_content_blocks AS block") && options.media) return { rows: [{
            id: "block", question_revision_id: ids.questionRevision, question_part_id: null, question_option_id: null,
            placement: "prompt", hint_index: null, content_type: "image", position: 0, text_content: null, asset_id: ids.question, mime_type: "image/png",
            width: 100, height: 100, alt_text: "pinned image",
        }] };
        return { rows: [] };
    } };
    const store = await load("../app/lib/local-practice-store.ts", {
        "@/app/lib/local-postgres": {
            withLocalPostgresTransaction: (callback) => callback(client),
            queryLocalPostgres: (...args) => client.query(...args),
        },
        "@/app/lib/local-practice-types": { LOCAL_PRACTICE_MAX_QUESTIONS: 500 },
        "@/app/lib/practice-catalog-knowledge": {
            PRACTICE_CATALOG_KNOWLEDGE_SQL: "SELECT knowledge",
            attachPracticeCatalogKnowledge: (questions) => questions,
        },
    });
    return { store, calls };
}

test("formal start pins revision items and persisted score settings, never the current catalog", async () => {
    const { store, calls } = await storeWith({ checkMode: "score" });
    const result = await store.createLearningBookPracticeSession({ practicePlanId: ids.plan }, actor, ids.session);
    assert.equal(result.session.checkMode, "score");
    assert.equal(result.session.items[0].revisionId, ids.questionRevision);
    const insert = calls.find((call) => call.sql.includes("INSERT INTO practice_sessions"));
    assert.equal(insert.values[5], ids.revision);
    assert.equal(calls.some((call) => call.sql.includes("score_total_count = $2")), true);
    const validate = calls.find((call) => call.sql.includes("SELECT requested.question_id"));
    assert.match(validate.sql, /'published', 'superseded'/u);
    assert.doesNotMatch(validate.sql, /current_revision_id|question_bank_learners/u);
});

test("shared source pins subscription rather than source learner plan foreign key", async () => {
    const { store, calls } = await storeWith({ subscription: true });
    await store.createLearningBookPracticeSession({ subscriptionId: ids.subscription }, actor, ids.session);
    const insert = calls.find((call) => call.sql.includes("INSERT INTO practice_sessions"));
    assert.equal(insert.values[4], null);
    assert.equal(insert.values[7], ids.subscription);
    const lookup = calls.find((call) => call.sql.includes("FROM practice_plan_subscriptions AS subscription"));
    assert.match(lookup.sql, /recipient_learner_id = \$2/u);
    assert.match(lookup.sql, /subscription.status = 'active'/u);
});

test("revoked scheduled share cannot start and does not write a session", async () => {
    const { store, calls } = await storeWith({ subscription: true, revoked: true });
    await assert.rejects(store.createLearningBookPracticeSession({ practiceScheduleId: ids.schedule }, actor, ids.session), { code: "LEARNING_BOOK_UNAVAILABLE" });
    assert.equal(calls.some((call) => call.sql.includes("INSERT INTO practice_sessions")), false);
});

test("accepted learner access is checked before resolving a formal source", async () => {
    const { store, calls } = await storeWith({ noAccess: true });
    await assert.rejects(store.createLearningBookPracticeSession({ practicePlanId: ids.plan }, actor, ids.session), { code: "LEARNER_ACCESS_DENIED" });
    assert.equal(calls.length, 1);
});

test("existing pinned session can replay after revocation, but never for another learner", async () => {
    const existing = { id: ids.session, learner_id: actor.learnerId, created_by_user_id: actor.userId,
        practice_plan_id: null, practice_plan_subscription_id: ids.subscription, practice_plan_revision_id: ids.revision,
        practice_schedule_id: null, mode: "practice", check_mode: "instant", status: "active", started_at: "2026-10-18T00:00:00Z", completed_at: null };
    const { store, calls } = await storeWith({ existing, unavailable: true });
    const result = await store.createLearningBookPracticeSession({ subscriptionId: ids.subscription }, actor, ids.session);
    assert.equal(result.replayed, true);
    assert.equal(calls.some((call) => call.sql.includes("FROM practice_plan_subscriptions")), false);
    await assert.rejects(store.createLearningBookPracticeSession({ subscriptionId: ids.subscription }, { ...actor, learnerId: "other" }, ids.session), { code: "SESSION_IDEMPOTENCY_CONFLICT" });
});

test("pinned content reader uses session revisions without exposing explanation or answer keys", async () => {
    const existing = { id: ids.session, learner_id: actor.learnerId, created_by_user_id: actor.userId,
        mode: "practice", check_mode: "instant", status: "active", started_at: "2026-10-18T00:00:00Z", completed_at: null };
    const { store, calls } = await storeWith({ existing });
    const questions = await store.listLocalPracticeSessionQuestions(ids.session, actor);
    assert.equal(questions[0].revisionId, ids.questionRevision);
    const read = calls.find((call) => call.sql.includes("candidate_revision.id = item.question_revision_id"));
    assert.doesNotMatch(read.sql, /current_revision_id/u);
    assert.equal(read.values[1], actor.learnerId);
    assert.equal(read.values[2], actor.userId);
    for (const { sql } of calls) assert.doesNotMatch(sql, /question_answers|accepted_value|answer_key/u);
});

test("formal request rejects browser targets and multiple source types", async () => {
    let starts = 0;
    const route = await load("../app/api/v1/local-practice/sessions/route.ts", {
        "@/app/lib/local-practice-store": { createLearningBookPracticeSession: () => { starts += 1; } },
        "@/app/lib/local-practice-types": { LOCAL_PRACTICE_MAX_QUESTIONS: 500 },
        "../_shared": {
            requireLocalPracticeAccount: async () => ({ userId: actor.userId, learner: { id: actor.learnerId } }),
            isRecord: (value) => value !== null && typeof value === "object" && !Array.isArray(value),
            UUID_PATTERN: /^[0-9a-f-]{36}$/iu,
            errorResponse: (code, message, status) => ({ code, status }),
            handleLocalPracticeError: (error) => { throw error; },
        },
    });
    for (const body of [
        { practicePlanId: ids.plan, questions: [] },
        { practicePlanId: ids.plan, subscriptionId: ids.subscription },
        { practicePlanRevisionId: ids.revision },
        { practiceScheduleId: ids.schedule, checkMode: "instant" },
    ]) {
        const result = await route.POST({ json: async () => body });
        assert.equal(result.code, "INVALID_SESSION_SOURCE");
        assert.equal(result.status, 400);
    }
    assert.equal(starts, 0);
});

test("pinned media URLs carry session authorization instead of catalog filters", async () => {
    const existing = { id: ids.session, learner_id: actor.learnerId, created_by_user_id: actor.userId,
        mode: "practice", check_mode: "instant", status: "active", started_at: "2026-10-18T00:00:00Z", completed_at: null };
    const { store } = await storeWith({ existing, media: true });
    const questions = await store.listLocalPracticeSessionQuestions(ids.session, actor);
    assert.equal(questions[0].promptBlocks[0].asset.url, `/api/v1/local-practice/assets/${ids.question}?sessionId=${ids.session}`);
});

test("session media authorization pins revision, owner, learner access and prompt/option disclosure", async () => {
    const { store, calls } = await storeWith();
    const asset = await store.findLocalPracticeSessionAsset(ids.question, ids.session, actor);
    assert.equal(asset.byteSize, 12);
    const query = calls[0];
    assert.match(query.sql, /block.question_revision_id = item.question_revision_id/u);
    assert.match(query.sql, /session.created_by_user_id = \$3/u);
    assert.match(query.sql, /session.learner_id = \$2/u);
    assert.match(query.sql, /access.accepted_at IS NOT NULL AND access.revoked_at IS NULL/u);
    assert.match(query.sql, /block.placement IN \('prompt', 'option', 'hint'\)/u);
    assert.match(query.sql, /block.placement = 'explanation'/u);
    assert.match(query.sql, /session.check_mode = 'instant'[\s\S]*FROM answer_attempts AS disclosed_attempt/u);
    assert.match(query.sql, /session.check_mode = 'complete'[\s\S]*session.status = 'completed'/u);
    assert.doesNotMatch(query.sql, /current_revision_id|question_bank_learners/u);
    const hidden = await storeWith({ noAsset: true });
    assert.equal(await hidden.store.findLocalPracticeSessionAsset(ids.question, ids.session, actor), null);
});

test("recipient session discloses only the shared part and its options while preserving the root prompt", async () => {
    const selected = "selected-part";
    const sibling = "unshared-sibling-part";
    const existing = { id: ids.session, learner_id: actor.learnerId, created_by_user_id: actor.userId,
        practice_plan_subscription_id: ids.subscription, practice_plan_revision_id: ids.revision,
        mode: "practice", check_mode: "instant", status: "active", started_at: "2026-10-18T00:00:00Z", completed_at: null };
    const part = (id, position) => ({ id, question_revision_id: ids.questionRevision, stable_key: id,
        position, answer_mode: "single_choice", grading_policy: "automatic", is_independently_gradable: true });
    const block = (id, partId, optionId, text) => ({ id, question_revision_id: ids.questionRevision,
        question_part_id: partId, question_option_id: optionId, placement: optionId ? "option" : "prompt",
        hint_index: null, position: 0, content_type: "text", text_content: text,
        alt_text: null, asset_id: null, mime_type: null });
    const fixture = {
        existing,
        parts: [part(selected, 0), part(sibling, 1)],
        options: [
            { id: "selected-option", question_part_id: selected, option_key: "A", position: 0 },
            { id: "unshared-sibling-option", question_part_id: sibling, option_key: "B", position: 0 },
        ],
        blocks: [
            block("root", null, null, "共同題幹"),
            block("selected-prompt", selected, null, "分享的小題"),
            { ...block("selected-hint", selected, null, "先排除不合理的選項"), placement: "hint", hint_index: 0 },
            block("unshared-sibling-prompt", sibling, null, "未分享的內容"),
            block("selected-label", null, "selected-option", "分享的選項"),
            block("unshared-sibling-label", null, "unshared-sibling-option", "未分享的選項"),
        ],
    };
    const { store, calls } = await storeWith({ ...fixture, scopedPartId: selected });
    const questions = await store.listLocalPracticeSessionQuestions(ids.session, actor);
    assert.equal(questions[0].prompt, "共同題幹");
    assert.equal(questions[0].parts.length, 1);
    assert.equal(questions[0].parts[0].id, selected);
    assert.equal(questions[0].parts[0].prompt, "分享的小題");
    assert.equal(questions[0].parts[0].hints[0].blocks[0].text, "先排除不合理的選項");
    assert.equal(questions[0].parts[0].options[0].label, "分享的選項");
    assert.doesNotMatch(JSON.stringify(questions), /unshared-sibling|未分享/u);
    const read = calls.find((call) => call.sql.includes("AS scoped_part_id"));
    assert.match(read.sql, /item.question_part_id AS scoped_part_id/u);
    assert.equal(read.values[1], actor.learnerId);
    assert.equal(read.values[2], actor.userId);

    const whole = await storeWith(fixture);
    const wholeQuestions = await whole.store.listLocalPracticeSessionQuestions(ids.session, actor);
    assert.equal(wholeQuestions[0].parts.length, 2, "whole-question targets retain all parts");

    const withoutRoot = await storeWith({ ...fixture, scopedPartId: selected, blocks: fixture.blocks.filter((row) => row.id !== "root") });
    const fallbackQuestions = await withoutRoot.store.listLocalPracticeSessionQuestions(ids.session, actor);
    assert.equal(fallbackQuestions[0].prompt, "分享的小題", "fallback prompt must not concatenate unshared sibling text");
    assert.doesNotMatch(JSON.stringify(fallbackQuestions), /unshared-sibling|未分享/u);
});

test("two shared parts produce one question with their authorized union and exclude a third sibling", async () => {
    const existing = { id: ids.session, learner_id: actor.learnerId, created_by_user_id: actor.userId,
        practice_plan_subscription_id: ids.subscription, practice_plan_revision_id: ids.revision,
        mode: "practice", check_mode: "instant", status: "active", started_at: "2026-10-18T00:00:00Z", completed_at: null };
    const partIds = ["selected-first", "selected-second", "unshared-third"];
    const fixture = {
        existing,
        scopedPartIds: partIds.slice(0, 2),
        parts: partIds.map((id, position) => ({ id, question_revision_id: ids.questionRevision, stable_key: id,
            position, answer_mode: "single_choice", grading_policy: "automatic", is_independently_gradable: true })),
        options: partIds.map((id, position) => ({ id: `${id}-option`, question_part_id: id, option_key: "A", position })),
        blocks: partIds.flatMap((id) => [
            { id: `${id}-prompt`, question_revision_id: ids.questionRevision, question_part_id: id,
                question_option_id: null, placement: "prompt", hint_index: null, position: 0, content_type: "text", text_content: `${id} prompt`, alt_text: null, asset_id: null, mime_type: null },
            { id: `${id}-label`, question_revision_id: ids.questionRevision, question_part_id: null,
                question_option_id: `${id}-option`, placement: "option", hint_index: null, position: 0, content_type: "text", text_content: `${id} choice`, alt_text: null, asset_id: null, mime_type: null },
        ]),
    };
    const { store } = await storeWith(fixture);
    const questions = await store.listLocalPracticeSessionQuestions(ids.session, actor);
    assert.equal(questions.length, 1, "client maps keyed by question ID must not overwrite another selected part");
    assert.equal(questions[0].parts.length, 2);
    assert.equal(questions[0].parts[0].id, partIds[0]);
    assert.equal(questions[0].parts[1].id, partIds[1]);
    assert.equal(questions[0].parts[0].options[0].label, "selected-first choice");
    assert.equal(questions[0].parts[1].options[0].label, "selected-second choice");
    assert.equal(questions[0].prompt, "selected-first prompt\nselected-second prompt");
    assert.doesNotMatch(JSON.stringify(questions), /unshared-third/u);

    const whole = await storeWith({ ...fixture, scopedPartIds: [partIds[0], null, partIds[1]] });
    const all = await whole.store.listLocalPracticeSessionQuestions(ids.session, actor);
    assert.equal(all.length, 1);
    assert.equal(all[0].parts.length, 3, "a whole-question target authorizes all parts even when combined with part targets");
});

test("mixed revisions of one question are rejected before session write and before content disclosure", async () => {
    const otherRevision = "80000000-0000-4000-8000-000000000002";
    const items = [ids.questionRevision, otherRevision].map((question_revision_id, index) => ({
        question_id: ids.question, question_revision_id, question_part_id: `part-${index}`,
    }));
    const { store, calls } = await storeWith({ items });
    await assert.rejects(store.createLearningBookPracticeSession({ practicePlanId: ids.plan }, actor, ids.session),
        { code: "SESSION_QUESTION_REVISION_CONFLICT", status: 409 });
    assert.equal(calls.some((call) => call.sql.includes("INSERT INTO practice_sessions")), false);
    const existing = { id: ids.session, learner_id: actor.learnerId, created_by_user_id: actor.userId,
        mode: "practice", check_mode: "instant", status: "active", started_at: "2026-10-18T00:00:00Z", completed_at: null };
    const persisted = await storeWith({ existing, pinnedRows: items.map((item) => ({
        question_id: item.question_id, revision_id: item.question_revision_id, scoped_part_id: item.question_part_id,
    })) });
    await assert.rejects(persisted.store.listLocalPracticeSessionQuestions(ids.session, actor),
        { code: "SESSION_QUESTION_REVISION_CONFLICT", status: 409 });
    assert.equal(persisted.calls.some((call) => call.sql.includes("FROM question_parts\n")), false);
});
