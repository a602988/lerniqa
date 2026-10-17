import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("recommendations use one server-authoritative queue source contract", async () => {
    const [route, client, store] = await Promise.all([
        read("../app/api/v1/local-practice/recommendations/route.ts"),
        read("../app/lib/practice-client.ts"),
        read("../app/lib/local-practice-store.ts"),
    ]);

    assert.match(route, /sourceQueueItemIds/u);
    assert.match(route, /action === "preview"/u);
    assert.match(route, /createLocalPracticeRecommendationSession/u);
    assert.doesNotMatch(route, /sourceQuestionIds/u);
    assert.match(client, /previewPersistedPracticeRecommendations/u);
    assert.match(client, /startPersistedPracticeRecommendations/u);
    assert.match(client, /wrongReviewQueueItems = \[\.\.\.\(history\.wrongReviewQueue\?\.items/u);
    assert.match(client, /wrongReviewQueueItems\.push/u);
    assert.match(store, /queue\.learner_id = \$2/u);
    assert.match(store, /source_result\.current_result = 'wrong'/u);
    assert.match(store, /source_question\.current_revision_id = queue\.question_revision_id/u);
    assert.match(store, /source_session\.check_mode = 'complete'[\s\S]*source_session\.status = 'completed'/u);
    assert.match(store, /NOT EXISTS \([\s\S]*newer_result/u);
    assert.match(store, /ORDER BY queue\.created_at DESC, queue\.id DESC[\s\S]*LIMIT \$2 OFFSET \$3/u);
});

test("the database query chooses a complete same-type tier before confirmed similarity", async () => {
    const store = await read("../app/lib/local-practice-store.ts");
    const selector = store.slice(
        store.indexOf("async function selectRecommendationQuestions"),
        store.indexOf("async function buildRecommendationResult"),
    );

    assert.match(selector, /original_question_type_label = \$6::text/u);
    assert.match(selector, /source_category_id = \$7::uuid/u);
    assert.match(selector, /WITH eligible AS/u);
    assert.match(selector, /same_type AS/u);
    assert.match(selector, /confirmed_similar AS/u);
    assert.match(selector, /NOT EXISTS \(SELECT 1 FROM same_type\)/u);
    assert.match(selector, /question_similarity_groups[\s\S]*status = 'confirmed'/u);
    assert.match(selector, /source_membership\.based_on_revision_id = \$3/u);
    assert.match(selector, /target_membership\.based_on_revision_id = candidate_revision\.id/u);
    assert.doesNotMatch(selector, /question_similarity_candidates|question_generation_relations/u);
});

test("candidate gates cover scope, learner banks, and complete independently gradable answers", async () => {
    const store = await read("../app/lib/local-practice-store.ts");
    const selector = store.slice(
        store.indexOf("async function selectRecommendationQuestions"),
        store.indexOf("async function buildRecommendationResult"),
    );

    for (const contract of [
        /candidate\.status = 'published'/u,
        /candidate\.id <> \$2/u,
        /candidate_revision\.subject_id = \$8/u,
        /candidate_revision\.grade_id = \$9/u,
        /candidate_revision\.book_version_id = \$11/u,
        /candidate_revision_unit\.curriculum_unit_id = \$13/u,
        /question_bank_learners/u,
        /bank_learner\.learner_id = \$1/u,
        /learner_subject_settings/u,
        /is_independently_gradable = true/u,
        /lerniqa_automatic_part_has_complete_answer/u,
        /question_options/u,
        /root_prompt\.question_part_id IS NULL/u,
        /part_prompt\.question_part_id = part\.id/u,
        /option_block\.question_option_id = option\.id/u,
        /scan_status = 'clean'/u,
        /purpose = 'question_content'/u,
        /FROM question_content_blocks AS invalid_media/u,
        /invalid_media\.asset_id IS NULL[\s\S]*invalid_media_asset\.id IS NULL/u,
    ]) assert.match(selector, contract);
});

test("topic recommendations rank stronger overlap and retire latest-correct questions", async () => {
    const store = await read("../app/lib/local-practice-store.ts");
    const selector = store.slice(
        store.indexOf("async function selectRecommendationQuestions"),
        store.indexOf("async function buildRecommendationResult"),
    );

    assert.match(selector, /question_revision_topics AS candidate_topic/u);
    assert.match(selector, /source_topic\.question_revision_id = \$3/u);
    assert.match(selector, /shared_topic_count > 0/u);
    assert.match(selector, /'topic_similar'::text/u);
    assert.match(selector, /latest_result\.current_result IS DISTINCT FROM 'correct'/u);
    assert.match(selector, /ORDER BY[\s\S]*has_previous_attempt ASC,[\s\S]*shared_topic_count DESC/u);
});

test("session creation durably replays the exact request and writes explicit 0012 provenance", async () => {
    const store = await read("../app/lib/local-practice-store.ts");
    const creator = store.slice(
        store.indexOf("export async function createLocalPracticeRecommendationSession"),
        store.indexOf("async function readSession"),
    );

    assert.ok(
        creator.indexOf("FROM practice_recommendation_requests")
            < creator.indexOf("buildRecommendationResult"),
        "the durable receipt must be checked before candidates are recomputed",
    );
    assert.match(creator, /readStoredRecommendationResult\(client, receipt, actor\)/u);
    assert.match(creator, /withLocalPostgresSerializableTransaction/u);
    assert.match(creator, /sourcePairs\.map\(\(pair\) => pair\.queueItemId\)[\s\S]*sourcePairs\.map\(\(pair\) => pair\.sourceResultId\)/u);
    assert.match(creator, /requested_limit, check_mode, request_hash/u);
    assert.match(creator, /\.\.\.built\.result,[\s\S]*availableCount: built\.candidates\.length,[\s\S]*session: await readSession/u);
    assert.ok(
        creator.lastIndexOf("readRecommendationSources")
            < creator.indexOf("INSERT INTO practice_recommendation_requests"),
        "source and candidate eligibility must be revalidated before the receipt commits",
    );
    assert.match(creator, /same_type_review/u);
    assert.match(creator, /same_question_type/u);
    assert.match(creator, /confirmed_group/u);
    assert.match(creator, /same_topic/u);
    assert.match(creator, /INSERT INTO practice_session_item_origins/u);
    assert.match(creator, /queue_item_id[\s\S]*NULL/u);
    assert.match(creator, /origin\.match_basis/u);
    assert.doesNotMatch(creator, /matched_question_type_label/u);
    assert.match(creator, /recommendationKind === "confirmed_similar"[\s\S]*candidate\.similarity_group_id[\s\S]*: null/u);
    assert.match(creator, /if \(checkMode === "score"\)/u);
    assert.doesNotMatch(creator, /UPDATE learner_practice_queue_items|status\s*=\s*'consumed'/u);
    assert.doesNotMatch(creator, /same_unit/u);
});

test("serializable recommendation starts retry only bounded concurrency failures", async () => {
    const postgres = await read("../app/lib/local-postgres.ts");
    const helper = postgres.slice(
        postgres.indexOf("const SERIALIZABLE_TRANSACTION_RETRY_CODES"),
        postgres.indexOf("export async function closeLocalPostgresPool"),
    );

    assert.match(helper, /new Set\(\["40001", "40P01"\]\)/u);
    assert.match(helper, /SERIALIZABLE_TRANSACTION_MAX_RETRIES = 2/u);
    assert.match(helper, /BEGIN ISOLATION LEVEL SERIALIZABLE/u);
    assert.match(helper, /retryCount >= SERIALIZABLE_TRANSACTION_MAX_RETRIES/u);
    assert.match(helper, /must not perform[\s\S]*external side effects/u);
    assert.ok(
        helper.indexOf("pg_advisory_lock") < helper.indexOf("BEGIN ISOLATION LEVEL SERIALIZABLE"),
        "same-session requests must serialize before the transaction snapshot is taken",
    );
    assert.match(helper, /pg_advisory_unlock/u);
});

test("the receipt hash sorts queue/result pairs without breaking their association", async () => {
    const store = await read("../app/lib/local-practice-store.ts");
    const canonicalizer = store.slice(
        store.indexOf("function canonicalRecommendationSourcePairs"),
        store.indexOf("function recommendationRequestHash"),
    );

    assert.match(canonicalizer, /queueItemIds\.map\(\(queueItemId, index\) => \(\{[\s\S]*sourceResultId: sourceResultIds\[index\]/u);
    assert.match(canonicalizer, /\}\)\)\.sort\(\(left, right\) =>/u);
    assert.doesNotMatch(canonicalizer, /queueItemIds[^\n]*\.sort|sourceResultIds[^\n]*\.sort/u);
});

test("the route refuses score-mode extensions because score sessions cannot keep item provenance", async () => {
    const route = await read("../app/api/v1/local-practice/recommendations/route.ts");
    assert.match(route, /\["complete", "instant"\]/u);
    assert.doesNotMatch(route, /\["complete", "instant", "score"\]/u);
});

test("the public catalog retains the fine source type label", async () => {
    const [types, store, adapter] = await Promise.all([
        read("../app/lib/local-practice-types.ts"),
        read("../app/lib/local-practice-store.ts"),
        read("../app/lib/practice-catalog-adapter.ts"),
    ]);
    assert.match(types, /originalTypeLabel: string \| null/u);
    assert.match(store, /revision\.original_question_type_label/u);
    assert.match(store, /attachPracticeCatalogKnowledge\(publicQuestions, knowledgeRows\)/u);
    assert.match(adapter, /question\.originalTypeLabel\?\.trim\(\) \|\| question\.type\.name/u);
});

test("the main UI uses queue-backed recommendation kinds while retaining original wrong-part retry", async () => {
    const page = await read("../app/page.tsx");

    assert.match(page, /previewPersistedPracticeRecommendations/u);
    assert.match(page, /startPersistedPracticeRecommendations/u);
    assert.match(page, /serverQuestion\.revisionId !== item\.revisionId/u);
    assert.doesNotMatch(page, /latestByQuestionRevision|latestByPart/u);
    assert.doesNotMatch(page, /sourceIds\.flatMap|startRecommendationSession\(\[questionId\]/u);
    assert.match(page, /result\.recommendationKind === "same_type"/u);
    assert.match(page, /已確認相似題型/u);
    assert.match(page, /目前沒有可練習的同題型或相似題型/u);
    assert.match(page, />立即測驗</u);
    assert.match(page, /優先練習相同／相近題/u);
    assert.match(page, /startPlannedPractice/u);
    assert.match(page, /beginSession\("review", \[question\.id\]/u);
    assert.doesNotMatch(page, /getRelatedQuestionIds|queueSimilar|usableQueue/u);
});

test("history exposes only current-revision latest visible wrong sources", async () => {
    const store = await read("../app/lib/local-practice-store.ts");
    const history = store.slice(
        store.indexOf("export async function getLocalPracticeHistory"),
        store.indexOf("export async function", store.indexOf("export async function getLocalPracticeHistory") + 1),
    );

    assert.match(history, /result\.current_result = 'wrong'/u);
    assert.match(history, /source_question\.current_revision_id = queue\.question_revision_id/u);
    assert.match(history, /NOT EXISTS \([\s\S]*newer_result/u);
    assert.match(history, /newer_session\.check_mode = 'complete'[\s\S]*newer_session\.status = 'completed'/u);
});
