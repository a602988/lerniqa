import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const database = JSON.parse(await readFile(new URL("../data/fixtures/database.json", import.meta.url), "utf8"));
const expectedTypes = {
    國語: ["寫出國字、注音", "注釋", "改錯題", "填充題", "配合題", "單一選擇題", "選詞測驗", "題組"],
    數學: ["選擇", "填充", "計算"],
    英文: ["字彙選擇", "文法選擇", "對話與完成句子", "填充題", "依提示作答", "翻譯", "克漏字測驗", "閱讀測驗", "看圖回答問題"],
    理化: ["選擇", "填充", "題組"],
    生物: ["選擇", "填充", "題組"],
    歷史: ["單題", "題組", "填充題", "配合題", "簡答題"],
    地理: ["單題", "題組", "填充題", "配合題", "簡答題"],
    公民: ["單題", "題組", "填充題", "配合題", "簡答題"],
};
const minimumQuestionsBySubject = { 理化: 1, 歷史: 1, 公民: 1 };
const gradeSevenQuestions = database.questions.filter((question) => question.grade === "國一");

/**
 * 將同一大題拆出的多個小題視為一個來源題目。
 * @param {Array<Record<string, unknown>>} questions 題庫資料。
 * @returns {Array<Record<string, unknown>>} 不重複計算大題的題目。
 */
function getLogicalQuestions(questions) {
    return [...new Map(questions.map((question) => [question.group?.id ?? `question-${question.id}`, question])).values()];
}

for (const [subject, types] of Object.entries(expectedTypes)) {
    const subjectQuestions = gradeSevenQuestions.filter((question) => question.subject === subject);
    assert.deepEqual([...new Set(subjectQuestions.map((question) => question.typeLabel))], types);

    for (const type of types) {
        const typeQuestions = getLogicalQuestions(subjectQuestions.filter((question) => question.typeLabel === type));
        const minimum = minimumQuestionsBySubject[subject] ?? 3;
        assert.ok(typeQuestions.length >= minimum, `${subject}／${type} 至少應有 ${minimum} 題`);
    }
}

assert.equal(getLogicalQuestions(gradeSevenQuestions).length, 101);
assert.ok(gradeSevenQuestions.every((question) => question.sourceDetail?.valueSource === "document"));
assert.ok(gradeSevenQuestions.every((question) => question.sourceDetail?.questionNumber));
assert.ok(gradeSevenQuestions.every((question) => question.sourceAnswer));
assert.ok(gradeSevenQuestions.every((question) => question.bookVersion && question.chapter && question.unit && question.knowledge));
assert.ok(gradeSevenQuestions.every((question) => question.unit === question.sourceDetail.documentName.replace(/\.[^.]+$/, "")), "單元必須保留來源文件檔名中的編號");
assert.equal(gradeSevenQuestions.filter((question) => question.kind === "written" && question.options?.length).length, 0);
assert.equal(gradeSevenQuestions.filter((question) => question.kind === "multi-choice" && !question.parts?.length).length, 0);
assert.equal(gradeSevenQuestions.filter((question) => question.blocks?.some((block) => block.type === "image")).length, 9);
assert.ok(gradeSevenQuestions.some((question) => {
    const promptTypes = question.blocks?.filter((block) => block.placement === "prompt").sort((left, right) => left.order - right.order).map((block) => block.type);
    return promptTypes?.join(",") === "text,image,text";
}), "至少一題必須具備文字、圖片、文字交錯內容");
assert.deepEqual(
    ["1501003946", "1501004060", "1501000035", "1501000047"].filter((code) => !gradeSevenQuestions.some((question) => question.code === code)),
    [],
    "指定的四題數學題必須寫入 fixture",
);
const compoundWrittenQuestions = gradeSevenQuestions
    .filter((question) => question.group?.id === "1501003362")
    .sort((left, right) => left.group.part - right.group.part);
assert.equal(compoundWrittenQuestions.length, 2);
assert.ok(compoundWrittenQuestions.every((question) => question.kind === "written"));
assert.deepEqual(compoundWrittenQuestions.map((question) => question.answer), ["±3", "0、±1、±2"]);

console.log("已驗證國一八科共 41 種來源題型：原有五科每型至少三題，新增三科每型至少一題，共 101 題。");
