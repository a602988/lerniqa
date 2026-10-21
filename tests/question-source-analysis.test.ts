import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
    analyzeQuestionSourcePages,
    classifyQuestionSourceDocuments,
    QuestionSourceAnalysisError,
    suggestQuestionAnswers,
    suggestQuestionPartAnswer,
} from "../app/lib/question-source-analysis.ts";
import {
    acceptsBopomofoAnswer,
    bopomofoTargetIssues,
    inferBopomofoAnswerTask,
    parseBopomofoCorrection,
} from "../app/lib/bopomofo-recognition.ts";
import {
    HANDWRITING_MODEL_DIGEST,
    HANDWRITING_MODEL_NAME,
} from "../app/lib/handwriting-analysis.mjs";

function jsonResponse(url: URL | RequestInfo, body: unknown, status = 200): Response {
    const response = new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
    Object.defineProperty(response, "url", { value: String(url) });
    return response;
}

function streamResponse(url: URL | RequestInfo, chunks: string[]): Response {
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream({
        start(controller)
        {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    }), {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
    });
    Object.defineProperty(response, "url", { value: String(url) });
    return response;
}

function modelFetch(chatOutputs: unknown[], overrides: { digest?: string; capabilities?: string[] } = {}) {
    const calls: Array<{ path: string; body: unknown }> = [];
    let chatIndex = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ path: url.pathname, body });
        if (url.pathname === "/api/version") return jsonResponse(url, { version: "0.34.4" });
        if (url.pathname === "/api/tags") {
            return jsonResponse(url, {
                models: [{
                    name: HANDWRITING_MODEL_NAME,
                    digest: overrides.digest ?? HANDWRITING_MODEL_DIGEST,
                }],
            });
        }
        if (url.pathname === "/api/show") {
            return jsonResponse(url, { capabilities: overrides.capabilities ?? ["completion", "vision"] });
        }
        if (url.pathname === "/api/chat") {
            return streamResponse(url, [
                `${JSON.stringify({ message: { content: JSON.stringify(chatOutputs[chatIndex++]) }, done: true })}\n`,
            ]);
        }
        throw new Error(`unexpected path ${url.pathname}`);
    };
    return { calls, fetchImpl };
}

function modelPackage() {
    return {
        schemaVersion: 1,
        sourceTitle: "模型輸出名稱不可信",
        questions: [{
            questionKey: "q1",
            templateId: "single-choice",
            sourceQuestionNumber: "1",
            sourcePage: 1,
            sharedPrompt: [
                { kind: "text", text: "觀察圖表後，哪一項敘述正確？" },
                {
                    kind: "crop_ref",
                    ref: "q1-chart",
                    sourceRef: "uploaded-source",
                    page: 1,
                    rect: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
                    alt: "第 1 題圖表",
                },
            ],
            parts: [{
                stableKey: "part-1",
                parentStableKey: null,
                prompt: [],
                answerMode: "single_choice",
                answerFieldCount: 1,
                gradingPolicy: "manual_review",
                options: [
                    { key: "A", blocks: [{ kind: "text", text: "甲" }] },
                    { key: "B", blocks: [{ kind: "text", text: "乙" }] },
                ],
                answers: [],
                hints: [],
                explanation: [],
            }],
        }],
    };
}

function worksheetPackage(sourceNumbers: string[]) {
    const template = modelPackage().questions[0]!;
    return {
        schemaVersion: 1,
        sourceTitle: "模型輸出名稱不可信",
        questions: sourceNumbers.map((sourceQuestionNumber, index) => ({
            ...structuredClone(template),
            questionKey: `q${index + 1}`,
            templateId: "short-answer",
            sourceQuestionNumber,
            sharedPrompt: sourceQuestionNumber.startsWith("一-")
                ? [
                    { kind: "text", text: `第 ${index + 1} 題前文` },
                    {
                        kind: "crop_ref",
                        ref: `q${index + 1}-bopomofo-target`,
                        sourceRef: "uploaded-source",
                        page: 1,
                        rect: { x: 0.2, y: 0.1 + (index * 0.03), width: 0.12, height: 0.025 },
                        alt: "待確認的注音原文",
                    },
                    { kind: "text", text: "：" },
                ]
                : [{ kind: "text", text: `第 ${index - 9} 題詞語` }],
            parts: [{
                ...structuredClone(template.parts[0]!),
                answerMode: "text",
                options: [],
            }],
        })),
    };
}

test("Bopomofo manual corrections preserve exact targets and reject guessed text", () => {
    assert.deepEqual(parseBopomofoCorrection("  ㄇㄤˇ  "), { ok: true, value: "ㄇㄤˇ" });
    assert.deepEqual(parseBopomofoCorrection("「ㄇㄤˇ」"), { ok: true, value: "「ㄇㄤˇ」" });
    assert.deepEqual(parseBopomofoCorrection("（ㄩㄢ ㄅㄛˊ）"), { ok: true, value: "（ㄩㄢ ㄅㄛˊ）" });
    assert.equal(parseBopomofoCorrection("個性魯莽").ok, false);
    assert.equal(parseBopomofoCorrection("ㄇangˇ").ok, false);
    assert.equal(parseBopomofoCorrection("「ㄇㄤˇ）").ok, false);
    assert.equal(parseBopomofoCorrection("   ").ok, false);
});

test("Bopomofo answer analysis treats an enclosed phonetic target as a Han-character clue", () => {
    const task = inferBopomofoAnswerTask([{ kind: "text", text: "個性魯「ㄇㄤˇ」：" }]);

    assert.equal(task, "han_from_bopomofo");
    assert.equal(acceptsBopomofoAnswer(task, ["莽"]), true);
    assert.equal(acceptsBopomofoAnswer(task, ["ㄇㄤˇ"]), false);
});

test("Bopomofo recognition does not accept model-only phonetic text as source transcription", () => {
    const blocks = [{ kind: "text" as const, text: "學問「ㄅㄛˋ」博：" }];

    assert.deepEqual(bopomofoTargetIssues(blocks, { ocrText: "2學問「u」博：" }), [
        "國字注音題的辨識結果不可靠：模型注音沒有相同的 OCR 字串佐證，必須保留待確認原圖",
    ]);
    assert.deepEqual(bopomofoTargetIssues(blocks, { ocrText: "2學問「ㄅㄛˋ」博：" }), []);
});

async function sourceImage() {
    return sharp({
        create: { width: 900, height: 1_200, channels: 3, background: "#ffffff" },
    }).png().toBuffer();
}

function sourcePage(image: Buffer, ocrText: string) {
    return {
        image,
        ocr: [{
            bounds: { height: 0.03, left: 0.08, top: 0.12, width: 0.42 },
            confidence: 0.87,
            text: ocrText.split("\n")[0] ?? ocrText,
        }],
        ocrText,
        page: 1,
    };
}

test("local vision analysis produces a validated multi-block question package", async () => {
    const { calls, fetchImpl } = modelFetch([modelPackage()]);
    const image = await sourceImage();
    const results = await analyzeQuestionSourcePages([
        sourcePage(image, "1. 觀察圖表後，哪一項敘述正確？ A.甲 B.乙"),
    ], "uploaded.png", fetchImpl);

    assert.equal(results.length, 1);
    assert.equal(results[0]?.package.sourceTitle, "uploaded.png");
    assert.equal(results[0]?.package.questions[0]?.parts[0]?.gradingPolicy, "manual_review");
    assert.equal(results[0]?.package.questions[0]?.sharedPrompt[1]?.kind, "crop_ref");
    const requestBody = calls.find((call) => call.path === "/api/chat")?.body;
    assert.ok(requestBody && typeof requestBody === "object" && !Array.isArray(requestBody));
    const body = requestBody as Record<string, unknown>;
    assert.equal(body.model, "qwen3.8:27b");
    assert.equal(body.think, false);
    assert.equal(body.stream, true);
    const messages = body.messages as Array<{ content: string; images?: string[] }>;
    assert.match(messages[0]!.content, /不可把手寫、圈選、批改符號/u);
    assert.ok((messages[1]!.images?.[0]?.length ?? 0) > 100);
    assert.match(messages[1]!.content, /"confidence":0\.87/u);
    assert.match(messages[1]!.content, /"bounds":\{"height":0\.03,"left":0\.08,"top":0\.12,"width":0\.42\}/u);
});

test("local vision analysis classifies an answer page without changing explicit roles", async () => {
    const image = await sourceImage();
    const { calls, fetchImpl } = modelFetch([{
        role: "answer",
        confidence: 0.94,
        reason: "頁面列出題號與對應答案",
    }]);
    const results = await classifyQuestionSourceDocuments([
        {
            fileName: "題目.jpg",
            pages: [sourcePage(image, "1. 下列何者正確？")],
            role: "question",
            sourceDocumentId: "question-document",
        },
        {
            fileName: "答案.jpg",
            pages: [sourcePage(image, "1. A\n2. C")],
            role: "auto",
            sourceDocumentId: "answer-document",
        },
    ], fetchImpl);

    assert.deepEqual(results, [{
        confidence: 0.94,
        reason: "頁面列出題號與對應答案",
        role: "answer",
        sourceDocumentId: "answer-document",
    }]);
    assert.equal(calls.filter((call) => call.path === "/api/chat").length, 1);
});

test("local vision analysis returns answer suggestions with traceable evidence", async () => {
    const image = await sourceImage();
    const { fetchImpl } = modelFetch([{
        suggestions: [{
            questionDraftKey: "q-1",
            partStableKey: "part-1",
            answers: ["A"],
            explanation: "答案頁第 1 題標示 A。",
            confidence: 0.97,
            evidence: { sourceDocumentId: "answer-document", page: 1 },
        }],
    }]);
    const suggestions = await suggestQuestionAnswers([{
        draftKey: "q-1",
        classifications: [],
        sourceQuestionNumber: "1",
        sourcePage: 1,
        sharedPrompt: [{ kind: "text", text: "下列何者正確？" }],
        parts: [{
            stableKey: "part-1",
            parentStableKey: null,
            prompt: [],
            answerMode: "single_choice",
            answerFieldCount: 1,
            gradingPolicy: "manual_review",
            options: [
                { key: "A", blocks: [{ kind: "text", text: "甲" }] },
                { key: "B", blocks: [{ kind: "text", text: "乙" }] },
            ],
            answers: [],
            hints: [],
            explanation: [],
        }],
    }], [{
        fileName: "答案.jpg",
        pages: [sourcePage(image, "1. A")],
        role: "answer",
        sourceDocumentId: "answer-document",
    }], fetchImpl);

    assert.deepEqual(suggestions, [{
        answers: ["A"],
        confidence: 0.97,
        evidence: { sourceDocumentId: "answer-document", page: 1 },
        explanation: "答案頁第 1 題標示 A。",
        partStableKey: "part-1",
        questionDraftKey: "q-1",
    }]);
});

test("manual answer analysis returns one targeted answer with an explanation", async () => {
    const { fetchImpl } = modelFetch([{
        suggestions: [{
            questionDraftKey: "q-1",
            partStableKey: "part-2",
            answers: ["乙"],
            explanation: "依題意可判斷第二小題答案為乙。",
            confidence: 0.78,
            evidence: null,
        }],
    }]);
    const suggestion = await suggestQuestionPartAnswer({
        draftKey: "q-1",
        classifications: [],
        sourceQuestionNumber: "1",
        sourcePage: 1,
        sharedPrompt: [{ kind: "text", text: "請回答下列問題。" }],
        parts: ["part-1", "part-2"].map((stableKey, index) => ({
            stableKey,
            parentStableKey: null,
            prompt: [{ kind: "text" as const, text: `第 ${index + 1} 小題` }],
            answerMode: "text" as const,
            answerFieldCount: 1,
            gradingPolicy: "manual_review" as const,
            options: [],
            answers: [],
            hints: [],
            explanation: [],
        })),
    }, "part-2", fetchImpl);

    assert.deepEqual(suggestion, {
        answers: ["乙"],
        confidence: 0.78,
        evidence: null,
        explanation: "依題意可判斷第二小題答案為乙。",
        partStableKey: "part-2",
        questionDraftKey: "q-1",
    });
});

test("manual Bopomofo answer analysis sends the answer direction and rejects a phonetic echo", async () => {
    const question = {
        draftKey: "q-bopomofo",
        classifications: [],
        sourceQuestionNumber: "一-1",
        sourcePage: 1,
        sharedPrompt: [{ kind: "text" as const, text: "個性魯「ㄇㄤˇ」：" }],
        parts: [{
            stableKey: "part-1",
            parentStableKey: null,
            prompt: [],
            answerMode: "text" as const,
            answerFieldCount: 1,
            gradingPolicy: "manual_review" as const,
            options: [],
            answers: [],
            hints: [],
            explanation: [],
        }],
    };
    const correct = modelFetch([{
        suggestions: [{
            questionDraftKey: "q-bopomofo",
            partStableKey: "part-1",
            answers: ["莽"],
            explanation: "「ㄇㄤˇ」在「魯莽」中對應國字「莽」。",
            confidence: 0.9,
            evidence: null,
        }],
    }]);
    const suggestion = await suggestQuestionPartAnswer(question, "part-1", correct.fetchImpl);
    const request = correct.calls.find((call) => call.path === "/api/chat")?.body;

    assert.deepEqual(suggestion?.answers, ["莽"]);
    assert.match(JSON.stringify(request), /answerTask.+han_from_bopomofo/u);
    assert.match(JSON.stringify(request), /引號內的注音是待填國字的讀音線索/u);

    const echo = modelFetch([{
        suggestions: [{
            questionDraftKey: "q-bopomofo",
            partStableKey: "part-1",
            answers: ["ㄇㄤˇ"],
            explanation: "重複題幹中的注音。",
            confidence: 0.9,
            evidence: null,
        }],
    }]);

    await assert.rejects(
        suggestQuestionPartAnswer(question, "part-1", echo.fetchImpl),
        (error) => error instanceof QuestionSourceAnalysisError && error.code === "LOCAL_MODEL_INVALID_ANSWER_SUGGESTIONS",
    );
});

test("local vision analysis consumes a streamed Ollama response", async () => {
    const output = JSON.stringify(modelPackage());
    const split = Math.floor(output.length / 2);
    const calls: Array<{ path: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ path: url.pathname, body });
        if (url.pathname === "/api/version") return jsonResponse(url, { version: "0.34.4" });
        if (url.pathname === "/api/tags") {
            return jsonResponse(url, {
                models: [{ name: HANDWRITING_MODEL_NAME, digest: HANDWRITING_MODEL_DIGEST }],
            });
        }
        if (url.pathname === "/api/show") return jsonResponse(url, { capabilities: ["completion", "vision"] });
        if (url.pathname === "/api/chat") {
            return streamResponse(url, [
                `${JSON.stringify({ message: { content: output.slice(0, split) }, done: false })}\n`,
                `${JSON.stringify({ message: { content: output.slice(split) }, done: true })}\n`,
            ]);
        }
        throw new Error(`unexpected path ${url.pathname}`);
    };

    const results = await analyzeQuestionSourcePages([
        sourcePage(await sourceImage(), "1. 觀察圖表後，哪一項敘述正確？ A.甲 B.乙"),
    ], "uploaded.png", fetchImpl);

    assert.equal(results[0]?.package.questions.length, 1);
    const request = calls.find((call) => call.path === "/api/chat")?.body as Record<string, unknown>;
    assert.equal(request.stream, true);
});

test("local vision analysis reports Undici response timeouts as model timeouts", async () => {
    const { fetchImpl: modelIdentityFetch } = modelFetch([modelPackage()]);
    const image = await sourceImage();
    const fetchImpl: typeof fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname !== "/api/chat") return modelIdentityFetch(input, init);
        const transportCause = Object.assign(new Error("Headers Timeout Error"), {
            code: "UND_ERR_HEADERS_TIMEOUT",
        });
        throw new TypeError("fetch failed", { cause: transportCause });
    };

    await assert.rejects(
        () => analyzeQuestionSourcePages([
            sourcePage(image, "1. 第一題"),
        ], "uploaded.png", fetchImpl),
        (error) => error instanceof QuestionSourceAnalysisError && error.code === "LOCAL_MODEL_TIMEOUT",
    );
});

test("local vision analysis rejects model output that bypasses the question contract", async () => {
    const invalid = modelPackage();
    invalid.questions[0]!.parts[0]!.gradingPolicy = "automatic";
    const image = await sourceImage();
    const { fetchImpl } = modelFetch([invalid, invalid]);

    await assert.rejects(
        () => analyzeQuestionSourcePages([{
            image,
            ocrText: "沒有答案",
            page: 1,
        }], "uploaded.png", fetchImpl),
        (error) => error instanceof QuestionSourceAnalysisError && error.code === "LOCAL_MODEL_INVALID_QUESTIONS",
    );
});

test("local vision analysis sends contract errors back to the model before retrying", async () => {
    const invalid = modelPackage();
    invalid.questions[0]!.parts[0]!.options = [];
    const corrected = structuredClone(invalid);
    corrected.questions[0]!.templateId = "short-answer";
    corrected.questions[0]!.parts[0]!.answerMode = "text";
    const { calls, fetchImpl } = modelFetch([invalid, corrected]);

    const results = await analyzeQuestionSourcePages([{
        image: await sourceImage(),
        ocrText: "1. 請寫出畫線字的注音。",
        page: 1,
    }], "uploaded.png", fetchImpl);

    assert.equal(results[0]?.package.questions[0]?.parts[0]?.answerMode, "text");
    assert.equal(calls.filter((call) => call.path === "/api/chat").length, 2);
    const retry = calls.filter((call) => call.path === "/api/chat")[1]?.body as {
        messages: Array<{ content: string }>;
    };
    assert.match(retry.messages[1]!.content, /選擇類題目至少需要兩個選項/u);
});

test("local vision analysis rejects crop references to another page", async () => {
    const invalid = modelPackage();
    invalid.questions[0]!.sharedPrompt[1] = {
        kind: "crop_ref",
        ref: "q1-chart",
        sourceRef: "uploaded-source",
        page: 2,
        rect: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
        alt: "錯誤頁面",
    };
    const { fetchImpl } = modelFetch([invalid, invalid]);
    const image = await sourceImage();

    await assert.rejects(
        () => analyzeQuestionSourcePages([{
            image,
            ocrText: "測試",
            page: 1,
        }], "uploaded.png", fetchImpl),
        (error) => error instanceof QuestionSourceAnalysisError && error.code === "LOCAL_MODEL_INVALID_SOURCE",
    );
});

test("local vision analysis retries when OCR question numbers are missing from the result", async () => {
    const first = modelPackage();
    const second = modelPackage();
    second.questions.push({
        ...structuredClone(second.questions[0]!),
        questionKey: "q2",
        sourceQuestionNumber: "2",
        sharedPrompt: [{ kind: "text", text: "第二題" }],
    });
    const { calls, fetchImpl } = modelFetch([first, second]);
    const results = await analyzeQuestionSourcePages([{
        image: await sourceImage(),
        ocrText: "1. 第一題\n2. 第二題",
        page: 1,
    }], "uploaded.png", fetchImpl);

    assert.equal(calls.filter((call) => call.path === "/api/chat").length, 2);
    assert.equal(results[0]?.package.questions.length, 2);
    const request = calls.find((call) => call.path === "/api/chat")?.body as {
        format: { properties: { questions: { maxItems: number; minItems: number } } };
    };
    assert.equal(request.format.properties.questions.minItems, 2);
    assert.equal(request.format.properties.questions.maxItems, 2);
});

test("local vision analysis treats missing model-only parent keys as top-level parts", async () => {
    const output = modelPackage();
    const part = output.questions[0]!.parts[0]! as { parentStableKey: string | null };
    part.parentStableKey = "model-created-group";
    const { fetchImpl } = modelFetch([output]);

    const results = await analyzeQuestionSourcePages([{
        image: await sourceImage(),
        ocrText: "1. 第一題",
        page: 1,
    }], "uploaded.png", fetchImpl);

    assert.equal(results[0]?.package.questions[0]?.parts[0]?.parentStableKey, null);
});

test("worksheet section labels classify independent questions without entering their prompts", async () => {
    const output = modelPackage();
    output.questions[0]!.sourceQuestionNumber = "一-1";
    output.questions[0]!.sharedPrompt = [{ kind: "text", text: "個性魯「ㄇㄤˇ」：" }];
    output.questions.push({
        ...structuredClone(output.questions[0]!),
        questionKey: "q2",
        sourceQuestionNumber: "一-2",
        sharedPrompt: [{ kind: "text", text: "學問「ㄩㄢ」博：" }],
    });
    const { calls, fetchImpl } = modelFetch([output]);

    const results = await analyzeQuestionSourcePages([{
        image: await sourceImage(),
        ocrText: `一、國字注音：每字1分，共2分\n1. 個性魯「ㄇㄤˇ」：\n2. 學問「ㄩㄢ」博：\n${"印刷文字內容".repeat(30)}`,
        page: 1,
    }], "uploaded.png", fetchImpl);

    assert.equal(calls.filter((call) => call.path === "/api/chat").length, 1);
    assert.equal(results[0]?.package.questions.length, 2);
    assert.equal(results[0]?.package.questions[0]?.parts.length, 1);
    assert.doesNotMatch(JSON.stringify(results[0]?.package.questions), /國字注音|每字1分|共10分/u);
    const requestBody = calls.find((call) => call.path === "/api/chat")?.body as {
        format: {
            properties: {
                questions: {
                    items: {
                        properties: {
                            parts: { items: { properties: { answerMode: { enum: string[] } } } };
                            templateId: { enum: string[] };
                        };
                    };
                };
            };
        };
        messages: Array<{ content: string; images?: string[] }>;
    };
    assert.ok((requestBody.messages[1]?.images?.[0]?.length ?? 0) > 100);
    assert.match(requestBody.messages[0]!.content, /只作為題型與作答方式的判斷線索，不得寫入題幹/u);
    assert.match(requestBody.messages[1]!.content, /"expectedQuestionNumbers":\["一-1","一-2"\]/u);
    assert.deepEqual(requestBody.format.properties.questions.items.properties.templateId.enum, ["short-answer"]);
    assert.deepEqual(requestBody.format.properties.questions.items.properties.parts.items.properties.answerMode.enum, ["text"]);
});

test("worksheet sections deterministically split model groups into independent questions", async () => {
    const grouped = modelPackage();
    grouped.questions[0]!.templateId = "question-group";
    grouped.questions[0]!.sourceQuestionNumber = "一";
    grouped.questions[0]!.sharedPrompt = [{ kind: "text", text: "一、國字注音：每字1分，共2分" }];
    (grouped.questions[0]!.parts[0]! as unknown as {
        prompt: Array<{ kind: "text"; text: string }>;
    }).prompt = [{ kind: "text", text: "1. 個性魯「ㄇㄤˇ」：" }];
    (grouped.questions[0]!.parts as unknown as Array<Record<string, unknown>>).push({
        ...structuredClone(grouped.questions[0]!.parts[0]!),
        stableKey: "part-2",
        prompt: [{ kind: "text", text: "2. 學問「ㄩㄢ」博：" }],
    });
    const { calls, fetchImpl } = modelFetch([grouped]);

    const results = await analyzeQuestionSourcePages([
        sourcePage(await sourceImage(), "一、國字注音：每字1分，共2分\n1. 個性魯「ㄇㄤˇ」：\n2. 學問「ㄩㄢ」博："),
    ], "uploaded.png", fetchImpl);

    assert.equal(calls.filter((call) => call.path === "/api/chat").length, 1);
    assert.equal(results[0]?.package.questions.length, 2);
    assert.deepEqual(results[0]?.package.questions.map((question) => question.sourceQuestionNumber), ["一-1", "一-2"]);
    assert.doesNotMatch(JSON.stringify(results[0]?.package.questions), /國字注音|每字1分|共10分/u);
});

test("worksheet scoring and OCR layout noise prevent a partial one-question result from succeeding", async () => {
    const incomplete = worksheetPackage(["一-1"]);
    const complete = worksheetPackage([
        ...Array.from({ length: 10 }, (_, index) => `一-${index + 1}`),
        ...Array.from({ length: 5 }, (_, index) => `二-${index + 1}`),
    ]);
    const { calls, fetchImpl } = modelFetch([incomplete, complete]);
    const ocrText = [
        "一、國字注音：每字1分，共10分",
        "1個性魯「」：",
        "2學問「u」博：",
        "( )",
        "3. 溫文「日×」雅：",
        "4",
        "「ちーろ、」才無礙：",
        "5.",
        "「勿×」實謹慎：",
        "6. 功虧一「簀」：",
        "7. 「誨」人不倦：",
        "8. 口碑「載」道：",
        "9. 駕「馭」車馬：",
        "10.「允」文允武：",
        "二、解釋：每题2分，共10分",
        "( )",
        "1 三省吾身：",
        "2. 與朋友交而不「信」乎：",
        "3. 是調能「養」：",
        "4. 平地：",
        "5. 傳不習乎：",
    ].join("\n");

    const results = await analyzeQuestionSourcePages([
        sourcePage(await sourceImage(), ocrText),
    ], "uploaded.png", fetchImpl);

    assert.equal(calls.filter((call) => call.path === "/api/chat").length, 2);
    assert.equal(results[0]?.package.questions.length, 15);
    const firstRequest = calls.find((call) => call.path === "/api/chat")?.body as {
        format: { properties: { questions: { maxItems: number; minItems: number } } };
        messages: Array<{ content: string }>;
    };
    assert.equal(firstRequest.format.properties.questions.minItems, 15);
    assert.equal(firstRequest.format.properties.questions.maxItems, 15);
    assert.match(firstRequest.messages[1]!.content, /"expectedQuestionNumbers":\["一-1"[\s\S]*"一-10"[\s\S]*"二-5"\]/u);
});

test("a passage shared by dependent questions remains a question group", async () => {
    const output = modelPackage();
    output.questions[0]!.templateId = "question-group";
    output.questions[0]!.sourceQuestionNumber = "一";
    output.questions[0]!.sharedPrompt = [{ kind: "text", text: "小華觀察校園植物一個月，記錄每天的生長高度。" }];
    (output.questions[0]!.parts[0]! as unknown as {
        prompt: Array<{ kind: "text"; text: string }>;
    }).prompt = [{ kind: "text", text: "第十天的高度是多少？" }];
    (output.questions[0]!.parts as unknown as Array<Record<string, unknown>>).push({
        ...structuredClone(output.questions[0]!.parts[0]!),
        stableKey: "part-2",
        prompt: [{ kind: "text", text: "哪一段期間生長最快？" }],
    });
    const { fetchImpl } = modelFetch([output]);

    const results = await analyzeQuestionSourcePages([
        sourcePage(
            await sourceImage(),
            "一、閱讀圖表回答問題\n小華觀察校園植物一個月，記錄每天的生長高度。\n1. 第十天的高度是多少？\n2. 哪一段期間生長最快？",
        ),
    ], "uploaded.png", fetchImpl);

    assert.equal(results[0]?.package.questions.length, 1);
    assert.equal(results[0]?.package.questions[0]?.parts.length, 2);
});

test("a classification word inside an actual prompt is not removed as a section label", async () => {
    const output = modelPackage();
    output.questions[0]!.sourceQuestionNumber = "二-1";
    output.questions[0]!.sharedPrompt = [{ kind: "text", text: "請解釋『三省吾身』的意思。" }];
    const { fetchImpl } = modelFetch([output]);

    const results = await analyzeQuestionSourcePages([
        sourcePage(await sourceImage(), "二、解釋：每題2分\n1. 請解釋『三省吾身』的意思。"),
    ], "uploaded.png", fetchImpl);

    assert.equal(results[0]?.package.questions[0]?.sharedPrompt[0]?.kind, "text");
});

test("Bopomofo worksheets reject answer-completed rewrites and preserve an uncertain source target", async () => {
    const invalid = modelPackage();
    invalid.questions[0]!.sourceQuestionNumber = "一-1";
    invalid.questions[0]!.sharedPrompt = [{ kind: "text", text: "個性魯莽：ㄌㄨˇ ㄇㄤˇ" }];
    const corrected = structuredClone(invalid);
    corrected.questions[0]!.sharedPrompt = [
        { kind: "text", text: "個性魯" },
        {
            kind: "crop_ref",
            ref: "q1-bopomofo-target",
            sourceRef: "uploaded-source",
            page: 1,
            rect: { x: 0.44, y: 0.28, width: 0.16, height: 0.05 },
            alt: "待確認的注音原文",
        },
        { kind: "text", text: "：" },
    ];
    const { calls, fetchImpl } = modelFetch([invalid, corrected]);
    const image = await sourceImage();

    const results = await analyzeQuestionSourcePages([
        sourcePage(image, "一、國字注音\n1 個性魯「」："),
    ], "uploaded.png", fetchImpl);

    assert.equal(calls.filter((call) => call.path === "/api/chat").length, 2);
    assert.match(JSON.stringify(results[0]?.package), /待確認的注音原文/u);
    assert.doesNotMatch(JSON.stringify(results[0]?.package), /個性魯莽|ㄌㄨˇ/u);
    const retry = calls.filter((call) => call.path === "/api/chat")[1]?.body as {
        messages: Array<{ content: string; images?: string[] }>;
    };
    assert.match(retry.messages[1]!.content, /國字注音題的辨識結果不可靠/u);
    assert.equal(retry.messages[1]!.images?.length, 2);
    assert.match(retry.messages[0]!.content, /不得補成『個性魯莽』/u);
});

test("Bopomofo worksheets preserve an uncertain target as a tight source crop", async () => {
    const output = modelPackage();
    output.questions[0]!.sourceQuestionNumber = "一-1";
    output.questions[0]!.sharedPrompt = [
        { kind: "text", text: "個性魯" },
        {
            kind: "crop_ref",
            ref: "q1-bopomofo-target",
            sourceRef: "uploaded-source",
            page: 1,
            rect: { x: 0.44, y: 0.28, width: 0.16, height: 0.05 },
            alt: "第 1 題待確認的注音原文",
        },
        { kind: "text", text: "：" },
    ];
    const { calls, fetchImpl } = modelFetch([output, output]);

    const results = await analyzeQuestionSourcePages([
        sourcePage(await sourceImage(), "一、國字注音\n1 個性魯「」："),
    ], "uploaded.png", fetchImpl);

    assert.equal(calls.filter((call) => call.path === "/api/chat").length, 1);
    assert.equal(results[0]?.package.questions[0]?.sharedPrompt[1]?.kind, "crop_ref");
});

test("local vision analysis assigns unique references to model crops before validation", async () => {
    const output = worksheetPackage(["一-1", "一-2"]);
    const firstCrop = output.questions[0]!.sharedPrompt[1]!;
    const secondCrop = output.questions[1]!.sharedPrompt[1]!;
    if (firstCrop.kind !== "crop_ref" || secondCrop.kind !== "crop_ref") {
        assert.fail("測試資料必須包含兩個裁切參照");
    }
    firstCrop.ref = "bopomofo-target";
    secondCrop.ref = "bopomofo-target";
    const { calls, fetchImpl } = modelFetch([output, output]);

    const results = await analyzeQuestionSourcePages([
        sourcePage(
            await sourceImage(),
            "一、國字注音：每字1分，共2分\n1 個性魯「」：\n2 學問「」博：",
        ),
    ], "uploaded.png", fetchImpl);

    const references = results[0]!.package.questions.flatMap((question) => question.sharedPrompt.flatMap((block) => (
        block.kind === "crop_ref" ? [block.ref] : []
    )));
    assert.equal(new Set(references).size, 2);
    assert.deepEqual(references, ["q1-shared-2", "q2-shared-2"]);
    assert.equal(calls.filter((call) => call.path === "/api/chat").length, 1);
    const request = calls.find((call) => call.path === "/api/chat")?.body as {
        messages: Array<{ content: string }>;
    };
    assert.match(request.messages[0]!.content, /每個 crop_ref.*ref.*唯一/u);
});

test("Bopomofo worksheets reject repeated OCR-like garbage", async () => {
    const invalid = modelPackage();
    invalid.questions[0]!.sourceQuestionNumber = "一-2";
    invalid.questions[0]!.sharedPrompt = [{ kind: "text", text: "學問「口ㄅㄨˇ」博：" }];
    const { fetchImpl } = modelFetch([invalid, invalid]);
    const image = await sourceImage();

    await assert.rejects(
        () => analyzeQuestionSourcePages([
            sourcePage(image, "一、國字注音\n2 學問「u」博："),
        ], "uploaded.png", fetchImpl),
        (error) => error instanceof QuestionSourceAnalysisError && error.code === "LOCAL_MODEL_LOW_CONFIDENCE",
    );
});

test("local vision analysis rejects a model with a different fixed digest", async () => {
    const { fetchImpl } = modelFetch([modelPackage()], { digest: "0".repeat(64) });
    const image = await sourceImage();

    await assert.rejects(
        () => analyzeQuestionSourcePages([{
            image,
            ocrText: "1. 第一題",
            page: 1,
        }], "uploaded.png", fetchImpl),
        (error) => error instanceof QuestionSourceAnalysisError && error.code === "LOCAL_MODEL_IDENTITY_MISMATCH",
    );
});

test("local vision analysis rejects a model without explicit vision capability", async () => {
    const { fetchImpl } = modelFetch([modelPackage()], { capabilities: ["completion"] });
    const image = await sourceImage();

    await assert.rejects(
        () => analyzeQuestionSourcePages([{
            image,
            ocrText: "1. 第一題",
            page: 1,
        }], "uploaded.png", fetchImpl),
        (error) => error instanceof QuestionSourceAnalysisError && error.code === "LOCAL_MODEL_VISION_REQUIRED",
    );
});
