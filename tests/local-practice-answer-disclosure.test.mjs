import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadModule(relativePath) {
    const url = new URL(relativePath, import.meta.url);
    let source = await readFile(url, "utf8");
    const javascript = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    source = javascript;
    for (const match of javascript.matchAll(/from "(\.\.?\/[^"\n]+)"/gu)) {
        source = source.replaceAll(`from "${match[1]}"`, `from "${await loadModule(new URL(`${match[1]}.ts`, url).href)}"`);
    }
    return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

const types = await import(await loadModule("../app/lib/local-practice-types.ts"));

test("answer disclosure policy never unlocks score and waits for complete-mode completion", () => {
    for (const status of ["active", "paused", "completed", "abandoned"]) {
        assert.equal(types.canDiscloseLocalPracticeReferenceAnswers("score", status), false);
    }
    assert.equal(types.canDiscloseLocalPracticeReferenceAnswers("instant", "active"), true);
    assert.equal(types.canDiscloseLocalPracticeReferenceAnswers("complete", "active"), false);
    assert.equal(types.canDiscloseLocalPracticeReferenceAnswers("complete", "paused"), false);
    assert.equal(types.canDiscloseLocalPracticeReferenceAnswers("complete", "abandoned"), false);
    assert.equal(types.canDiscloseLocalPracticeReferenceAnswers("complete", "completed"), true);
});

test("manual-review grading stays pending even when an unlocked attempt can show its reference", () => {
    const decision = types.gradeLocalPracticePart({
        answerMode: "single_choice",
        gradingPolicy: "manual_review",
        acceptedKeys: ["A"],
        acceptedValues: [],
        validOptionKeys: ["A", "B"],
    }, "A");

    assert.deepEqual(decision, {
        result: "pending",
        gradingSource: "manual_review",
        feedbackCode: "manual_review",
        answerPayload: { value: "A" },
    });
    assert.equal(types.canDiscloseLocalPracticeReferenceAnswers("instant", "completed"), true);
});

test("isolated practice E2E includes a publishable manual-review question", async () => {
    const fixture = await readFile(
        new URL("../scripts/seed-local-practice-test-fixture.mjs", import.meta.url),
        "utf8",
    );
    assert.match(fixture, /isManualReview = sequence === QUESTION_COUNT/u);
    assert.match(fixture, /questionTypeCode: "written"/u);
    assert.match(fixture, /answerMode: "text"/u);
    assert.match(fixture, /gradingPolicy: "manual_review"/u);
    assert.match(fixture, /answer: \{ acceptedValue:/u);
});

test("catalog stays answer-free while detailed attempts read the session-pinned revision", async () => {
    const store = await readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8");
    const catalog = store.slice(
        store.indexOf("export async function readLocalPracticeCatalog("),
        store.indexOf("async function readSession("),
    );
    assert.doesNotMatch(catalog, /question_answers|accepted_value|answer_key/u);

    const disclosure = store.slice(
        store.indexOf("async function getAttemptReferenceAnswers("),
        store.indexOf("function toAttemptReceipt("),
    );
    assert.match(disclosure, /JOIN practice_session_items AS item/u);
    assert.match(disclosure, /part\.question_revision_id = item\.question_revision_id/u);
    assert.match(disclosure, /answer\.answer_key/u);
    assert.match(disclosure, /answer\.accepted_value/u);
    assert.match(disclosure, /block\.placement = 'explanation'/u);
    assert.match(disclosure, /option_content\.label AS option_label/u);
    assert.match(disclosure, /COALESCE\(block\.text_content, block\.alt_text\)/u);
    assert.equal(
        [...disclosure.matchAll(/string_agg\(COALESCE\(block\.text_content, block\.alt_text\), '' ORDER BY/gu)].length,
        4,
    );
    assert.doesNotMatch(
        disclosure,
        /string_agg\(COALESCE\(block\.text_content, block\.alt_text\), E'\\n' ORDER BY/gu,
    );
});

test("explicit question review requires result access, current revision, visibility and no-store", async () => {
    const [store, route, shared] = await Promise.all([
        readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/local-practice/questions/[questionId]/reference-answer/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/local-practice/_shared.ts", import.meta.url), "utf8"),
    ]);
    const reader = store.slice(
        store.indexOf("export async function getLocalPracticeQuestionReferenceAnswers("),
        store.indexOf("function toAttemptReceipt("),
    );
    assert.match(reader, /await requireLocalPracticeResultAccess\(client, actor\)/u);
    assert.match(reader, /revision\.id = question\.current_revision_id/u);
    assert.match(reader, /revision\.id = \$2/u);
    assert.match(reader, /bank_learner\.learner_id = \$3/u);
    assert.match(route, /requireLocalPracticeAccount/u);
    assert.match(route, /revisionId/u);
    assert.match(shared, /Cache-Control", "private, no-store"/u);
});

test("wrong-review items preserve part identity from creation through submission", async () => {
    const [typesSource, store, sessionsRoute, attemptsRoute] = await Promise.all([
        readFile(new URL("../app/lib/local-practice-types.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/local-practice/sessions/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/local-practice/attempts/route.ts", import.meta.url), "utf8"),
    ]);
    assert.match(typesSource, /partId\?: string/u);
    assert.match(typesSource, /partId: string \| null/u);
    assert.match(sessionsRoute, /target\.partId \?\? "all"/u);
    assert.match(store, /item\.question_part_id/u);
    assert.match(store, /'wrong_review'/u);
    assert.match(store, /selected_part\.question_revision_id = target\.revision_id/u);
    assert.match(store, /\(\$3::uuid IS NULL OR item\.id = \$3\)/u);
    assert.match(store, /\(\$4::uuid IS NULL OR item\.question_part_id = \$4\)/u);
    assert.match(store, /\(\$2::uuid IS NULL OR part\.id = \$2\)/u);
    assert.match(store, /INCOMPLETE_ANSWER/u);
    assert.match(store, /SELECT count\(\*\)::integer AS count[\s\S]*SESSION_QUESTION_AMBIGUOUS/u);
    assert.match(attemptsRoute, /value\.sessionItemId/u);
    assert.match(attemptsRoute, /value\.partId/u);
    assert.match(attemptsRoute, /value\.sessionItemId\.toLowerCase\(\)/u);
    assert.match(sessionsRoute, /entry\.questionId\.toLowerCase\(\)/u);
});

test("non-score idempotency lookup detects another authorized account before insert", async () => {
    const store = await readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8");
    const lookup = store.slice(
        store.indexOf("const existingResult = await client.query<AttemptRow>"),
        store.indexOf("const existing = existingResult.rows[0]"),
    );
    assert.match(lookup, /attempt\.learner_id = \$1[\s\S]*attempt\.idempotency_key = \$2/u);
    assert.doesNotMatch(lookup, /session\.created_by_user_id = \$3/u);
    assert.match(store, /existing\.session_created_by_user_id !== actor\.userId/u);
});

test("score writes and responses remain answer-free", async () => {
    const store = await readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8");
    const scoreWrite = store.slice(
        store.indexOf('if (item.session_check_mode === "score")'),
        store.indexOf("const attemptId = randomUUID()"),
    );
    assert.match(scoreWrite, /INSERT INTO practice_score_receipts/u);
    assert.doesNotMatch(scoreWrite, /getAttemptReferenceAnswers|answer_part_results/u);
    const scoreDisclosure = store.slice(
        store.indexOf("async function discloseSubmittedScoreReceipt("),
        store.indexOf("async function discloseSubmittedAttempt("),
    );
    assert.doesNotMatch(scoreDisclosure, /referenceAnswers|getAttemptReferenceAnswers/u);
});
