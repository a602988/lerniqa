import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const NUMBER_LINE_DOCUMENT = process.argv[2];
const INTEGER_DOCUMENT = process.argv[3];
const FIXTURE_DATABASE = new URL("../data/fixtures/database.json", import.meta.url);
const RUNTIME_DATABASE = new URL("../runtime-data/database.json", import.meta.url);
const FIXTURE_ASSETS = new URL("../data/fixtures/assets/", import.meta.url);
const RUNTIME_ASSETS = new URL("../runtime-data/assets/", import.meta.url);

if (!NUMBER_LINE_DOCUMENT || !INTEGER_DOCUMENT) {
    throw new Error("請依序提供負數與數線、整數的加減來源文件。");
}

const metadata = (learningContent, sourceType, sourcePath) => [
    { key: "learning_content", label: "學習內容", rawValue: learningContent, values: [learningContent], valueSource: "document", confidence: 1 },
    { key: "source_type", label: "來源類型", rawValue: sourceType, values: [sourceType], valueSource: "path", confidence: 1 },
    { key: "source_path", label: "來源路徑", rawValue: sourcePath, values: [sourcePath], valueSource: "path", confidence: 1 },
];

const questions = [
    {
        id: 7086,
        code: "1501003946",
        subject: "數學",
        grade: "國一",
        semester: "上學期",
        bookVersion: "康軒",
        chapter: "1-1",
        unit: "1-1　負數與數線",
        topic: "填充",
        knowledge: "絕對值",
        difficulty: "中等",
        kind: "written",
        typeLabel: "填充",
        prompt: "數線上有 5 1/5、－5.2、1 2/3、－2 2/3、0.8、2 4/5 六個數的點，請問：\n(1) 最大的數為________，最小的數為________。\n(2) 與原點距離相等的兩數是________。\n(3) 絕對值比 1 小的數為________。",
        parts: [
            { id: "1", prompt: "最大的數與最小的數", answer: "5 1/5，－5.2" },
            { id: "2", prompt: "與原點距離相等的兩數", answer: "5 1/5，－5.2" },
            { id: "3", prompt: "絕對值比 1 小的數", answer: "0.8" },
        ],
        answer: JSON.stringify(["5 1/5，－5.2", "5 1/5，－5.2", "0.8"]),
        sourceAnswer: "(1) 5 1/5，－5.2　(2) 5 1/5，－5.2　(3) 0.8",
        explanation: "依數值大小排列：5 1/5＞2 4/5＞1 2/3＞0.8＞－2 2/3＞－5.2。5 1/5 與－5.2 的絕對值相等，六個數中只有 0.8 的絕對值小於 1。",
        source: "康軒數學第一冊 · 1-1　負數與數線 · 題庫題目",
        sourceDetail: { documentName: "1-1　負數與數線.doc", questionNumber: "1501003946", valueSource: "document", confidence: 1 },
        metadata: metadata("N-7-5", "題庫題目", "01_題庫題目/第一冊/1-1　負數與數線.doc"),
        blocks: [{ id: "q7086-prompt-text", placement: "prompt", type: "text", order: 1, text: "數線上有 5 1/5、－5.2、1 2/3、－2 2/3、0.8、2 4/5 六個數的點，請依題意回答三個問題。" }],
    },
    {
        id: 7087,
        code: "1501004060",
        subject: "數學",
        grade: "國一",
        semester: "上學期",
        bookVersion: "康軒",
        chapter: "1-1",
        unit: "1-1　負數與數線",
        topic: "填充",
        knowledge: "數線",
        difficulty: "基礎",
        kind: "written",
        typeLabel: "填充",
        prompt: "如下圖，填入各點所對應的數。",
        parts: [
            { id: "A", prompt: "A 點", answer: "－4 3/4" },
            { id: "B", prompt: "B 點", answer: "－3" },
            { id: "C", prompt: "C 點", answer: "－1/3" },
            { id: "D", prompt: "D 點", answer: "1 3/5" },
            { id: "E", prompt: "E 點", answer: "3 2/3" },
        ],
        answer: JSON.stringify(["－4 3/4", "－3", "－1/3", "1 3/5", "3 2/3"]),
        sourceAnswer: "A：－4 3/4；B：－3；C：－1/3；D：1 3/5；E：3 2/3",
        explanation: "依數線上的整數標示與每一小格代表的等分值，A、B、C、D、E 依序為－4 3/4、－3、－1/3、1 3/5、3 2/3。",
        source: "康軒數學第一冊 · 1-1　負數與數線 · 題庫題目",
        sourceDetail: { documentName: "1-1　負數與數線.doc", questionNumber: "1501004060", valueSource: "document", confidence: 1 },
        metadata: metadata("N-7-5", "題庫題目", "01_題庫題目/第一冊/1-1　負數與數線.doc"),
        blocks: [
            { id: "q7087-prompt-text", placement: "prompt", type: "text", order: 1, text: "如下圖，填入各點所對應的數。" },
            { id: "q7087-prompt-image", placement: "prompt", type: "image", order: 2, asset: { storageKey: "g7-math-1501004060-number-line.jpeg", mimeType: "image/jpeg", alt: "標示 A、B、C、D、E 五點的數線", width: 1059, height: 169 } },
        ],
    },
    {
        id: 7088,
        code: "1501000035",
        subject: "數學",
        grade: "國一",
        semester: "上學期",
        bookVersion: "康軒",
        chapter: "1-2",
        unit: "1-2　整數的加減",
        topic: "計算",
        knowledge: "整數的減法",
        difficulty: "中等",
        kind: "written",
        typeLabel: "計算",
        prompt: "下表為部分區域與倫敦格林威治的時差，試回答下列問題：\n(1) 小文上網查中華航空飛往洛杉磯的班機，有一班飛機起飛時間為臺北時間 9 月 20 日 23 時 30 分，抵達洛杉磯時間為 9 月 20 日 19 時 30 分，則此班機的飛行時間為多久？\n(2) 承 (1)，飛機抵達洛杉磯時間恰為雪梨當地時間幾月幾日的幾時幾分？",
        parts: [
            { id: "1", prompt: "此班機的飛行時間為多久？", answer: "12 小時" },
            { id: "2", prompt: "抵達洛杉磯時，雪梨當地是幾月幾日的幾時幾分？", answer: "9 月 21 日 14 時 30 分" },
        ],
        answer: JSON.stringify(["12 小時", "9 月 21 日 14 時 30 分"]),
        sourceAnswer: "(1) 12 小時　(2) 9 月 21 日 14 時 30 分",
        explanation: "臺北與洛杉磯相差 16 小時，因此臺北 9 月 20 日 23 時 30 分為洛杉磯 9 月 20 日 7 時 30 分；至 19 時 30 分共飛行 12 小時。雪梨與洛杉磯相差 19 小時，所以抵達時雪梨為 9 月 21 日 14 時 30 分。",
        source: "康軒數學第一冊 · 1-2　整數的加減 · 素養題",
        sourceDetail: { documentName: "1-2　整數的加減.doc", questionNumber: "1501000035", valueSource: "document", confidence: 1 },
        metadata: metadata("N-7-3", "素養題", "07_素養題/第一冊/1-2　整數的加減.doc"),
        blocks: [
            { id: "q7088-prompt-text", placement: "prompt", type: "text", order: 1, text: "下表為部分區域與倫敦格林威治的時差，試回答下列問題。" },
            { id: "q7088-prompt-image", placement: "prompt", type: "image", order: 2, asset: { storageKey: "g7-math-1501000035-time-zone-table.jpeg", mimeType: "image/jpeg", alt: "雪梨、臺北、倫敦與洛杉磯時差表", width: 1373, height: 326 } },
            { id: "q7088-prompt-questions", placement: "prompt", type: "text", order: 3, text: "(1) 小文上網查中華航空飛往洛杉磯的班機，有一班飛機起飛時間為臺北時間 9 月 20 日 23 時 30 分，抵達洛杉磯時間為 9 月 20 日 19 時 30 分，則此班機的飛行時間為多久？\n(2) 承 (1)，飛機抵達洛杉磯時間恰為雪梨當地時間幾月幾日的幾時幾分？" },
        ],
    },
    {
        id: 7089,
        code: "1501000047",
        subject: "數學",
        grade: "國一",
        semester: "上學期",
        bookVersion: "康軒",
        chapter: "1-2",
        unit: "1-2　整數的加減",
        topic: "計算",
        knowledge: "整數的減法",
        difficulty: "中等",
        kind: "written",
        typeLabel: "計算",
        prompt: "國際標準時間是指當地與英國倫敦的時差，例如：臺北的國際標準時間為＋8，即表示臺北和倫敦的時差為 8 小時。下表為世界各著名城市的國際標準時間表，試回答下列問題：\n(1) 臺北與紐約相差多少小時？\n(2) 爸爸出差時，於 4 月 10 日下午 6 點在紐約觀看洋基隊與天使隊的比賽，則臺灣的球迷可以在何時觀賞這場 live 精彩賽事？",
        parts: [
            { id: "1", prompt: "臺北與紐約相差多少小時？", answer: "13 小時" },
            { id: "2", prompt: "臺灣的球迷可以在何時觀賞賽事？", answer: "4 月 11 日上午 7 點" },
        ],
        answer: JSON.stringify(["13 小時", "4 月 11 日上午 7 點"]),
        sourceAnswer: "(1) 13 小時　(2) 4 月 11 日上午 7 點",
        explanation: "臺北與紐約相差 8－(－5)＝13 小時。紐約 4 月 10 日 18 時加上 13 小時為臺北 4 月 11 日上午 7 點。",
        source: "康軒數學第一冊 · 1-2　整數的加減 · 素養題",
        sourceDetail: { documentName: "1-2　整數的加減.doc", questionNumber: "1501000047", valueSource: "document", confidence: 1 },
        metadata: metadata("N-7-3", "素養題", "07_素養題/第一冊/1-2　整數的加減.doc"),
        blocks: [
            { id: "q7089-prompt-text", placement: "prompt", type: "text", order: 1, text: "國際標準時間是指當地與英國倫敦的時差，例如：臺北的國際標準時間為＋8，即表示臺北和倫敦的時差為 8 小時。下表為世界各著名城市的國際標準時間表，試回答下列問題。" },
            { id: "q7089-prompt-image", placement: "prompt", type: "image", order: 2, asset: { storageKey: "g7-math-1501000047-time-zone-table.jpeg", mimeType: "image/jpeg", alt: "東京、臺北、倫敦、紐約與洛杉磯國際標準時間表", width: 1598, height: 326 } },
            { id: "q7089-prompt-questions", placement: "prompt", type: "text", order: 3, text: "(1) 臺北與紐約相差多少小時？\n(2) 爸爸出差時，於 4 月 10 日下午 6 點在紐約觀看洋基隊與天使隊的比賽，則臺灣的球迷可以在何時觀賞這場 live 精彩賽事？" },
        ],
    },
];

const assets = [
    { document: NUMBER_LINE_DOCUMENT, entry: "word/media/image47.jpeg", storageKey: "g7-math-1501004060-number-line.jpeg" },
    { document: INTEGER_DOCUMENT, entry: "word/media/image1.jpeg", storageKey: "g7-math-1501000035-time-zone-table.jpeg" },
    { document: INTEGER_DOCUMENT, entry: "word/media/image2.jpeg", storageKey: "g7-math-1501000047-time-zone-table.jpeg" },
];

/**
 * 將指定題目與匯入批次寫入資料庫，重跑時更新同一題號而不建立重複資料。
 * @param {URL} databaseUrl 題庫 JSON 路徑。
 * @returns {Promise<void>}
 */
async function updateDatabase(databaseUrl) {
    const database = JSON.parse(await readFile(databaseUrl, "utf8"));
    const reservedIds = new Map(database.questions.map((question) => [question.id, question.code ?? question.sourceDetail?.questionNumber]));

    for (const question of questions) {
        const currentCode = reservedIds.get(question.id);
        if (currentCode && currentCode !== question.code) throw new Error(`題目 ID ${question.id} 已由題號 ${currentCode} 使用。`);
    }

    const selectedCodes = new Set(questions.map((question) => question.code));
    database.questions = [
        ...database.questions.filter((question) => !selectedCodes.has(question.code ?? question.sourceDetail?.questionNumber)),
        ...questions,
    ];

    database.imports = database.imports.map((batch) => batch.id === "fixture-import-math-number-line"
        ? { ...batch, questionIds: [...new Set([...batch.questionIds, 7086, 7087])] }
        : batch);
    const integerBatch = {
        id: "fixture-import-math-integer-add-subtract",
        createdAt: "2026-10-15T08:00:00.000Z",
        fileNames: ["1-2　整數的加減.doc"],
        questionIds: [7088, 7089],
        status: "confirmed",
    };
    database.imports = [
        ...database.imports.filter((batch) => batch.id !== integerBatch.id),
        integerBatch,
    ];
    await writeFile(databaseUrl, `${JSON.stringify(database, null, 2)}\n`, "utf8");
}

/**
 * 從原始 Word 封裝取出指定圖片，避免重新截圖造成文字或線條失真。
 * @returns {Promise<void>}
 */
async function writeAssets() {
    await Promise.all([mkdir(FIXTURE_ASSETS, { recursive: true }), mkdir(RUNTIME_ASSETS, { recursive: true })]);

    for (const asset of assets) {
        const data = execFileSync("unzip", ["-p", asset.document, asset.entry], { encoding: null, maxBuffer: 8 * 1024 * 1024 });
        await Promise.all([
            writeFile(new URL(asset.storageKey, FIXTURE_ASSETS), data),
            writeFile(new URL(asset.storageKey, RUNTIME_ASSETS), data),
        ]);
    }
}

if (path.basename(NUMBER_LINE_DOCUMENT) !== "1-1　負數與數線.doc" || path.basename(INTEGER_DOCUMENT) !== "1-2　整數的加減.doc") {
    throw new Error("來源文件名稱與指定題目不符。");
}

await Promise.all([updateDatabase(FIXTURE_DATABASE), updateDatabase(RUNTIME_DATABASE), writeAssets()]);
console.log(`已寫入題號：${questions.map((question) => question.code).join("、")}`);
