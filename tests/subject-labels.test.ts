import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SUBJECTS } from "../app/lib/demo-data.ts";
import {
    CHINESE_SUBJECT_LABEL,
    getSubjectLookupLabels,
    normalizeSubjectDisplayLabel,
    normalizeSubjectLabel,
    normalizeSubjectLabels,
    normalizeSubjectRecord,
} from "../app/lib/subject-labels.ts";

test("uses 國語 as the learner-facing subject without creating a second catalog subject", async () => {
    const localPracticeTypes = await readFile(new URL("../app/lib/local-practice-types.ts", import.meta.url), "utf8");

    assert.equal(CHINESE_SUBJECT_LABEL, "國語");
    assert.equal(SUBJECTS.filter((subject) => subject === CHINESE_SUBJECT_LABEL).length, 1);
    assert.match(localPracticeTypes, /subject:\s*CHINESE_SUBJECT_LABEL/u);
    assert.equal(normalizeSubjectLabel("國文"), "國語");
    assert.equal(normalizeSubjectLabel(" 國語 "), "國語");
});

test("queries the existing 國語 catalog through both current and legacy labels", () => {
    assert.deepEqual(getSubjectLookupLabels("國語"), ["國語", "國文"]);
    assert.deepEqual(getSubjectLookupLabels("國文"), ["國語", "國文"]);
    assert.deepEqual(getSubjectLookupLabels("數學"), ["數學"]);
});

test("collapses legacy and custom 國文 labels into one canonical 國語 subject", () => {
    assert.deepEqual(
        normalizeSubjectLabels([" 國文 ", "國語", "數學", "國文", "資訊科技"]),
        ["國語", "數學", "資訊科技"],
    );
});

test("moves subject-keyed settings to 國語 without discarding their values", () => {
    const legacyRange = { start: "國文::第四課", end: "國文::第四課" };

    assert.deepEqual(normalizeSubjectRecord({ 國文: "翰林" }), { 國語: "翰林" });
    assert.deepEqual(normalizeSubjectRecord({ 國文: legacyRange }), { 國語: legacyRange });
    assert.deepEqual(normalizeSubjectRecord({ 國文: "舊值", 國語: "目前值" }), { 國語: "目前值" });
});

test("normalizes schedule labels while leaving unrelated text unchanged", () => {
    assert.equal(normalizeSubjectDisplayLabel("國文"), "國語");
    assert.equal(normalizeSubjectDisplayLabel("國文 · 翰林版"), "國語 · 翰林版");
    assert.equal(normalizeSubjectDisplayLabel("數學 · 康軒版"), "數學 · 康軒版");
});

test("uses canonical normalization in persisted learner data and custom-subject input", async () => {
    const [mockStore, page] = await Promise.all([
        readFile(new URL("../app/lib/mock-store.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    ]);

    assert.match(mockStore, /normalizeSubjectLabels\(learner\.customSubjects \?\? \[\]\)/u);
    assert.match(mockStore, /normalizeSubjectRecord\(versions/u);
    assert.match(mockStore, /normalizeSubjectRecord\(ranges/u);
    assert.match(mockStore, /currentVersion \|\| legacyVersion \|\| ""/u);
    assert.match(mockStore, /currentRangeIsConfigured/u);
    assert.match(mockStore, /normalizeSubjectDisplayLabel\(schedule\.subjectLabel\)/u);
    assert.match(mockStore, /subject:\s*migrateSubject\(question\.subject/u);
    assert.match(mockStore, /normalizeSubjectLabel\(subject\) === subject/u);
    assert.match(page, /const subject = normalizeSubjectLabel\(subjectChoice === CUSTOM_SUBJECT_VALUE/u);
});
