import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Load the same TypeScript modules as the browser without needing Next's path resolver.
async function loadModule(relativePath) {
    const url = new URL(relativePath, import.meta.url);
    let source = await readFile(url, "utf8");
    const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    source = javascript;
    for (const match of javascript.matchAll(/from "(\.\.?\/[^"\n]+)"/gu)) {
        const dependency = await moduleUrl(new URL(`${match[1]}.ts`, url));
        source = source.replaceAll(`from "${match[1]}"`, `from "${dependency}"`);
    }
    return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}
async function moduleUrl(url) {
    return loadModule(url.href);
}

const adapter = await import(await loadModule("../app/lib/practice-catalog-adapter.ts"));
const client = await import(await loadModule("../app/lib/practice-client.ts"));
const authSession = await import(await loadModule("../app/lib/auth-session-client.ts"));
const knowledge = await import(await loadModule("../app/lib/practice-catalog-knowledge.ts"));

const question = {
    id: "12345678-1234-4234-a234-123456789abc", revisionId: "87654321-4321-4321-a321-cba987654321", revisionNumber: 1, code: "0123456789abcdef:10",
    type: { id: "type", code: "choice", name: "選擇題" },
    originalTypeLabel: "單一選擇題",
    grade: { id: "grade", code: "jh1", name: "國一" },
    subject: { id: "subject", code: "zh", name: "國文" },
    semester: null, publisher: { id: "publisher", code: "hanlin", name: "翰林" },
    bookVersion: { id: "book", code: null, name: "翰林版" },
    unit: { id: "unit", code: "l4", name: "第四課", unitType: "lesson" }, difficulty: null,
    sourceCategory: { id: "source", code: "publisher-test-bank", name: "出版社題庫" },
    knowledgePoints: [
        { id: "knowledge-secondary", code: null, name: "次要知識點", isPrimary: false },
        { id: "knowledge-primary", code: "KP-1", name: "主要知識點", isPrimary: true },
    ],
    metadata: [
        { key: "source_category", label: "來源分類", rawValue: "出版社題庫", values: ["出版社題庫"], valueSource: "document", confidence: 1 },
        { key: "cognitive_dimension", label: "認知向度", rawValue: "基本語文知識", values: ["基本語文知識"], valueSource: "document", confidence: 1 },
        { key: "knowledge_dimension", label: "知識向度", rawValue: "正確用字", values: ["正確用字"], valueSource: "document", confidence: 1 },
    ],
    prompt: "公開題幹", promptBlocks: [],
    parts: [{ id: "part", stableKey: "p1", position: 1, answerMode: "multiple_choice", gradingPolicy: "automatic", isIndependentlyGradable: true, prompt: "", promptBlocks: [], options: [{ id: "opt-a", key: "A", position: 1, label: "甲", contentBlocks: [] }, { id: "opt-b", key: "B", position: 2, label: "乙", contentBlocks: [] }] }],
};

test("public catalog joins existing subject/version/unit filters without a private answer", () => {
    const result = adapter.adaptPracticeQuestion(question);
    assert.equal(result.subject, "國語");
    assert.equal(result.grade, "國一");
    assert.equal(result.bookVersion, "翰林");
    assert.equal(result.unit, "第一冊 · 第四課");
    assert.equal(result.knowledge, "主要知識點");
    assert.equal(result.code, "10");
    assert.ok(Number.isSafeInteger(result.id));
    assert.equal(adapter.practiceRouteId(question.id), result.id);
    assert.equal(result.answer, "");
    assert.ok(result.parts.every((part) => part.answer === ""));
    assert.equal(result.prompt, "公開題幹");
    assert.equal(result.sourceCategory, "題庫題目");
    assert.deepEqual(result.metadata?.map((field) => [field.key, field.values]), [
        ["source_category", ["出版社題庫"]],
        ["cognitive_dimension", ["基本語文知識"]],
        ["knowledge_dimension", ["正確用字"]],
    ]);
});

test("catalog preserves the imported literacy source instead of flattening it to test-bank questions", () => {
    const literacy = {
        ...question,
        sourceCategory: { id: "literacy", code: "literacy-question", name: "素養題" },
        metadata: question.metadata.map((field) => field.key === "source_category"
            ? { ...field, rawValue: "素養題", values: ["素養題"] }
            : field),
    };
    const result = adapter.adaptPracticeQuestion(literacy);
    assert.equal(result.source, "素養題");
    assert.equal(result.sourceCategory, "素養題");
});

test("catalog knowledge comes from revision relations and legacy DTOs stay readable", () => {
    const legacy = { ...question, knowledgePoints: undefined };
    assert.equal(adapter.adaptPracticeQuestion(legacy).knowledge, "");
    assert.notEqual(adapter.adaptPracticeQuestion(legacy).knowledge, legacy.type.name);

    const enriched = knowledge.attachPracticeCatalogKnowledge([legacy], [
        { question_revision_id: question.revisionId, id: "secondary", code: null, name: "乙知識點", is_primary: false },
        { question_revision_id: question.revisionId, id: "primary", code: "KP-A", name: "甲知識點", is_primary: true },
    ]);
    assert.deepEqual(enriched[0].knowledgePoints, [
        { id: "secondary", code: null, name: "乙知識點", isPrimary: false },
        { id: "primary", code: "KP-A", name: "甲知識點", isPrimary: true },
    ]);
    assert.equal(adapter.adaptPracticeQuestion(enriched[0]).knowledge, "甲知識點");
    assert.match(knowledge.PRACTICE_CATALOG_KNOWLEDGE_SQL, /FROM question_revision_knowledge_points AS relation/u);
    assert.match(knowledge.PRACTICE_CATALOG_KNOWLEDGE_SQL, /JOIN knowledge_points AS knowledge_point/u);
});

test("answer adapter preserves option keys and free text; it never guesses grading", () => {
    const encoded = JSON.stringify({ part: ["B", "A"], text: "字詞" });
    assert.deepEqual(adapter.parsePracticeAnswers(encoded), [{ partId: "part", value: ["B", "A"] }, { partId: "text", value: "字詞" }]);
    assert.equal(adapter.formatPracticeResponse(question, encoded), "乙、甲");
    assert.deepEqual(adapter.parsePracticeAnswers("not json"), []);
    assert.deepEqual(adapter.parsePracticeAnswers('["A"]'), []);
    const result = adapter.adaptPracticeAttempt({ id: "attempt", sessionId: "session", questionId: question.id, overallResult: "pending", parts: [{ partId: "part", result: "wrong" }], submittedAt: "2026-01-01T00:00:00Z", durationSeconds: 4 });
    assert.equal(result.correct, null);
    assert.equal(result.partResults[0].correct, false);
});

test("catalog uses the UI's 500-item ceiling while history and wrong-review sources paginate beyond 100", async () => {
    const originalFetch = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async (input) => {
        const url = String(input);
        seen.push(url);
        let data;
        let meta;
        if (url === "/api/v1/auth/me") data = { account: { learner: { id: "authenticated-learner" } } };
        else if (url.includes("/questions?")) {
            const parsed = new URL(url, "http://localhost");
            const page = Number(parsed.searchParams.get("page"));
            const limit = Number(parsed.searchParams.get("limit"));
            const lesson = parsed.searchParams.get("lesson");
            const lessonCounts = new Map([
                ["第四課", 279],
                ["第五課", 280],
                ["第六課", 258],
                ["語文常識（二）", 75],
                ["2-1 因數與倍數", 0],
                ["2-2 最大公因數與最小公倍數", 0],
                ["2-3 分數的四則運算", 0],
                ["2-4 指數律", 0],
            ]);
            const count = lessonCounts.get(lesson);
            assert.equal(limit, 500);
            assert.notEqual(count, undefined);
            data = { questions: Array.from({ length: count }, (_, index) => ({ ...question, id: `${lesson}-q${(page - 1) * limit + index}` })) };
            meta = { total: count };
        }
        else {
            const page = Number(new URL(url, "http://localhost").searchParams.get("page") ?? "1");
            data = {
                attempts: Array.from({ length: page === 1 ? 100 : 1 }, (_, index) => ({ id: `a${(page - 1) * 100 + index}` })),
                sessions: Array.from({ length: page === 1 ? 100 : 1 }, (_, index) => ({ id: `s${(page - 1) * 100 + index}` })),
                wrongReviewQueue: {
                    pendingCount: 101,
                    items: Array.from({ length: page === 1 ? 100 : 1 }, (_, index) => ({
                        id: `w${(page - 1) * 100 + index}`,
                    })),
                },
            };
        }
        return new Response(JSON.stringify({ data, meta }), { status: 200 });
    };
    try {
        const loaded = await client.loadPersistedPractice();
        assert.equal(loaded.questions.length, 892);
        assert.equal(loaded.attempts.length, 101);
        assert.equal(loaded.sessions.length, 101);
        assert.equal(loaded.wrongReviewQueue.pendingCount, 101);
        assert.equal(loaded.wrongReviewQueue.items.length, 101);
        assert.equal(loaded.account.learner.id, "authenticated-learner");
        assert.ok(seen.some((url) => url.includes("history?limit=100&page=2")));
        assert.equal(seen.filter((url) => url.includes("/questions?")).length, 8);
        assert.equal(seen.length, 11);
    }
    finally { globalThis.fetch = originalFetch; }
});

test("authorized catalog accepts 500-item pages while the answer-bearing legacy route stays closed", async () => {
    const [localRoute, legacyRoute, sharedRoute, store] = await Promise.all([
        readFile(new URL("../app/api/v1/local-practice/questions/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/questions/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/local-practice/_shared.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8"),
    ]);
    assert.match(localRoute, /LOCAL_PRACTICE_MAX_CATALOG_PAGE_SIZE/u);
    assert.match(legacyRoute, /legacyFixtureApiGone\(\)/u);
    assert.doesNotMatch(legacyRoute, /readDatabase|answer|explanation/u);
    assert.match(sharedRoute, /value\.normalize\("NFC"\)/u);
    assert.match(store, /question\.created_at,[\s\S]*question\.id[\s\S]*LIMIT \$7 OFFSET \$8/u);
});

test("main practice sends sessions/attempts to server and guards deep links", async () => {
    const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
    assert.match(source, /await startPersistedPractice/u);
    assert.match(source, /await submitPersistedPracticeAttempt\(snapshot\)/u);
    assert.match(source, /result\.disclosure === "detailed"/u);
    assert.match(source, /result\.disclosure === "score"/u);
    assert.match(source, /attemptRequestRef\.current = snapshot/u);
    assert.match(source, /questionId: question!\.id,[\s\S]*revisionId: question!\.revisionId/u);
    assert.match(source, /sessionRequestRef\.current\?\.fingerprint === fingerprint/u);
    assert.match(source, /readPracticeSessionHint\(learner\.id\)/u);
    assert.match(source, /updatePersistedPracticeSessionStatus\(session\.id, "abandoned"\)/u);
    assert.match(source, /persistedQuestions\.has\(routeQuestionId\).*session\.questionIds\.includes\(routeQuestionId\)/u);
    assert.doesNotMatch(source, /router\.(?:push|replace)\(["']\/local-practice/u);
    assert.match(source, /writePracticePreferences\(persistedLearnerId, \{/u);
    assert.doesNotMatch(source, /JSON 模擬 API|模擬 API/u);
    assert.match(source, /setLearners\(accessibleLearners\)/u);
    assert.match(source, /setRoleAccess\(roleAccessFromPracticeAccount\(persisted\.account\)\)/u);
    assert.doesNotMatch(source, /setAttemptsByLearner\(\{ \.\.\.state\.attemptsByLearner, \[learner\.id\]/u);
});

test("review/check modes reach the session API without claiming a database schedule", async () => {
    const originalFetch = globalThis.fetch;
    let submitted;
    globalThis.fetch = async (_url, init) => {
        submitted = JSON.parse(init.body);
        return new Response(JSON.stringify({ data: { session: { id: "server-session" } } }), { status: 201 });
    };
    try {
        const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        await client.startPersistedPractice([question.id], { mode: "review", checkMode: "complete", scheduleId: "browser-only" }, sessionId);
        assert.deepEqual(submitted, { sessionId, questionIds: [question.id], mode: "review", checkMode: "complete" });
        await client.startPersistedPractice([{ questionId: question.id, revisionId: question.revisionId }], { mode: "review", checkMode: "complete" }, sessionId);
        assert.deepEqual(submitted, { sessionId, questions: [{ questionId: question.id, revisionId: question.revisionId }], mode: "review", checkMode: "complete" });
        const [route, store] = await Promise.all([
            readFile(new URL("../app/api/v1/local-practice/sessions/route.ts", import.meta.url), "utf8"),
            readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8"),
        ]);
        assert.match(route, /\["practice", "review", "similar"\]\.includes/u);
        assert.match(route, /\["complete", "instant", "score"\]\.includes/u);
        assert.match(route, /export async function GET/u);
        assert.match(route, /export async function PATCH/u);
        assert.match(store, /practice-session:\$\{requestedSessionId\}/u);
        assert.match(store, /QUESTION_REVISION_STALE/u);
        assert.match(store, /SESSION_IDEMPOTENCY_CONFLICT/u);
        assert.match(store, /created_by_user_id = \$3/u);
        assert.match(store, /settings\.mode, settings\.checkMode/u);
    }
    finally { globalThis.fetch = originalFetch; }
});

test("recommendation preview and start send only durable wrong-queue source ids", async () => {
    const originalFetch = globalThis.fetch;
    const submitted = [];
    globalThis.fetch = async (url, init) => {
        submitted.push({ url: String(url), init, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({
            data: {
                recommendationKind: "none",
                availableCount: 0,
                classificationLabel: "單一選擇題",
                explanation: "目前沒有候選題目。",
                questions: [],
                session: null,
            },
        }), { status: 200 });
    };
    try {
        const sourceQueueItemIds = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"];
        const preview = await client.previewPersistedPracticeRecommendations({
            sourceQueueItemIds,
            limit: 5,
        });
        const started = await client.startPersistedPracticeRecommendations({
            sourceQueueItemIds,
            limit: 5,
            checkMode: "instant",
            sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        });

        assert.equal(preview.recommendationKind, "none");
        assert.equal(started.session, null);
        assert.deepEqual(submitted.map(({ url, init, body }) => ({
            url,
            method: init.method,
            body,
        })), [
            {
                url: "/api/v1/local-practice/recommendations",
                method: "POST",
                body: { action: "preview", sourceQueueItemIds, limit: 5 },
            },
            {
                url: "/api/v1/local-practice/recommendations",
                method: "POST",
                body: {
                    action: "start",
                    sourceQueueItemIds,
                    limit: 5,
                    checkMode: "instant",
                    sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                },
            },
        ]);
    }
    finally { globalThis.fetch = originalFetch; }
});

const validPlan = {
    creatorRole: "家長",
    subject: "國語",
    bookVersion: "翰林",
    scopeFilters: [],
    semester: "all",
    topic: "all",
    difficultyFilters: [],
    creatorFilter: "all",
    collection: "all",
    search: "",
    examSettings: [{ id: "exam-1", name: "定期評量", date: "", ranges: {} }],
    activeExamId: "exam-1",
    checkMode: "complete",
    questionLimit: 10,
    prioritizeRelated: false,
    basis: "chapter",
    difficultyMix: { easy: 40, medium: 40, hard: 20 },
    difficultyMixEnabled: false,
    sourceFilters: [],
    questionKinds: [],
    knowledge: "all-knowledge",
    metadataFilters: {},
};

test("browser preferences migrate to v2 without learner identity or profile data", () => {
    const originalWindow = globalThis.window;
    const storage = new Map();
    globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } };
    try {
        const preferences = { plan: validPlan, schedules: [], collections: [], questionLimitOptions: [10, 20], defaultQuestionLimit: 20 };
        client.writePracticePreferences("learner-a", preferences);
        assert.deepEqual(client.readPracticePreferences("learner-a"), preferences);
        assert.equal(client.readPracticePreferences("learner-b"), null);
        const current = JSON.parse(storage.get("lerniqa-practice-preferences-v2:learner-a"));
        assert.deepEqual(Object.keys(current).sort(), ["collections", "defaultQuestionLimit", "plan", "questionLimitOptions", "schedules"]);
        for (const key of ["learner", "displayName", "name", "grade", "bookVersions", "school", "avatar", "attempts"]) {
            assert.equal(Object.hasOwn(current, key), false, `${key} must not be persisted at the preferences root`);
        }

        storage.set("lerniqa-practice-preferences-v1:learner-b", JSON.stringify({
            learner: {
                id: "learner-b",
                name: "兒童姓名",
                displayName: "兒童姓名",
                grade: "國一",
                semester: "上學期",
                bookVersions: { 國語: "翰林" },
                school: "真實學校",
                avatar: "data:image/png;base64,private",
                questionLimitOptions: [5, 10],
                defaultQuestionLimit: 5,
            },
            plan: validPlan,
            schedules: [],
            collections: [],
        }));
        assert.deepEqual(client.readPracticePreferences("learner-b"), {
            plan: validPlan,
            schedules: [],
            collections: [],
            questionLimitOptions: [5, 10],
            defaultQuestionLimit: 5,
        });
        assert.equal(storage.has("lerniqa-practice-preferences-v1:learner-b"), false);
        const migrated = storage.get("lerniqa-practice-preferences-v2:learner-b");
        assert.doesNotMatch(migrated, /兒童姓名|真實學校|private|displayName|bookVersions|avatar/iu);
        const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        assert.equal(client.writePracticeSessionHint("learner-a", sessionId), true);
        assert.equal(client.readPracticeSessionHint("learner-a"), sessionId);
        const resumeValue = [...storage.entries()].find(([key]) => key.includes("practice-resume"))?.[1];
        assert.deepEqual(JSON.parse(resumeValue), { sessionId });
        assert.doesNotMatch(resumeValue, /answer|correct|result|grading/iu);
        assert.equal(client.clearPracticeSessionHint("learner-a"), true);
        assert.equal(client.readPracticeSessionHint("learner-a"), null);

        const { scopeFilters: _scopeFilters, difficultyFilters: _difficultyFilters, questionKinds: _questionKinds, ...legacyPlan } = validPlan;
        storage.set("lerniqa-practice-preferences-v2:learner-c", JSON.stringify({
            plan: {
                ...legacyPlan,
                scope: "國語::第一冊 · 第四課",
                difficulty: "基礎",
                questionKind: "choice",
                sourceFilters: ["題庫題目"],
            },
            schedules: [],
            collections: [],
            questionLimitOptions: [10],
            defaultQuestionLimit: 10,
        }));
        const scalarMigrated = client.readPracticePreferences("learner-c");
        assert.deepEqual(scalarMigrated.plan.scopeFilters, ["國語::第一冊 · 第四課"]);
        assert.deepEqual(scalarMigrated.plan.difficultyFilters, ["基礎"]);
        assert.deepEqual(scalarMigrated.plan.questionKinds, ["choice"]);
        assert.deepEqual(scalarMigrated.plan.sourceFilters, ["題庫題目"]);
        const canonicalPlan = JSON.parse(storage.get("lerniqa-practice-preferences-v2:learner-c")).plan;
        assert.equal(Object.hasOwn(canonicalPlan, "scope"), false);
        assert.equal(Object.hasOwn(canonicalPlan, "difficulty"), false);
        assert.equal(Object.hasOwn(canonicalPlan, "questionKind"), false);
    }
    finally { globalThis.window = originalWindow; }
});

test("server learner profile is authoritative and the first real catalog subject becomes the default", () => {
    const profile = {
        id: "learner-server",
        displayName: "伺服器稱呼",
        educationStatus: "enrolled",
        gradeCode: "jh1",
        gradeName: "國一",
        semesterCode: "s1",
        semesterName: "上學期",
        preferences: { questionLimitOptions: [8, 16], defaultQuestionLimit: 16, defaultCheckMode: "score" },
        subjectSettings: [
            { position: 2, lockVersion: 1, subject: { code: "en", name: "英文" }, bookVersion: null, availableBookVersions: [] },
            { position: 1, lockVersion: 3, subject: { code: "zh", name: "國文" }, bookVersion: { id: "book", name: "第一冊", publisher: { code: "hanlin", name: "翰林" } }, availableBookVersions: [{ id: "book", name: "第一冊", publisher: { code: "hanlin", name: "翰林" } }] },
        ],
    };
    const learner = client.mapPracticeAccountLearner(profile, {
        plan: null,
        schedules: [],
        collections: [],
        questionLimitOptions: [10],
        defaultQuestionLimit: 10,
    });
    assert.deepEqual(learner, {
        id: "learner-server",
        name: "伺服器稱呼",
        educationStatus: "enrolled",
        grade: "國一",
        semester: "上學期",
        bookVersions: { 國語: "翰林", 英文: "" },
        customSubjects: [],
        school: "",
        defaultQuestionLimit: 10,
        questionLimitOptions: [10],
    });
    const catalog = [adapter.adaptPracticeQuestion(question)];
    const plan = client.createInitialPracticePlan(learner, catalog, profile.preferences.defaultCheckMode);
    assert.equal(plan.subject, "國語");
    assert.equal(plan.bookVersion, "翰林");
    assert.equal(plan.semester, "all");
    assert.equal(plan.checkMode, "score");
    const matchingSemesterPlan = client.createInitialPracticePlan(learner, [{
        ...catalog[0],
        semester: "上學期",
    }], profile.preferences.defaultCheckMode);
    assert.equal(matchingSemesterPlan.semester, "上學期");
    assert.equal(matchingSemesterPlan.bookVersion, "翰林");

    const normalized = client.normalizeLoadedPracticePlan({
        ...validPlan,
        subject: "數學",
        bookVersion: "不存在版本",
        semester: "不存在學期",
        scopeFilters: ["不存在範圍"],
        topic: "不存在主題",
        knowledge: "不存在知識點",
        difficultyFilters: ["不存在難度"],
        questionKinds: ["boolean"],
        sourceFilters: ["不存在來源"],
        creatorFilter: "不存在建立者",
        collection: "不存在收藏",
        metadataFilters: { publisher_number: ["不存在值"] },
    }, learner, catalog, []);
    assert.equal(normalized.subject, "全部");
    assert.equal(normalized.bookVersion, undefined);
    assert.equal(normalized.semester, "all");
    assert.deepEqual(normalized.scopeFilters, []);
    assert.equal(normalized.knowledge, "all-knowledge");
    assert.deepEqual(normalized.difficultyFilters, []);
    assert.deepEqual(normalized.questionKinds, []);
    assert.deepEqual(normalized.sourceFilters, []);
    assert.deepEqual(normalized.metadataFilters, {});
    assert.equal(normalized.collection, "all");
});

test("stored practice plans retain every valid selection in each multi-select filter", () => {
    const learner = {
        id: "learner-multi",
        name: "合成學習者",
        grade: "國一",
        semester: "",
        bookVersions: { 國語: "翰林" },
        customSubjects: [],
        school: "",
        defaultQuestionLimit: 10,
        questionLimitOptions: [10],
    };
    const first = adapter.adaptPracticeQuestion(question);
    const second = {
        ...first,
        id: first.id + 1,
        unit: "第一冊 · 第五課",
        difficulty: "進階",
        kind: "written",
        typeLabel: "改錯題",
        source: "校內卷",
        sourceCategory: "校內卷",
    };
    const scopeFilters = [
        `${first.subject}::${first.unit}`,
        `${second.subject}::${second.unit}`,
    ];
    const normalized = client.normalizeLoadedPracticePlan({
        ...validPlan,
        scopeFilters,
        difficultyFilters: [first.difficulty, second.difficulty],
        difficultyMixEnabled: true,
        sourceFilters: [first.sourceCategory, second.sourceCategory],
        questionKinds: [first.typeLabel, second.typeLabel],
    }, learner, [first, second], []);

    assert.deepEqual(normalized.scopeFilters, scopeFilters);
    assert.deepEqual(normalized.difficultyFilters, ["中等", "進階"]);
    assert.deepEqual(normalized.sourceFilters, ["題庫題目", "校內卷"]);
    assert.deepEqual(normalized.questionKinds, ["單一選擇題", "改錯題"]);
});

test("practice API errors retain status and code for deterministic retry cleanup", async () => {
    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;
    const browserEvents = new EventTarget();
    let authenticationExpiredEvents = 0;
    browserEvents.addEventListener(client.PRACTICE_AUTH_EXPIRED_EVENT, () => { authenticationExpiredEvents += 1; });
    globalThis.window = browserEvents;
    try {
        globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "QUESTION_REVISION_STALE", message: "題目已更新" } }), { status: 409 });
        await assert.rejects(client.practiceApi("/conflict"), (error) => {
            assert.ok(error instanceof client.PracticeApiError);
            assert.equal(error.status, 409);
            assert.equal(error.code, "QUESTION_REVISION_STALE");
            assert.equal(client.isDeterministicPracticeApiError(error), true);
            return true;
        });
        globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "DATABASE_UNAVAILABLE", message: "稍後重試" } }), { status: 503 });
        await assert.rejects(client.practiceApi("/unavailable"), (error) => {
            assert.ok(error instanceof client.PracticeApiError);
            assert.equal(error.status, 503);
            assert.equal(error.code, "DATABASE_UNAVAILABLE");
            assert.equal(client.isDeterministicPracticeApiError(error), false);
            return true;
        });
        globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "請重新登入" } }), { status: 401 });
        await assert.rejects(client.practiceApi("/expired"), (error) => {
            assert.ok(error instanceof client.PracticeApiError);
            assert.equal(error.status, 401);
            return true;
        });
        assert.equal(authenticationExpiredEvents, 1);
    }
    finally {
        globalThis.fetch = originalFetch;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});

test("session expiry uses the server timestamp and treats malformed timestamps as expired", () => {
    assert.equal(client.isPracticeSessionExpired("2026-10-16T12:00:00.000Z", Date.parse("2026-10-16T11:59:59.999Z")), false);
    assert.equal(client.isPracticeSessionExpired("2026-10-16T12:00:00.000Z", Date.parse("2026-10-16T12:00:00.000Z")), true);
    assert.equal(client.isPracticeSessionExpired("not-a-date", 0), true);
});

test("logout and 401 signals clear same-tab and cross-tab account state without storing account data", () => {
    const originalWindow = globalThis.window;
    const browserEvents = new EventTarget();
    const written = [];
    browserEvents.localStorage = { setItem: (key, value) => written.push([key, value]) };
    globalThis.window = browserEvents;
    try {
        let expiredEvents = 0;
        browserEvents.addEventListener(authSession.AUTH_SESSION_EXPIRED_EVENT, () => { expiredEvents += 1; });
        authSession.broadcastAuthSessionExpired();
        authSession.broadcastAuthSessionContextChanged();
        assert.equal(expiredEvents, 1);
        assert.equal(written.length, 2);
        assert.equal(written[0][0], authSession.AUTH_SESSION_STORAGE_KEY);
        assert.equal(written[1][0], authSession.AUTH_SESSION_CONTEXT_STORAGE_KEY);
        assert.doesNotMatch(written.flat().join(" "), /account|learner|email/u);
    }
    finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});

test("account mode, identity, and learner controls use the authenticated server contracts", async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    const account = { displayName: "帳號", email: "account@example.test", activeRole: "parent", roles: ["parent", "learner"], learner: null, learners: [] };
    globalThis.fetch = async (input, init = {}) => {
        calls.push({ url: String(input), method: init.method, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ data: { account } }), { status: 200 });
    };
    try {
        assert.deepEqual((await client.switchPracticeAccountRole("parent", "current-password")).account, account);
        await client.switchPracticeAccountRole("learner", "must-not-be-sent");
        await client.updatePracticeAccountIdentity("tutor", "current-password");
        await client.updatePracticeAccountIdentity("learner", "must-not-be-sent");
        await client.createPracticeLearner({
            clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            displayName: "合成學習者",
            educationStatus: "enrolled",
            gradeCode: "junior-high-1",
            semesterCode: "semester-1",
        });
        await client.selectPracticeLearner("learner-2");
        await client.updatePracticeLearner({ learnerId: "learner-2", displayName: "新稱呼", educationStatus: "enrolled", gradeCode: "junior-high-2", semesterCode: "semester-2" });
        await client.updatePracticeLearner({ learnerId: "learner-2", displayName: "本人新稱呼", educationStatus: "not_enrolled", gradeCode: null, semesterCode: null }, "update-current");
        await client.updatePracticeLearnerSubjectSetting({
            learnerId: "learner-2",
            subjectCode: "chinese",
            bookVersionId: "20000000-0000-4000-8000-000000000002",
            lockVersion: 4,
        });
        assert.deepEqual(calls, [
            { url: "/api/v1/auth/role", method: "PATCH", body: { targetRole: "parent", password: "current-password" } },
            { url: "/api/v1/auth/role", method: "PATCH", body: { targetRole: "learner" } },
            { url: "/api/v1/auth/identity", method: "PATCH", body: { targetRole: "tutor", password: "current-password" } },
            { url: "/api/v1/auth/identity", method: "PATCH", body: { targetRole: "learner" } },
            { url: "/api/v1/auth/learners", method: "POST", body: { clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayName: "合成學習者", educationStatus: "enrolled", gradeCode: "junior-high-1", semesterCode: "semester-1" } },
            { url: "/api/v1/auth/learners", method: "PATCH", body: { action: "select", learnerId: "learner-2" } },
            { url: "/api/v1/auth/learners", method: "PATCH", body: { action: "update", learnerId: "learner-2", displayName: "新稱呼", educationStatus: "enrolled", gradeCode: "junior-high-2", semesterCode: "semester-2" } },
            { url: "/api/v1/auth/learners", method: "PATCH", body: { action: "update-current", learnerId: "learner-2", displayName: "本人新稱呼", educationStatus: "not_enrolled", gradeCode: null, semesterCode: null } },
            { url: "/api/v1/auth/learners/subject-settings", method: "PATCH", body: { learnerId: "learner-2", subjectCode: "chinese", bookVersionId: "20000000-0000-4000-8000-000000000002", lockVersion: 4 } },
        ]);
    }
    finally { globalThis.fetch = originalFetch; }
});

test("account system settings and current learner settings stay separate", async () => {
    const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
    const nextConfig = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
    const navItems = source.slice(source.indexOf("const NAV_ITEMS"), source.indexOf("const ACCOUNT_ROLE_LABELS"));
    const systemSettings = source.slice(source.indexOf("function renderSystemSettings()"), source.indexOf("function renderSettings()"));
    const learnerSettings = source.slice(source.indexOf("function renderSettings()"), source.indexOf("function renderLearningHistory()"));
    assert.doesNotMatch(navItems, /results/u);
    assert.doesNotMatch(navItems, /id: "bank"|題目匯入/u);
    assert.match(source, /if \(pathname === SECTION_PATHS\.bank\) return "questions"/u);
    assert.match(source, /if \(browserPath === SECTION_PATHS\.bank\)[\s\S]*router\.replace\(SECTION_PATHS\.questions\)/u);
    assert.match(navItems, /label: "學習者設定"/u);
    assert.match(navItems, /label: "系統設定"/u);
    assert.match(source, /pathname !== "\/results"[\s\S]*router\.replace\(SECTION_PATHS\.overview\)/u);
    assert.match(source, /\{renderLearningHistory\(\)\}/u);
    assert.match(source, /const canAccessSystemSettings = !practiceAccount \|\| Boolean/u);
    assert.match(source, /const canAccessLearnerSettings = !practiceAccount \|\| Boolean\(activeAccountLearner\)/u);
    assert.match(source, /practiceAccount\.activeRole === "parent" \|\| practiceAccount\.activeRole === "tutor"/u);
    assert.doesNotMatch(source, /practiceAccount\.activeRole === practiceAccount\.accountRole/u);
    assert.match(source, /activeAccountLearner\?\.isSelf/u);
    assert.match(source, /const canManageCurrentLearner = !practiceAccount \|\| Boolean\(activeAccountLearner\?\.canManageSettings\)/u);
    assert.match(source, /canAccessLearnerSettings && <DropdownItem[^>]*>[\s\S]*學習者設定/u);
    assert.match(source, /canAccessSystemSettings && <DropdownItem[^>]*>[\s\S]*系統設定/u);
    assert.match(source, /SECTION_PATHS\["system-settings"\]/u);
    assert.match(nextConfig, /overview\|practice\|questions\|bank\|mistakes\|results\|settings\|system-settings/u);
    assert.match(nextConfig, /source: "\/local-practice", destination: "\/practice", permanent: false/u);
    assert.match(systemSettings, /帳號身分與使用角色/u);
    assert.match(systemSettings, /學習者管理/u);
    assert.doesNotMatch(systemSettings, /<h3>(?:考試設定|練習偏好|啟用科目與版本)<\/h3>/u);
    assert.match(learnerSettings, /基本資料/u);
    assert.match(source, /教育階段/u);
    assert.match(source, /loadEducationCatalog/u);
    assert.match(learnerSettings, /科目與版本/u);
    assert.match(learnerSettings, /availableBookVersions\.length > 0/u);
    assert.match(learnerSettings, /這個科目沒有建立版本，可直接使用，不會套用版本篩選/u);
    assert.match(learnerSettings, /考試設定/u);
    assert.match(learnerSettings, /練習偏好/u);
    assert.doesNotMatch(learnerSettings, /<h3>帳號身分與使用角色<\/h3>|<span>帳號信箱<\/span>/u);
    assert.match(source, /ACCOUNT_IDENTITY_OPTIONS = \(\["parent", "learner", "tutor"\]/u);
    assert.match(source, /await updatePracticeAccountIdentity\(identityRole, identityPassword \|\| undefined\)/u);
    assert.match(source, /await createPracticeLearner\(/u);
    assert.match(source, /await selectPracticeLearner\(nextLearnerId\)/u);
    assert.match(source, /await updatePracticeLearner\(/u);
    assert.match(source, /practiceAccount\?\.activeRole === "learner"[\s\S]*"update-current"/u);
    assert.match(learnerSettings, /disabled=\{!canManageCurrentLearner\}/u);
    assert.match(source, /practiceAccount\?\.activeRole !== "learner" && <DropdownSub>/u);
    assert.match(source, /practiceAccount\.emailVerified/u);
    assert.match(source, /practiceAccount\.email \?\? "帳號資訊已隱藏"/u);
    assert.match(source, /window\.addEventListener\(PRACTICE_AUTH_EXPIRED_EVENT/u);
    assert.match(source, /window\.addEventListener\("storage", handleAuthenticationStorage\)/u);
    assert.match(source, /isAuthSessionContextStorageEvent\(event\)[\s\S]*window\.location\.reload\(\)/u);
    assert.match(source, /clearAuthenticatedWorkspace\("登入狀態已失效/u);
    assert.match(source, /isPracticeSessionExpired\(expiresAt\)/u);
    assert.match(source, /fetch\("\/api\/v1\/auth\/me", \{ cache: "no-store" \}\)/u);
    assert.match(source, /currentAccount\.activeRole !== practiceAccount\.activeRole/u);
    assert.match(source, /currentAccount\.accountRole !== practiceAccount\.accountRole/u);
    assert.match(source, /currentAccount\.learner\?\.id !== practiceAccount\.learner\?\.id/u);
    assert.match(source, /setPracticeAccount\(account\);\s+broadcastAuthSessionContextChanged\(\)/u);
    assert.match(source, /window\.addEventListener\("focus", handleFocus\)/u);
    assert.match(source, /document\.addEventListener\("visibilitychange", handleVisibility\)/u);
    assert.match(source, /updatePersistedPracticeSessionStatus\(restored\.id, "abandoned"\)/u);
    assert.match(source, /舊練習已安全關閉/u);
    assert.doesNotMatch(source, /RolePin|rolePin|六位數角色密碼|忘記角色密碼|授權新角色/u);
});

test("score submissions advance cleanly and only deterministic failures discard retry snapshots", async () => {
    assert.equal(client.shouldAdvanceAfterSubmit("instant"), false);
    assert.equal(client.shouldAdvanceAfterSubmit("complete"), true);
    assert.equal(client.shouldAdvanceAfterSubmit("score"), true);
    const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
    assert.match(source, /if \(isDeterministicPracticeApiError\(error\)\) sessionRequestRef\.current = undefined/u);
    assert.match(source, /if \(isDeterministicPracticeApiError\(error\)\) attemptRequestRef\.current = undefined/u);
    assert.match(source, /if \(shouldAdvanceAfterSubmit\(session\.checkMode\)\)[\s\S]*setAnswer\(""\);[\s\S]*setHandwriting\(""\);/u);
    assert.match(source, /persistedSessionStatus = result\.session\.status/u);
    assert.match(source, /attemptRequestRef\.current\.sessionItemId === currentPersistedItem\?\.id/u);
    assert.match(source, /currentPersistedItem \? \{ sessionItemId: currentPersistedItem\.id \} : \{\}/u);
    assert.match(source, /currentPersistedItem\?\.partId \? \{ partId: currentPersistedItem\.partId \} : \{\}/u);
    assert.match(source, /const nextQuestionIndex = session\.index \+ 1 < session\.questionIds\.length \? session\.index \+ 1 : -1/u);
    assert.doesNotMatch(source, /session\.questionIds\.find\(\(questionId\) => !attemptedQuestionIds\.has\(questionId\)\)/u);
    assert.match(source, /serverQuestion\s*\? persistedSessionStatus === "completed"/u);
    assert.doesNotMatch(source, /const completesSession = session\.checkMode !== "instant" && session\.index === session\.questionIds\.length - 1/u);
    assert.match(source, /ids\.length > LOCAL_PRACTICE_MAX_QUESTIONS/u);
    assert.match(source, /getPracticeRecords\(activeAttempts, activePracticeSessions\)/u);
    assert.match(source, /setPracticeSessionsByLearner\(\{ \[learner\.id\]: persisted\.sessions \}\)/u);
    assert.match(source, /if \(completesSession && scoreSummary\)[\s\S]*disclosure: "score"[\s\S]*setPracticeSessionsByLearner/u);
    assert.match(source, /record\.scoreSummary\.accuracy/u);
    assert.match(source, /僅顯示成績/u);
    assert.match(source, /currentServerRevision !== attempt\.revisionId/u);
    assert.match(source, /不會用目前題目版本冒充當時內容/u);
});

test("the formal workspace never falls back to fixture identity after session loss", async () => {
    const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(source, /fetch\("\/api\/v1\/bootstrap"/u);
    assert.doesNotMatch(source, /目前顯示本機既有資料|已顯示本機既有資料/u);
    assert.match(source, /await loadPersistedPractice\(\)/u);
    assert.match(source, /setPracticeAccount\(undefined\);[\s\S]*setLearners\(\[\]\);[\s\S]*setQuestions\(\[\]\);/u);
    assert.match(source, /error instanceof PracticeApiError && error\.status === 401[\s\S]*clearAuthenticatedWorkspace\("登入狀態已失效/u);
    assert.match(source, /function clearAuthenticatedWorkspace|const clearAuthenticatedWorkspace/u);
    assert.match(source, /setPracticeAccount\(undefined\);[\s\S]*setLearners\(\[\]\);[\s\S]*setQuestions\(\[\]\);[\s\S]*router\.replace\("\/account"\)/u);
});

test("publisher numbers are naturally ordered without exposing the source hash", async () => {
    assert.equal(adapter.publisherQuestionNumber("0123456789abcdef:1"), "1");
    assert.equal(adapter.publisherQuestionNumber("0123456789abcdef:100"), "100");
    assert.equal(adapter.publisherQuestionNumber("原始題號"), "原始題號");
    const store = await readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8");
    assert.match(store, /regexp_replace\(question_identifier\.value, '\^\[0-9A-Fa-f\]\{16\}:', ''\)::numeric/u);
    assert.match(store, /ELSE NULL[\s\S]*END NULLS LAST/u);
});

test("session reads expose lifecycle and revision pins but no answers or grading", async () => {
    const store = await readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8");
    const readSession = store.slice(
        store.indexOf("async function readSession("),
        store.indexOf("export interface CreateLocalPracticeSessionResult"),
    );
    assert.match(readSession, /mode: session\.mode/u);
    assert.match(readSession, /revisionId: item\.question_revision_id/u);
    assert.match(readSession, /AS answered/u);
    assert.doesNotMatch(readSession, /overall_result|answer_part_results|question_answers|answer_payload/u);
});

test("server disclosure policy masks complete and score results at the data boundary", async () => {
    const [store, types, attemptsRoute, scoreMigration] = await Promise.all([
        readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/local-practice-types.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/local-practice/attempts/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../database/migrations/0011_score_session_aggregates.up.sql", import.meta.url), "utf8"),
    ]);
    assert.match(types, /disclosure: "detailed"/u);
    assert.match(types, /disclosure: "masked"/u);
    assert.match(types, /disclosure: "score"/u);
    assert.match(store, /session\.check_mode === "complete" && session\.status === "completed"/u);
    assert.match(store, /session\.check_mode === "score" && session\.status === "completed"/u);
    assert.match(store, /SESSION_ITEM_ALREADY_ANSWERED/u);
    assert.doesNotMatch(store, /if \(item\.session_check_mode !== "instant"\)/u);
    assert.match(store, /session\.created_by_user_id = \$6/u);
    assert.match(store, /attempt\.learner_id = \$1[\s\S]{0,120}attempt\.idempotency_key = \$2/u);
    assert.match(store, /existing\.session_created_by_user_id !== actor\.userId/u);
    const scoreWrite = store.slice(
        store.indexOf('if (item.session_check_mode === "score")'),
        store.indexOf("const attemptId = randomUUID()"),
    );
    assert.match(scoreWrite, /INSERT INTO practice_score_receipts/u);
    assert.match(scoreWrite, /score_answered_count = session\.score_answered_count \+ 1/u);
    assert.doesNotMatch(scoreWrite, /answer_attempts|answer_part_results|learner_practice_queue_items|analytics_outbox/u);
    assert.match(scoreMigration, /DELETE FROM answer_attempts AS attempt/u);
    assert.match(scoreMigration, /DELETE FROM answer_part_results AS result/u);
    assert.match(scoreMigration, /DELETE FROM learner_practice_queue_items AS queue/u);
    assert.match(scoreMigration, /DELETE FROM analytics_outbox AS event/u);
    assert.match(store, /session\.check_mode = 'instant'[\s\S]*session\.check_mode = 'complete' AND session\.status = 'completed'/u);
    assert.match(store, /GROUP BY session\.id[\s\S]*LIMIT \$2 OFFSET \$3/u);
    assert.doesNotMatch(attemptsRoute, /result\.attempt|result\.summary|result\.receipt/u);
    assert.match(attemptsRoute, /const \{ replayed, \.\.\.data \} = result/u);
});
