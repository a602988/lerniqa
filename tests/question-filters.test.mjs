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
        typeLabel: "單一選擇題",
        prompt: `題目${id}`,
        answer: "A",
        explanation: "",
        source: "題庫題目",
        sourceCategory: "題庫題目",
        ...values,
    };
}

const questions = [
    makeQuestion(1, {
        unit: "第一冊・第一課",
        difficulty: "基礎",
        kind: "choice",
        metadata: [
            { key: "cognitive_dimension", label: "認知向度", rawValue: "基本語文知識", values: ["基本語文知識"], valueSource: "document", confidence: 1 },
            { key: "knowledge_dimension", label: "知識向度", rawValue: "正確用字", values: ["正確用字"], valueSource: "document", confidence: 1 },
        ],
    }),
    makeQuestion(2, {
        unit: "第一冊・第二課",
        difficulty: "進階",
        kind: "written",
        typeLabel: "改錯題",
        source: "素養題",
        sourceCategory: "素養題",
    }),
    makeQuestion(3, {
        unit: "學校第一次段考",
        bookVersion: undefined,
        topic: undefined,
        difficulty: "中等",
        kind: "boolean",
        typeLabel: "是非題",
        source: "學校段考",
        sourceCategory: "校內卷",
    }),
    makeQuestion(4, {
        semester: "下學期",
        bookVersion: "南一",
        unit: "第二冊・第一課",
        difficulty: "進階",
        kind: "multi-choice",
        typeLabel: "題組",
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

test("搜尋可比對題目文字與編號欄的所有顯示來源", () => {
    const searchableQuestions = [
        makeQuestion(3429001, { code: "05013429", prompt: "孔子被尊稱為至聖先師" }),
        makeQuestion(3429002, {
            code: undefined,
            prompt: "來源文件題號搜尋",
            sourceDetail: {
                documentName: "題庫.docx",
                questionNumber: "DOC-7788",
                valueSource: "document",
                confidence: 1,
            },
        }),
        makeQuestion(3429003, { code: undefined, prompt: "系統編號備援搜尋" }),
    ];

    assert.deepEqual(filterQuestions(searchableQuestions, filters({ search: "至聖先師" }), []).map((question) => question.id), [3429001]);
    assert.deepEqual(filterQuestions(searchableQuestions, filters({ search: "13429" }), []).map((question) => question.id), [3429001]);
    assert.deepEqual(filterQuestions(searchableQuestions, filters({ search: "7788" }), []).map((question) => question.id), [3429002]);
    assert.deepEqual(filterQuestions(searchableQuestions, filters({ search: "3429003" }), []).map((question) => question.id), [3429003]);
});

test("搜尋可比對公式的可讀文字投影", () => {
    const searchableQuestions = [
        makeQuestion(1501004796, {
            subject: "數學",
            prompt: "在下列空格內填入適當的數",
            searchText: String.raw`\frac{6}{8} 6/8`,
        }),
    ];

    assert.deepEqual(
        filterQuestions(searchableQuestions, { ...filters({ subject: "數學" }), search: "6/8" }, []).map((question) => question.id),
        [1501004796],
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

test("題型選項與篩選使用正式題型名稱，而不是粗略作答形式", () => {
    const options = getQuestionFilterOptions(questions, filters(), []);

    assert.deepEqual(new Set(options.kinds.map((option) => option.label)), new Set(["單一選擇題", "改錯題", "是非題", "題組"]));
    assert.deepEqual(
        filterQuestions(questions, filters({ kind: ["改錯題"] }), []).map((question) => question.id),
        [2],
    );
});

test("科目與其餘目錄欄位可複選，收藏清單取聯集", () => {
    const catalogQuestions = [
        makeQuestion(11, {
            topic: "閱讀",
            knowledge: "字義",
            metadata: [
                { key: "creator", label: "建立者", rawValue: "教師甲", values: ["教師甲"], valueSource: "document", confidence: 1 },
                { key: "cognitive_dimension", label: "認知向度", rawValue: "記憶", values: ["記憶"], valueSource: "document", confidence: 1 },
            ],
        }),
        makeQuestion(12, {
            subject: "數學",
            topic: "運算",
            knowledge: "整數",
            metadata: [
                { key: "creator", label: "建立者", rawValue: "教師乙", values: ["教師乙"], valueSource: "document", confidence: 1 },
                { key: "cognitive_dimension", label: "認知向度", rawValue: "應用", values: ["應用"], valueSource: "document", confidence: 1 },
            ],
        }),
    ];
    const collections = [
        { id: "collection-a", name: "甲", learnerId: "learner", questionIds: [11] },
        { id: "collection-b", name: "乙", learnerId: "learner", questionIds: [12] },
    ];
    const selected = filters({
        subject: ["國語", "數學"],
        topic: ["閱讀", "運算"],
        knowledge: ["字義", "整數"],
        creator: ["教師甲", "教師乙"],
        metadata: { cognitive_dimension: ["記憶", "應用"] },
        collection: ["collection-a", "collection-b"],
    });

    assert.deepEqual(filterQuestions(catalogQuestions, selected, collections).map((question) => question.id), [11, 12]);
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
    assert.deepEqual(normalized.kind, ["單一選擇題"]);
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

test("文件欄位未先選來源也會顯示，並可依 tag 值篩選", () => {
    const options = getQuestionFilterOptions(questions, filters(), []);

    assert.deepEqual(options.facets.map((facet) => facet.key), ["cognitive_dimension", "knowledge_dimension"]);
    assert.deepEqual(
        filterQuestions(questions, filters({ metadata: { knowledge_dimension: "正確用字" } }), []).map((question) => question.id),
        [1],
    );
});

test("舊版單選值會轉成陣列，全部條件與重複值會被移除", () => {
    assert.deepEqual(normalizeQuestionFilterSelection(ALL_UNITS, ALL_UNITS), []);
    assert.deepEqual(normalizeQuestionFilterSelection(ALL_QUESTION_FILTERS), []);
    assert.deepEqual(normalizeQuestionFilterSelection(["基礎", "基礎", " ", ALL_QUESTION_FILTERS]), ["基礎"]);
});
