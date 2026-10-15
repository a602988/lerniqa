import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectSubject } from "./import-grade-seven-fixtures.mjs";

const SOURCE_ROOT = process.argv[2];
const FIXTURE_DATABASE = new URL("../data/fixtures/database.json", import.meta.url);
const RUNTIME_DATABASE = new URL("../runtime-data/database.json", import.meta.url);
const SOURCE_TYPES = ["單題", "題組", "填充題", "配合題", "簡答題"];

if (!SOURCE_ROOT) throw new Error("請提供國中題庫來源目錄。");

const SUBJECTS = [
    {
        subject: "理化",
        version: "康軒",
        sourceBook: "第三冊",
        style: "metadata-first",
        directory: "國中自然/01_題庫題目/第三冊",
        types: ["選擇", "填充", "題組"],
        sampleCount: 1,
        startId: 7100,
    },
    {
        subject: "歷史",
        version: "南一",
        style: "metadata-last",
        directory: "國中社會/題本檔案/01_第一冊/01_試題",
        types: SOURCE_TYPES,
        sampleCount: 1,
        pathFilter: (filePath) => /^\d+_02_/.test(path.basename(filePath)),
        startId: 7200,
    },
    {
        subject: "公民",
        version: "南一",
        style: "metadata-last",
        directory: "國中社會/題本檔案/01_第一冊/01_試題",
        types: SOURCE_TYPES,
        sampleCount: 1,
        pathFilter: (filePath) => /^\d+_03_/.test(path.basename(filePath)),
        startId: 7300,
    },
];

/**
 * 將缺少科目的代表題寫入指定資料庫。
 * @param {URL} databaseUrl 題庫 JSON 路徑。
 * @param {Array<Record<string, unknown>>} questions 新增的代表題。
 * @returns {Promise<void>}
 */
async function updateDatabase(databaseUrl, questions)
{
    const database = JSON.parse(await readFile(databaseUrl, "utf8"));
    const replacedSubjects = new Set(SUBJECTS.map(({ subject }) => subject));
    const retainedQuestions = database.questions.filter((question) => question.grade !== "國一" || !replacedSubjects.has(question.subject));
    const retainedIds = new Set(retainedQuestions.map((question) => question.id));
    const conflictingQuestion = questions.find((question) => retainedIds.has(question.id));
    if (conflictingQuestion) throw new Error(`題目 ID ${conflictingQuestion.id} 已被其他科目使用。`);

    database.questions = [...retainedQuestions, ...questions];
    const batchIds = new Set(SUBJECTS.map(({ subject }) => `fixture-import-${subject}`));
    const batches = SUBJECTS.map(({ subject }) => {
        const subjectQuestions = questions.filter((question) => question.subject === subject);
        return {
            id: `fixture-import-${subject}`,
            createdAt: "2026-10-15T10:00:00.000Z",
            fileNames: [...new Set(subjectQuestions.map((question) => question.sourceDetail.documentName))],
            questionIds: subjectQuestions.map((question) => question.id),
            status: "confirmed",
        };
    });
    database.imports = [...database.imports.filter((batch) => !batchIds.has(batch.id)), ...batches];
    await writeFile(databaseUrl, `${JSON.stringify(database, null, 2)}\n`, "utf8");
}

/** 匯入理化、歷史與公民各題型的代表題。 */
async function main()
{
    const questions = [];

    for (const config of SUBJECTS) {
        const subjectQuestions = await collectSubject(config, config.startId);
        questions.push(...subjectQuestions);
        console.log(`${config.subject}：${subjectQuestions.length} 題`);
    }

    await updateDatabase(FIXTURE_DATABASE, questions);

    try {
        await updateDatabase(RUNTIME_DATABASE, questions);
    }
    catch (error) {
        if (error?.code !== "ENOENT") throw error;
    }

    console.log(`已補上 ${questions.length} 題缺少科目的來源代表題。`);
}

await main();
