import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Load the production TypeScript module with the same extensionless imports used by Next.
async function loadModule(relativePath) {
    const url = new URL(relativePath, import.meta.url);
    let source = await readFile(url, "utf8");
    source = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    for (const match of source.matchAll(/from "(\.\.?\/[^"\n]+)"/gu)) {
        const dependency = await loadModule(new URL(`${match[1]}.ts`, url).href);
        source = source.replaceAll(`from "${match[1]}"`, `from "${dependency}"`);
    }
    return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

const {
    ALL_QUESTION_FILTERS,
    DEFAULT_QUESTION_FILTERS,
    filterQuestions,
    getPreferredQuestionSemester,
    getQuestionFilterOptions,
    normalizeQuestionFilterSelection,
    normalizeQuestionFilters,
} = await import(await loadModule("../app/lib/question-filters.ts"));

const ALL_UNITS = "all-units";
const getUnitScopeValue = (question) => `${question.subject}::${question.unit}`;

function makeQuestion(id, values = {}) {
    return {
        id,
        subject: "國語",
        grade: "國一",
        semester: "上學期",
        bookVersion: "翰林",
        unit: `第${id}課`,
        topic: `主題${id}`,
        knowledge: `知識點${id}`,
        difficulty: "基礎",
        kind: "choice",
        prompt: `題目${id}`,
        answer: "A",
        explanation: "",
        source: "題庫題目",
        sourceCategory: "題庫題目",
        ...values,
    };
}

const questions = [
    makeQuestion(1, { unit: "第一冊・第一課", difficulty: "基礎", kind: "choice" }),
    makeQuestion(2, {
        unit: "第一冊・第二課",
        difficulty: "進階",
        kind: "written",
        source: "素養題",
        sourceCategory: "素養題",
    }),
    makeQuestion(3, {
        unit: "學校第一次段考",
        bookVersion: undefined,
        topic: undefined,
        difficulty: "中等",
        kind: "boolean",
        source: "學校段考",
        sourceCategory: "校內卷",
    }),
    makeQuestion(4, {
        semester: "下學期",
        bookVersion: "南一",
        unit: "第二冊・第一課",
        difficulty: "進階",
        kind: "multi-choice",
    }),
];

function filters(values = {}) {
    return {
        ...DEFAULT_QUESTION_FILTERS,
        subject: "國語",
        ...values,
    };
}

test("四個複選條件的空陣列都表示不限制", () => {
    assert.deepEqual(
        filterQuestions(questions, filters(), []).map((question) => question.id),
        [1, 2, 3, 4],
    );
});

test("切換科目只會套用真的有候選題目的學習者學期", () => {
    assert.equal(getPreferredQuestionSemester(questions, "國語", "上學期"), "上學期");
    assert.equal(getPreferredQuestionSemester(questions, "國語", "暑假"), ALL_QUESTION_FILTERS);
    assert.equal(getPreferredQuestionSemester(questions, "全部", "上學期"), ALL_QUESTION_FILTERS);
});

test("同欄複選使用 OR，不同欄使用 AND", () => {
    const firstScope = getUnitScopeValue(questions[0]);
    const secondScope = getUnitScopeValue(questions[1]);
    const selected = filters({
        semester: "上學期",
        version: "翰林",
        scope: [firstScope, secondScope],
        source: ["題庫題目", "素養題"],
        difficulty: ["基礎", "進階"],
        kind: ["choice", "written"],
    });

    assert.deepEqual(filterQuestions(questions, selected, []).map((question) => question.id), [1, 2]);
    assert.deepEqual(
        filterQuestions(questions, { ...selected, kind: ["choice"] }, []).map((question) => question.id),
        [1],
    );
    assert.deepEqual(
        filterQuestions(questions, { ...selected, source: ["素養題"] }, []).map((question) => question.id),
        [2],
    );
});

test("不綁教材版本的來源不會被版本條件排除", () => {
    const selected = filters({ source: ["題庫題目", "校內卷"] });

    assert.deepEqual(
        filterQuestions(questions, { ...selected, version: "翰林" }, []).map((question) => question.id),
        [1, 3],
    );
    assert.deepEqual(
        filterQuestions(questions, { ...selected, version: "南一" }, []).map((question) => question.id),
        [3, 4],
    );
});

test("上游條件變更後移除已不存在的複選值", () => {
    const normalized = normalizeQuestionFilters(filters({
        semester: "上學期",
        version: "翰林",
        source: ["題庫題目", "會考"],
        scope: [getUnitScopeValue(questions[0]), "國語::不存在的單元"],
        difficulty: ["基礎", "未知難度"],
        kind: ["choice", "boolean"],
    }), questions, []);

    assert.deepEqual(normalized.source, ["題庫題目"]);
    assert.deepEqual(normalized.scope, [getUnitScopeValue(questions[0])]);
    assert.deepEqual(normalized.difficulty, ["基礎"]);
    assert.deepEqual(normalized.kind, ["choice"]);
});

test("學期變更時會先校正版本，再清理下游條件", () => {
    const normalized = normalizeQuestionFilters(filters({
        semester: "下學期",
        version: "翰林",
        source: ["題庫題目"],
        scope: [getUnitScopeValue(questions[0])],
        difficulty: ["基礎"],
        kind: ["choice"],
    }), questions, []);

    assert.equal(normalized.version, ALL_QUESTION_FILTERS);
    assert.deepEqual(normalized.source, ["題庫題目"]);
    assert.deepEqual(normalized.scope, []);
    assert.deepEqual(normalized.difficulty, []);
    assert.deepEqual(normalized.kind, []);
});

test("只選不綁版本與知識點的來源時清掉隱藏條件", () => {
    const selected = filters({
        version: "翰林",
        source: ["校內卷"],
        topic: "主題1",
        knowledge: "知識點3",
    });
    const options = getQuestionFilterOptions(questions, selected, []);
    const normalized = normalizeQuestionFilters(selected, questions, []);

    assert.equal(options.showVersion, false);
    assert.equal(options.showTopic, false);
    assert.equal(options.showKnowledge, false);
    assert.equal(normalized.version, ALL_QUESTION_FILTERS);
    assert.equal(normalized.topic, ALL_QUESTION_FILTERS);
    assert.equal(normalized.knowledge, ALL_QUESTION_FILTERS);
    assert.deepEqual(normalized.source, ["校內卷"]);
});

test("混合來源仍顯示適用於部分題目的版本與知識點", () => {
    const options = getQuestionFilterOptions(questions, filters({
        source: ["題庫題目", "校內卷"],
    }), []);

    assert.equal(options.showVersion, true);
    assert.equal(options.showTopic, true);
    assert.equal(options.showKnowledge, true);
});

test("不限來源時會以實際候選來源決定是否顯示版本", () => {
    const options = getQuestionFilterOptions([questions[2]], filters(), []);

    assert.equal(options.showVersion, false);
    assert.equal(options.showTopic, false);
    assert.equal(options.showKnowledge, false);
});

test("舊版單選值會轉成陣列，全部條件與重複值會被移除", () => {
    assert.deepEqual(normalizeQuestionFilterSelection(ALL_UNITS, ALL_UNITS), []);
    assert.deepEqual(normalizeQuestionFilterSelection(ALL_QUESTION_FILTERS), []);
    assert.deepEqual(normalizeQuestionFilterSelection(["基礎", "基礎", " ", ALL_QUESTION_FILTERS]), ["基礎"]);
});
