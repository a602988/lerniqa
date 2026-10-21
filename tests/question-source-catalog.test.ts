import assert from "node:assert/strict";
import test from "node:test";
import { matchQuestionSourceCatalog } from "../app/lib/question-source-catalog.ts";

const CATALOG = [{
    bookVersionId: "40000000-0000-4000-8000-000000000001",
    bookVersionName: "翰林版",
    gradeId: "20000000-0000-4000-8000-000000000001",
    gradeCode: "junior-high-1",
    gradeName: "國一",
    semesterId: "30000000-0000-4000-8000-000000000001",
    semesterName: "上學期",
    subjectAliases: ["國文"],
    subjectId: "10000000-0000-4000-8000-000000000001",
    subjectName: "國語",
    unitId: "50000000-0000-4000-8000-000000000001",
    unitName: "第四課",
    unitType: "lesson",
}];

test("exact unique unit text suggests its existing subject, grade, semester and version", () => {
    const suggestion = matchQuestionSourceCatalog("七年級國文（上）\n第四課 論語選", CATALOG);

    assert.deepEqual(suggestion, {
        bookVersionId: CATALOG[0]!.bookVersionId,
        bookVersionName: "翰林版",
        gradeId: CATALOG[0]!.gradeId,
        gradeName: "國一",
        semesterId: CATALOG[0]!.semesterId,
        semesterName: "上學期",
        subjectId: CATALOG[0]!.subjectId,
        subjectName: "國語",
        unitId: CATALOG[0]!.unitId,
        unitName: "第四課",
    });
});

test("ambiguous unit text stays unclassified", () => {
    const duplicate = {
        ...CATALOG[0]!,
        bookVersionId: "40000000-0000-4000-8000-000000000002",
        unitId: "50000000-0000-4000-8000-000000000002",
    };

    assert.equal(matchQuestionSourceCatalog("第四課", [...CATALOG, duplicate]), null);
});

test("grade text disambiguates the same unit name across grades", () => {
    const eighthGrade = {
        ...CATALOG[0]!,
        gradeId: "20000000-0000-4000-8000-000000000002",
        gradeCode: "junior-high-2",
        gradeName: "國二",
        unitId: "50000000-0000-4000-8000-000000000002",
    };

    const suggestion = matchQuestionSourceCatalog("七年級國文（上） 第四課", [...CATALOG, eighthGrade]);

    assert.equal(suggestion?.gradeName, "國一");
    assert.equal(suggestion?.unitId, CATALOG[0]!.unitId);
});

test("unit matching normalizes spaces and full-width punctuation without fuzzy guessing", () => {
    assert.ok(matchQuestionSourceCatalog("第 四 課：論語選", CATALOG));
    assert.equal(matchQuestionSourceCatalog("論語選", CATALOG), null);
});
