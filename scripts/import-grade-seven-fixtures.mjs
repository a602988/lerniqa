import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_ROOT = process.argv[2];
const DATABASE_PATH = new URL("../data/fixtures/database.json", import.meta.url);
const ASSET_PATH = new URL("../data/fixtures/assets/", import.meta.url);
const RUNTIME_DATABASE_PATH = new URL("../runtime-data/database.json", import.meta.url);
const RUNTIME_ASSET_PATH = new URL("../runtime-data/assets/", import.meta.url);
export const VISUAL_REFERENCE = /如圖|附圖|附表|下圖|圖中|下表(?!皮)|圖[（(]|圖示/;
export const UNREADABLE_QUESTIONS = new Set(["1501003331", "1501003446"]);
const LEGACY_QUESTION_NUMBERS = new Map([
    [3, "05010001"],
    [7, "05010037"],
    [8, "05010045"],
    [9, "05010065"],
    [10, "05010072"],
    [11, "05010076"],
    [12, "05010234"],
    [13, "05010240"],
]);

const SUBJECTS = [
    {
        subject: "國語",
        version: "翰林",
        style: "metadata-last",
        paths: ["題本檔案 2/01_第一冊/01_試題/01_第一課_夏夜.doc"],
        types: ["寫出國字、注音", "注釋", "改錯題", "填充題", "配合題", "單一選擇題", "選詞測驗", "題組"],
    },
    {
        subject: "數學",
        version: "康軒",
        style: "metadata-first",
        paths: ["題本檔案 3/01_題庫題目/第一冊/1-1　負數與數線.doc"],
        types: ["選擇", "填充", "計算"],
    },
    {
        subject: "英文",
        version: "翰林",
        style: "metadata-last",
        paths: ["國中英語/題本檔案/01_第一冊/01_試題/01_Starter Unit.doc"],
        types: ["字彙選擇", "文法選擇", "對話與完成句子", "填充題", "依提示作答", "翻譯", "克漏字測驗", "閱讀測驗", "看圖回答問題"],
    },
    {
        subject: "生物",
        version: "康軒",
        style: "metadata-first",
        directory: "題本檔案/01_題庫題目/第一冊",
        types: ["選擇", "填充", "題組"],
    },
    {
        subject: "地理",
        version: "南一",
        style: "metadata-last",
        directory: "國中社會/題本檔案/01_第一冊/01_試題",
        types: ["單題", "題組", "填充題", "配合題", "簡答題"],
    },
];

export const CHOICE_TYPES = new Set(["選擇", "單一選擇題", "字彙選擇", "文法選擇", "對話與完成句子", "單題"]);
export const MULTI_TYPES = new Set(["配合題", "選詞測驗", "題組", "克漏字測驗", "閱讀測驗"]);

/** 將全形英文字母轉成一般英文字母，供答案代號比對。 */
function normalizeLetter(value)
{
    const code = value.charCodeAt(0);
    return code >= 0xff21 && code <= 0xff3a ? String.fromCharCode(code - 0xfee0) : value.toUpperCase();
}

/** 清除 DOC 轉出的頁碼、欄位碼與多餘空白，但保留題目原文。 */
export function cleanText(value)
{
    return value
        .replace(/\r/g, "\n")
        .replace(/\u000c/g, "\n")
        .replace(/\u2028/g, "\n")
        .replace(/^\s*EQ \\O\([^\n]*?\)\)\s*/gm, "")
        .replace(/^\s*EMBED [^\n]*$/gm, "")
        .replace(/^\s*PAGE(?:\s+\d+)?\s*$/gm, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/**
 * 清理題幹並保留開頭代表填空的全形空白。
 * @param {string} value 來源文件中的原始題幹。
 * @returns {string} 可供後續拆題的題幹。
 */
export function cleanQuestionBody(value)
{
    const leadingBlank = value.match(/^[\r\n \t]*([　＿_]{2,})(?=\S)/)?.[1] ?? "";
    const body = cleanText(value).replace(/\n答：\s*$/, "").trim();
    return `${leadingBlank}${body}`;
}

/** 讀取 DOC 的可搜尋文字；macOS textutil 能處理來源中的兩種 Word 格式。 */
export function readDocument(relativePath)
{
    const sourcePath = path.join(SOURCE_ROOT, relativePath);
    return cleanText(execFileSync("textutil", ["-convert", "txt", "-stdout", sourcePath], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    }));
}

/** 遞迴列出目錄內的 DOC，確保不同單元可補足每一種題型。 */
async function listDocuments(relativeDirectory)
{
    const root = path.join(SOURCE_ROOT, relativeDirectory);
    const entries = await readdir(root, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const relativePath = path.join(relativeDirectory, entry.name);
        if (entry.isDirectory()) files.push(...await listDocuments(relativePath));
        else if (entry.name.toLowerCase().endsWith(".doc")) files.push(relativePath);
    }

    return files.sort((first, second) => first.localeCompare(second, "zh-Hant"));
}

/** 依來源文件中的題型標題切出各段內容。 */
export function splitSections(text, types)
{
    const escaped = types.map((type) => type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const matcher = new RegExp(`^(${escaped.join("|")})\\s*$`, "gm");
    const matches = [...text.matchAll(matcher)];
    const sections = [];

    matches.forEach((match, index) => {
        const start = (match.index ?? 0) + match[0].length;
        const end = matches[index + 1]?.index ?? text.length;
        sections.push({ type: match[1], content: text.slice(start, end).trim() });
    });

    return sections;
}

/** 解析國語、英文與地理使用的後置欄位格式。 */
export function parseMetadataLast(text, types, documentName)
{
    const records = [];
    const matcher = /([\s\S]*?)\n答案：([^\n]*)(?:\n解析：([\s\S]*?))?\n編號：([^\n]+)\n難易度：([^\n]+)\n出處：([^\n]+)\n認知向度：([^\n]*)\n知識向度：([^\n]*)(?:\n課名：([^\n]*))?/g;

    for (const section of splitSections(text, types)) {
        for (const match of section.content.matchAll(matcher)) {
            records.push({
                type: section.type,
                body: cleanQuestionBody(match[1]),
                sourceAnswer: match[2].trim(),
                explanation: cleanText(match[3] ?? ""),
                number: match[4].trim(),
                difficulty: match[5].trim(),
                origin: match[6].trim(),
                cognitive: match[7].trim(),
                knowledge: match[8].trim(),
                unit: match[9]?.trim() || path.basename(documentName, path.extname(documentName)),
                documentName: path.basename(documentName),
            });
        }
    }

    return records;
}

/** 解析數學與生物使用的前置欄位格式。 */
export function parseMetadataFirst(text, types, documentName)
{
    const records = [];
    for (const section of splitSections(text, types)) {
        const blocks = section.content.split(/(?=^\s*[•]?\s*題號：)/gm);
        for (const block of blocks) {
            const header = block.match(/^\s*[•]?\s*題號：([^\s]+)\s+難易度：([^\s]+)\s+學習內容：([^\s]+)\s+(?:(?:主題|核心素養)：[^\n]+?\s+)*知識點：([^\n]+)\n([\s\S]*)$/);
            if (!header) continue;
            const answerIndex = header[5].indexOf("\n《答案》");
            if (answerIndex < 0) continue;
            const body = header[5].slice(0, answerIndex);
            const answerAndExplanation = header[5].slice(answerIndex + "\n《答案》".length);
            const explanationIndex = answerAndExplanation.indexOf("\n詳解：");
            const sourceAnswer = explanationIndex >= 0
                ? answerAndExplanation.slice(0, explanationIndex)
                : answerAndExplanation;
            const explanation = explanationIndex >= 0
                ? answerAndExplanation.slice(explanationIndex + "\n詳解：".length)
                : "";
            records.push({
                type: section.type,
                body: cleanText(body),
                sourceAnswer: sourceAnswer.trim(),
                explanation: cleanText(explanation),
                number: header[1].trim(),
                difficulty: header[2].trim(),
                origin: "題庫題目",
                knowledge: header[4].trim(),
                unit: path.basename(documentName, path.extname(documentName)).replace(/^\d+[\-_]?/, ""),
                documentName: path.basename(documentName),
            });
        }
    }

    return records;
}

/** 從題幹內取出選項及選項之前的文字。 */
export function parseOptions(body)
{
    const matcher = /[（(]([Ａ-ＨA-H])[）)]/g;
    const matches = [...body.matchAll(matcher)];
    if (matches.length < 2) return null;
    const prompt = body.slice(0, matches[0].index).replace(/^[（(]\s*[）)]/, "").trim();
    const options = matches.map((match, index) => {
        const start = (match.index ?? 0) + match[0].length;
        const end = matches[index + 1]?.index ?? body.length;
        const label = normalizeLetter(match[1]);
        return { label, value: `(${label})${body.slice(start, end).replace(/[。.]\s*$/, "").trim()}` };
    });
    return { prompt, options };
}

/** Parse the Chinese stem labels used by social-studies matching questions. */
function parseChineseLabeledOptions(body)
{
    const matcher = /[（(]([甲乙丙丁戊己庚辛壬癸])[）)]/g;
    const matches = [...body.matchAll(matcher)];
    if (matches.length < 2) return null;
    return matches.map((match, index) => {
        const start = (match.index ?? 0) + match[0].length;
        const end = matches[index + 1]?.index ?? body.length;
        return {
            label: match[1],
            value: `(${match[1]})${body.slice(start, end).replace(/[。.]\s*$/, "").trim()}`,
        };
    });
}

/** 從來源答案取出各題的選項代號。 */
export function parseAnswerLetters(sourceAnswer)
{
    const direct = [...sourceAnswer.matchAll(/[（(]([Ａ-ＨA-H])[）)]/g)].map((match) => normalizeLetter(match[1]));
    if (direct.length) return direct;
    const numbered = [...sourceAnswer.matchAll(/[（(][0-9０-９]+[）)]\s*[（(]?([Ａ-ＨA-H])[）)]?/g)]
        .map((match) => normalizeLetter(match[1]));
    if (numbered.length) return numbered;
    const plain = sourceAnswer.trim().match(/^[Ａ-ＨA-H]$/);
    return plain ? [normalizeLetter(plain[0])] : [];
}

/** 將配合題、克漏字與題組拆成可逐小題作答的結構。 */
export function parseParts(body, sourceAnswer)
{
    const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
    const partPattern = /^(?:[（(]\s*[）)]\s*)?[（(]([0-9０-９]+)[）)]/;
    const choicePartPattern = /^(?:[（(]\s*[）)]\s*)?[（(][0-9０-９]+[）)]\s*[（(][Ａ-ＨA-H][）)]/;
    const choicePartIndexes = lines.map((line, index) => choicePartPattern.test(line) ? index : -1)
        .filter((index) => index >= 0);
    const partIndexes = choicePartIndexes.length
        ? choicePartIndexes
        : lines.map((line, index) => partPattern.test(line) ? index : -1).filter((index) => index >= 0);
    if (!partIndexes.length) return null;

    const firstPart = partIndexes[0];
    const introLines = lines.slice(0, firstPart);
    const commonLineIndex = introLines.findIndex((line) => /^參考選項[:：]/.test(line)
        || (parseOptions(line)?.options.length ?? 0) >= 2
        || (parseChineseLabeledOptions(line)?.length ?? 0) >= 2);
    const commonText = commonLineIndex >= 0 ? introLines.slice(commonLineIndex).join(" ") : "";
    const labeledCommon = parseOptions(commonText)?.options
        ?? parseChineseLabeledOptions(commonText)
        ?? [];
    const unlabeledCommon = labeledCommon.length ? [] : commonText
        .replace(/^參考選項[:：]\s*/, "")
        .split(/[　\s]+/)
        .filter(Boolean)
        .map((value, index) => ({ label: String(index + 1), value }));
    const common = labeledCommon.length ? labeledCommon : unlabeledCommon;
    const prompt = introLines.slice(0, commonLineIndex >= 0 ? commonLineIndex : introLines.length).join("\n").trim();
    const answerLetters = parseAnswerLetters(sourceAnswer);
    const answerChineseLabels = [...sourceAnswer.matchAll(/[（(]([甲乙丙丁戊己庚辛壬癸])[）)]/g)]
        .map((match) => match[1]);
    const answerValues = sourceAnswer.split(/[；;]/).map((value) => value.replace(/^[（(][0-9０-９]+[）)]/, "").trim());
    const parts = partIndexes.map((lineIndex, index) => {
        const end = partIndexes[index + 1] ?? lines.length;
        const value = lines.slice(lineIndex, end).join(" ");
        const number = value.match(partPattern)?.[1] ?? String(index + 1);
        const choice = parseOptions(value.replace(partPattern, "").trim());
        const options = choice?.options ?? common;
        const answerLetter = answerLetters[index] ?? answerChineseLabels[index];
        const answerValue = answerValues[index];
        const answer = options.find((option) => option.label === answerLetter)?.value
            ?? options.find((option) => option.value === answerValue)?.value
            ?? "";
        return {
            id: number,
            prompt: choice?.prompt || value.replace(partPattern, "").trim(),
            options: options.map((option) => option.value),
            answer,
        };
    });

    if (!parts.every((part) => part.options.length >= 2 && part.answer)) return null;
    return { prompt, parts };
}

/**
 * 將含多個答案位置的書寫題拆成可獨立作答的小題。
 * @param {string} body 題幹原文。
 * @param {string} sourceAnswer 來源文件中的答案。
 * @returns {Array<{id: string, prompt: string, answer: string}> | null} 可獨立作答的小題，無法可靠對應時回傳 null。
 */
export function parseWrittenParts(body, sourceAnswer)
{
    // Parenthesized exponents such as `2^(4)` are formula content, not part
    // markers. Keep support for both line-leading and inline `(1)…(2)…` parts.
    const pattern = /(?<!\^)[（(]([0-9０-９]+)[）)]\s*([\s\S]*?)(?=(?<!\^)[（(][0-9０-９]+[）)]|$)/g;
    const prompts = [...body.matchAll(pattern)];
    const answers = [...sourceAnswer.matchAll(pattern)];
    if (prompts.length >= 2 && prompts.length === answers.length) {
        return prompts.map((prompt, index) => ({
            id: prompt[1],
            prompt: prompt[2].trim(),
            answer: answers[index][2].trim(),
        }));
    }

    const answerValues = sourceAnswer.split(/[；;]/).map((value) => value.trim()).filter(Boolean);
    if (answerValues.length < 2) return null;

    const blankPattern = /[（(][\s　＿_]*[）)]|【[\s　＿_]*】|　{2,}|＿{2,}|_{2,}/g;
    const blanks = [...body.matchAll(blankPattern)];
    if (blanks.length !== answerValues.length) return null;

    return blanks.map((blank, index) => {
        const before = body.slice(index ? (blanks[index - 1].index ?? 0) + blanks[index - 1][0].length : 0, blank.index).trim();
        const afterStart = (blank.index ?? 0) + blank[0].length;
        const after = body.slice(afterStart, blanks[index + 1]?.index ?? body.length).trim();
        const left = before.split(/[，。！？；：\n]/).at(-1)?.trim() ?? "";
        const right = after.split(/[，。！？；：\n]/)[0]?.trim() ?? "";
        const prompt = `${left}（　）${right}`.trim();
        return {
            id: String(index + 1),
            prompt: prompt === "（　）" ? `第 ${index + 1} 空` : prompt,
            answer: answerValues[index],
        };
    });
}

/** 將來源難易度轉成前端資料契約。 */
export function mapDifficulty(value)
{
    if (value === "易") return "基礎";
    if (value === "難") return "進階";
    return "中等";
}

/** 從檔名與題目單元取得章節名稱。 */
export function getChapter(record)
{
    const lesson = record.documentName.match(/(?:^|_)(第[^_]+課|Starter Unit|Unit \d+|\d+-\d+)/)?.[1];
    return lesson ?? record.unit;
}

/**
 * 使用來源檔名保存單元，避免匯入時遺失課次與章節編號。
 * @param {Record<string, string>} record 來源題目。
 * @returns {string} 保留原始編號的單元值。
 */
export function getUnit(record)
{
    return path.basename(record.documentName, path.extname(record.documentName));
}

/** 把一筆來源題目轉成前端 API 使用的題目資料。 */
export function createQuestion(record, config, id)
{
    let kind = "written";
    let prompt = record.body;
    let answer = record.sourceAnswer;
    let options;
    let parts;

    if (CHOICE_TYPES.has(record.type)) {
        const parsed = parseOptions(record.body);
        const answerLetter = parseAnswerLetters(record.sourceAnswer)[0];
        if (!parsed || !answerLetter || parsed.options.some((option) => option.value.replace(/^\([A-H]\)/, "").trim() === "")) return null;
        kind = "choice";
        prompt = parsed.prompt;
        options = parsed.options.map((option) => option.value);
        answer = parsed.options.find((option) => option.label === answerLetter)?.value ?? "";
        if (!answer) return null;
    }
    else if (MULTI_TYPES.has(record.type)) {
        const parsed = parseParts(record.body, record.sourceAnswer);
        if (!parsed) return null;
        kind = "multi-choice";
        prompt = parsed.prompt;
        parts = parsed.parts;
        answer = JSON.stringify(parts.map((part) => part.answer));
    }
    else {
        parts = parseWrittenParts(record.body, record.sourceAnswer) ?? undefined;
        if (parts) answer = JSON.stringify(parts.map((part) => part.answer));
    }

    const unit = getUnit(record);
    const source = `${config.version}${config.subject}${config.sourceBook ?? "第一冊"} · ${unit} · ${record.origin}`;
    return {
        id,
        subject: config.subject,
        grade: config.grade ?? "國一",
        semester: config.semester ?? "上學期",
        bookVersion: config.version,
        chapter: getChapter(record),
        unit,
        topic: record.type,
        knowledge: record.knowledge,
        difficulty: mapDifficulty(record.difficulty),
        kind,
        typeLabel: record.type,
        prompt,
        ...(options ? { options } : {}),
        ...(parts ? { parts } : {}),
        answer,
        sourceAnswer: record.sourceAnswer,
        explanation: record.explanation || `答案：${record.sourceAnswer}`,
        source,
        sourceDetail: {
            documentName: record.documentName,
            questionNumber: record.number,
            valueSource: "document",
            confidence: 1,
        },
        blocks: [{ id: `q${id}-prompt-text`, placement: "prompt", type: "text", order: 1, text: prompt }],
    };
}

/** 判斷來源題目是否能在不遺失必要圖表或公式的情況下直接匯入。 */
export function canImport(record)
{
    if (!record.body || !record.sourceAnswer || UNREADABLE_QUESTIONS.has(record.number)) return false;
    if (record.type === "看圖回答問題") return true;
    return !VISUAL_REFERENCE.test(record.body);
}

/** 從一科的來源文件依題型各選三題。 */
export async function collectSubject(config, startId)
{
    const availablePaths = config.paths ?? await listDocuments(config.directory);
    const paths = config.pathFilter ? availablePaths.filter(config.pathFilter) : availablePaths;
    const buckets = new Map(config.types.map((type) => [type, []]));
    const sampleCount = config.sampleCount ?? 3;

    for (const relativePath of paths) {
        if ([...buckets.values()].every((records) => records.length >= sampleCount)) break;
        const text = readDocument(relativePath);
        const parser = config.style === "metadata-last" ? parseMetadataLast : parseMetadataFirst;
        const records = parser(text, config.types, relativePath);

        for (const record of records) {
            const bucket = buckets.get(record.type);
            if (!bucket || bucket.length >= sampleCount || !canImport(record)) continue;
            const question = createQuestion(record, config, startId + [...buckets.values()].reduce((sum, items) => sum + items.length, 0));
            if (question) bucket.push(question);
            else console.warn(`略過無法完整拆分的題目：${config.subject}／${record.type}／${record.number}`);
        }
    }

    const missing = [...buckets.entries()].filter(([, questions]) => questions.length < sampleCount);
    if (missing.length) {
        const details = missing.map(([type, questions]) => `${type} ${questions.length}/${sampleCount}`).join("、");
        throw new Error(`${config.subject}來源不足或無法完整解析：${details}`);
    }

    return config.types.flatMap((type) => buckets.get(type));
}

/** 從英文原始 DOC 匯出前三題看圖題的圖片並連結到題目區塊。 */
async function attachEnglishImages(questions)
{
    const imageQuestions = questions.filter((question) => question.subject === "英文"
        && ["閱讀測驗", "看圖回答問題"].includes(question.typeLabel));
    const source = path.join(SOURCE_ROOT, SUBJECTS.find((item) => item.subject === "英文").paths[0]);
    const temporary = await mkdtemp(path.join(os.tmpdir(), "lerniqa-grade-seven-"));
    execFileSync("/opt/homebrew/bin/soffice", ["--headless", "--convert-to", "html", "--outdir", temporary, source], { stdio: "ignore" });
    const htmlName = (await readdir(temporary)).find((name) => name.endsWith(".html"));
    if (!htmlName) throw new Error("英文來源無法轉出 HTML 圖片。");
    const html = await readFile(path.join(temporary, htmlName), "utf8");
    await mkdir(ASSET_PATH, { recursive: true });

    for (const question of imageQuestions) {
        const numberIndex = html.indexOf(question.sourceDetail.questionNumber);
        const currentLabelIndex = html.lastIndexOf("編號：", numberIndex);
        const previousIndex = html.lastIndexOf("編號：", currentLabelIndex - 1);
        const segment = html.slice(Math.max(0, previousIndex), numberIndex);
        const images = [...segment.matchAll(/<img[^>]+src="([^"]+)"[^>]*width="(\d+)"[^>]*height="(\d+)"[^>]*>/g)];
        const image = images.at(-1);
        if (!image) throw new Error(`找不到英文圖片題 ${question.sourceDetail.questionNumber} 的圖片。`);
        const originalName = decodeURIComponent(image[1]);
        const extension = path.extname(originalName).toLowerCase() || ".png";
        const storageKey = `g7-en-${question.sourceDetail.questionNumber}${extension}`;
        await copyFile(path.join(temporary, originalName), new URL(storageKey, ASSET_PATH));
        question.blocks.push({
            id: `q${question.id}-prompt-image`,
            placement: "prompt",
            type: "image",
            order: 2,
            asset: {
                storageKey,
                mimeType: extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png",
                alt: `${question.unit}${question.typeLabel}附圖`,
                width: Number(image[2]),
                height: Number(image[3]),
            },
        });
    }
}

/** 更新 fixture，保留其他年級與相近題資料。 */
async function main()
{
    if (!SOURCE_ROOT) throw new Error("請提供國中題庫來源目錄。");
    const database = JSON.parse(await readFile(DATABASE_PATH, "utf8"));
    const questions = [];
    let nextId = 7001;

    for (const config of SUBJECTS) {
        const subjectQuestions = await collectSubject(config, nextId);
        questions.push(...subjectQuestions);
        nextId += subjectQuestions.length;
    }

    await attachEnglishImages(questions);
    database.questions = [
        ...database.questions.filter((question) => question.grade !== "國一"),
        ...questions,
    ];
    await writeFile(DATABASE_PATH, `${JSON.stringify(database, null, 2)}\n`, "utf8");

    try {
        const runtime = JSON.parse(await readFile(RUNTIME_DATABASE_PATH, "utf8"));
        runtime.questions = [
            ...runtime.questions.filter((question) => question.grade !== "國一"),
            ...questions,
        ];
        const questionIds = new Map(questions
            .filter((question) => question.subject === "國語")
            .map((question) => [question.sourceDetail.questionNumber, question.id]));
        const replaceQuestionId = (questionId) => questionIds.get(LEGACY_QUESTION_NUMBERS.get(questionId)) ?? questionId;
        runtime.state.attemptsByLearner = Object.fromEntries(Object.entries(runtime.state.attemptsByLearner)
            .map(([learnerId, attempts]) => [learnerId, attempts.map((attempt) => ({
                ...attempt,
                questionId: replaceQuestionId(attempt.questionId),
            }))]));
        runtime.state.queuedSimilarByLearner = Object.fromEntries(Object.entries(runtime.state.queuedSimilarByLearner)
            .map(([learnerId, queue]) => [learnerId, queue.map(replaceQuestionId)]));
        runtime.state.learners = runtime.state.learners.map((learner) => ({
            ...learner,
            bookVersions: {
                數學: learner.grade === "國一" ? "康軒" : learner.bookVersions?.數學 ?? "康軒",
                國語: learner.grade === "國一" ? "翰林" : learner.bookVersions?.國語 ?? "翰林",
                英文: learner.grade === "國一" ? "翰林" : learner.bookVersions?.英文 ?? "翰林",
                理化: learner.bookVersions?.理化 ?? learner.bookVersions?.自然 ?? "康軒",
                生物: learner.grade === "國一" ? "康軒" : learner.bookVersions?.生物 ?? learner.bookVersions?.自然 ?? "康軒",
                歷史: learner.bookVersions?.歷史 ?? learner.bookVersions?.社會 ?? "南一",
                地理: learner.grade === "國一" ? "南一" : learner.bookVersions?.地理 ?? learner.bookVersions?.社會 ?? "南一",
                公民: learner.bookVersions?.公民 ?? learner.bookVersions?.社會 ?? "南一",
            },
        }));
        await writeFile(RUNTIME_DATABASE_PATH, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
        await mkdir(RUNTIME_ASSET_PATH, { recursive: true });

        for (const question of questions) {
            for (const block of question.blocks ?? []) {
                if (block.type !== "image" || !block.asset?.storageKey) continue;
                await copyFile(new URL(block.asset.storageKey, ASSET_PATH), new URL(block.asset.storageKey, RUNTIME_ASSET_PATH));
            }
        }
    }
    catch (error) {
        if (error?.code !== "ENOENT") throw error;
    }

    for (const { subject } of SUBJECTS) {
        const count = questions.filter((question) => question.subject === subject).length;
        console.log(`${subject}：${count} 題`);
    }
    console.log(`已寫入 ${questions.length} 題國一來源題目。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
