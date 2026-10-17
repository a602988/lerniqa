import { createHash } from "node:crypto";

import {
    HANDWRITING_MODEL_ATTEMPTS,
    HANDWRITING_MODEL_TIMEOUT_MS,
    HANDWRITING_SCHEMA_VERSION,
    handwritingAiConfiguration,
    inspectHandwritingModel,
    prepareHandwritingOcrImage,
    transcribeHandwriting,
    validateTranscription,
} from "./handwriting-analysis.mjs";
import {
    recognizeWithAppleVision,
    recognizeWithPaddle,
} from "./handwriting-ocr.mjs";
import { isHandwritingRecognitionMode } from "./handwriting-recognition.mjs";

const CACHE_LIFETIME_MS = 10 * 60 * 1_000;
const CACHE_MAXIMUM_ENTRIES = 128;
const INTERACTIVE_BUDGET_MS = 4_500;
const PADDLE_CJK_MINIMUM_CONFIDENCE = 0.85;
const PADDLE_MINIMUM_CONFIDENCE = 0.6;
const VISION_MINIMUM_CONFIDENCE = 0.25;
const CJK_TEXT_PATTERN = /^\p{Script=Han}+$/u;

let handwritingModelPromise;
const CACHE_KEY = Symbol.for("lerniqa.handwriting.transcription-cache");
const transcriptionCache = globalThis[CACHE_KEY] ?? new Map();
globalThis[CACHE_KEY] = transcriptionCache;

/**
 * 統一不同辨識器的 Unicode 與換行格式。
 *
 * @param {unknown} value 辨識文字。
 * @returns {string | null} 正規化文字。
 */
function normalizedText(value) {
    return typeof value === "string"
        ? value.normalize("NFKC").replace(/\r\n?/gu, "\n").trim()
        : null;
}

/**
 * 透過既有 schema 建立辨識結果，避免各引擎產生不同契約。
 *
 * @param {string | null} transcription 辨識文字。
 * @param {string} legibility 清晰狀態。
 * @param {number} confidence 辨識信心。
 * @param {string[]} uncertaintyReasons 不確定原因。
 * @returns {Readonly<object>} 已驗證結果。
 */
function result(transcription, legibility, confidence, uncertaintyReasons = []) {
    return validateTranscription({
        schemaVersion: HANDWRITING_SCHEMA_VERSION,
        transcription,
        legibility,
        transcriptionConfidence: confidence,
        uncertaintyReasons,
    });
}

/**
 * 套用各 OCR 經本機樣本校準後的最低候選門檻。
 *
 * @param {{engine: string, text: string | null, confidence: number} | null} candidate OCR 候選。
 * @returns {boolean} 是否可參與共識判斷。
 */
function reliableCandidate(candidate) {
    if (!candidate || !normalizedText(candidate.text)) return false;
    if (candidate.engine === "paddleocr") return candidate.confidence >= PADDLE_MINIMUM_CONFIDENCE;
    if (candidate.engine === "apple-vision") return candidate.confidence >= VISION_MINIMUM_CONFIDENCE;
    return false;
}

/**
 * 讓互動式辨識在指定時間內回應；底層辨識器仍自行回收程序與請求。
 *
 * @param {Promise<unknown>} promise 目前執行中的辨識工作。
 * @param {number} timeoutMs 剩餘等待時間。
 * @returns {Promise<unknown | null>} 時限內的結果；逾時回傳 null。
 */
async function withinBudget(promise, timeoutMs) {
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
        timer.unref?.();
    });
    try {
        return await Promise.race([promise, timeout]);
    }
    finally {
        clearTimeout(timer);
    }
}

/**
 * 只在兩個獨立 OCR 對同一文字達成一致時直接採用，避免單一模型高信心誤讀。
 *
 * @param {Array<{engine: string, text: string | null, confidence: number} | null>} candidates OCR 候選。
 * @returns {Readonly<{schemaVersion: string, transcription: string | null, legibility: string, transcriptionConfidence: number, uncertaintyReasons: readonly string[]}> | null} 可直接採用的結果。
 */
export function resolveOcrConsensus(candidates) {
    const reliable = candidates.filter(reliableCandidate);
    if (reliable.length < 2) return null;
    const [first, ...others] = reliable;
    const transcription = normalizedText(first.text);
    if (!transcription || others.some((candidate) => normalizedText(candidate.text) !== transcription)) return null;
    const confidence = Math.min(...reliable.map((candidate) => candidate.confidence));
    return result(transcription, "clear", confidence);
}

/**
 * 繁中手寫由專門模型直接判讀；英數仍要求兩個引擎一致，避免相似字形誤判。
 *
 * @param {Array<{engine: string, text: string | null, confidence: number} | null>} candidates OCR 候選。
 * @returns {Readonly<{schemaVersion: string, transcription: string | null, legibility: string, transcriptionConfidence: number, uncertaintyReasons: readonly string[]}> | null} 可直接採用的結果。
 */
export function resolveOcrFastResult(candidates) {
    const consensus = resolveOcrConsensus(candidates);
    if (consensus) return consensus;
    const paddle = candidates.find((candidate) => candidate?.engine === "paddleocr");
    const transcription = normalizedText(paddle?.text);
    if (!transcription || !CJK_TEXT_PATTERN.test(transcription)
        || paddle.confidence < PADDLE_CJK_MINIMUM_CONFIDENCE) return null;
    return result(transcription, "clear", paddle.confidence);
}

/**
 * 優先採用本地視覺模型；模型不清楚時才允許兩個 OCR 的一致結果補位。
 *
 * @param {Array<{engine: string, text: string | null, confidence: number} | null>} candidates OCR 候選。
 * @param {Readonly<{transcription: string | null, legibility: string, transcriptionConfidence: number, uncertaintyReasons: readonly string[]}>} modelResult 視覺模型結果。
 * @returns {Readonly<{schemaVersion: string, transcription: string | null, legibility: string, transcriptionConfidence: number, uncertaintyReasons: readonly string[]}>} 最終辨識結果。
 */
export function resolveWithModel(candidates, modelResult) {
    const modelText = normalizedText(modelResult.transcription);
    if (modelResult.legibility === "clear" && modelText) return modelResult;
    return resolveOcrFastResult(candidates) ?? modelResult;
}

/**
 * 移除過期與最舊的辨識結果，限制學習者答案停留於記憶體的數量。
 *
 * @param {number} now 目前毫秒時間。
 * @returns {void} 無回傳值。
 */
function pruneCache(now) {
    for (const [checksum, entry] of transcriptionCache) {
        if (entry.expiresAt <= now) transcriptionCache.delete(checksum);
    }
    while (transcriptionCache.size >= CACHE_MAXIMUM_ENTRIES) {
        transcriptionCache.delete(transcriptionCache.keys().next().value);
    }
}

/**
 * 先執行快速 OCR；只有兩個引擎無法達成共識時才啟動本地視覺模型。
 *
 * @param {Buffer} imageBytes 已驗證 PNG。
 * @returns {Promise<Readonly<object>>} 最終辨識結果。
 */
async function runTranscription(imageBytes, {
    attempts = 1,
    budgetMs = INTERACTIVE_BUDGET_MS,
    fetchImpl = fetch,
    model: suppliedModel,
    mode = "single_character",
} = {}) {
    if (!isHandwritingRecognitionMode(mode)) return result(null, "unreadable", 0, ["other"]);
    const startedAt = Date.now();
    const remainingBudget = () => Math.max(0, budgetMs - (Date.now() - startedAt));
    const standardImage = prepareHandwritingOcrImage(imageBytes);
    const ocrResults = await withinBudget(Promise.all([
        recognizeWithPaddle(standardImage, mode),
        recognizeWithAppleVision(standardImage),
    ]), remainingBudget());
    if (!ocrResults) return result(null, "unreadable", 0, ["other"]);
    const candidates = ocrResults;
    const fastResult = resolveOcrFastResult(candidates);
    if (fastResult) return fastResult;
    const hasVisibleText = candidates.some((candidate) => normalizedText(candidate?.text));
    if (!candidates.some(reliableCandidate)) {
        return result(null, "unreadable", 0, [hasVisibleText ? "ambiguous_glyphs" : "empty"]);
    }

    let modelResult;
    try {
        let timeoutMs = remainingBudget();
        if (timeoutMs < 1) return result(null, "uncertain", 0, ["other"]);
        if (!suppliedModel) {
            handwritingModelPromise ??= inspectHandwritingModel({
                configuration: handwritingAiConfiguration(),
                fetchImpl,
                timeoutMs,
            });
        }
        const modelPromise = suppliedModel ? Promise.resolve(suppliedModel) : handwritingModelPromise;
        const model = await withinBudget(modelPromise, timeoutMs);
        if (!model) return result(null, "uncertain", 0, ["other"]);
        timeoutMs = remainingBudget();
        if (timeoutMs < 1) return result(null, "uncertain", 0, ["other"]);
        modelResult = await transcribeHandwriting(imageBytes, model, { attempts, fetchImpl, timeoutMs, mode });
    }
    catch (error) {
        handwritingModelPromise = undefined;
        return result(null, "uncertain", 0, ["other"]);
    }
    return resolveWithModel(candidates, modelResult);
}

/**
 * 執行 OCR 與本機視覺模型共用流程，供互動預覽與背景工作使用不同時間預算。
 *
 * @param {Buffer} imageBytes 已驗證的 PNG 內容。
 * @param {{attempts?: number, budgetMs?: number, fetchImpl?: typeof fetch, model?: object, mode?: "single_character" | "single_line"}} options 辨識執行條件。
 * @returns {Promise<Readonly<object>>} 最終辨識結果。
 */
export async function transcribeHybridHandwriting(imageBytes, options = {}) {
    return runTranscription(imageBytes, options);
}

/**
 * 使用本機 OCR 共識與視覺模型辨識手寫內容，並依圖片 checksum 避免重複運算。
 *
 * @param {Buffer} imageBytes 已驗證的 PNG 內容。
 * @param {{force?: boolean, mode?: "single_character" | "single_line"}} options 快取與辨識方式。
 * @returns {Promise<Readonly<{schemaVersion: string, transcription: string | null, legibility: string, transcriptionConfidence: number, uncertaintyReasons: readonly string[]}>>} 辨識結果。
 */
export async function transcribeLocalHandwriting(imageBytes, { force = false, mode = "single_character" } = {}) {
    if (!isHandwritingRecognitionMode(mode)) return result(null, "unreadable", 0, ["other"]);
    const checksum = createHash("sha256").update(imageBytes).digest("hex");
    const cacheKey = `${mode}:${checksum}`;
    const now = Date.now();
    const cached = transcriptionCache.get(cacheKey);
    if (!force && cached && cached.expiresAt > now) return cached.promise;
    if (force) transcriptionCache.delete(cacheKey);
    pruneCache(now);
    const promise = transcribeHybridHandwriting(imageBytes, { mode }).catch((error) => {
        transcriptionCache.delete(cacheKey);
        throw error;
    });
    transcriptionCache.set(cacheKey, { expiresAt: now + CACHE_LIFETIME_MS, promise });
    return promise;
}
