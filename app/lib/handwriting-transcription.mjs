import { createHash } from "node:crypto";

import {
    HANDWRITING_SCHEMA_VERSION,
    handwritingAiConfiguration,
    inspectHandwritingModel,
    prepareHandwritingImage,
    prepareHandwritingOcrImage,
    transcribeHandwriting,
    validateTranscription,
} from "./handwriting-analysis.mjs";
import {
    recognizeWithAppleVision,
    recognizeWithPaddle,
} from "./handwriting-ocr.mjs";

const CACHE_LIFETIME_MS = 10 * 60 * 1_000;
const CACHE_MAXIMUM_ENTRIES = 128;
const PADDLE_MINIMUM_CONFIDENCE = 0.6;
const VISION_MINIMUM_CONFIDENCE = 0.25;

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
 * 以本地視覺模型處理 OCR 無法一致的結果；任何可靠來源衝突都保留給人工判別。
 *
 * @param {Array<{engine: string, text: string | null, confidence: number} | null>} candidates OCR 候選。
 * @param {Readonly<{transcription: string | null, legibility: string, transcriptionConfidence: number, uncertaintyReasons: readonly string[]}>} modelResult 視覺模型結果。
 * @returns {Readonly<{schemaVersion: string, transcription: string | null, legibility: string, transcriptionConfidence: number, uncertaintyReasons: readonly string[]}>} 最終辨識結果。
 */
export function resolveWithModel(candidates, modelResult) {
    const modelText = normalizedText(modelResult.transcription);
    if (modelResult.legibility !== "clear" || !modelText) return modelResult;
    const reliable = candidates.filter(reliableCandidate);
    if (!reliable.length) return modelResult;
    const agreeing = reliable.filter((candidate) => normalizedText(candidate.text) === modelText);
    const conflicting = reliable.filter((candidate) => normalizedText(candidate.text) !== modelText);
    if (agreeing.length && !conflicting.length) {
        const confidence = Math.min(modelResult.transcriptionConfidence, ...agreeing.map((candidate) => candidate.confidence));
        return result(modelText, "clear", confidence);
    }
    return result(null, "uncertain", 0, ["ambiguous_glyphs"]);
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
 * 執行 OCR 共識、視覺模型複核及人工判別降級流程。
 *
 * @param {Buffer} imageBytes 已驗證 PNG。
 * @returns {Promise<Readonly<object>>} 最終辨識結果。
 */
async function runTranscription(imageBytes) {
    const [paddle, vision] = await Promise.all([
        recognizeWithPaddle(prepareHandwritingOcrImage(imageBytes)),
        recognizeWithAppleVision(prepareHandwritingImage(imageBytes)),
    ]);
    const candidates = [paddle, vision];
    const consensus = resolveOcrConsensus(candidates);
    if (consensus) return consensus;

    try {
        handwritingModelPromise ??= inspectHandwritingModel({
            configuration: handwritingAiConfiguration(),
        });
        const model = await handwritingModelPromise;
        const modelResult = await transcribeHandwriting(imageBytes, model);
        return resolveWithModel(candidates, modelResult);
    }
    catch (error) {
        handwritingModelPromise = undefined;
        if (candidates.some(Boolean)) return result(null, "uncertain", 0, ["other"]);
        throw error;
    }
}

/**
 * 使用本機 OCR 共識與視覺模型辨識手寫內容，並依圖片 checksum 避免重複運算。
 *
 * @param {Buffer} imageBytes 已驗證的 PNG 內容。
 * @returns {Promise<Readonly<{schemaVersion: string, transcription: string | null, legibility: string, transcriptionConfidence: number, uncertaintyReasons: readonly string[]}>>} 辨識結果。
 */
export async function transcribeLocalHandwriting(imageBytes) {
    const checksum = createHash("sha256").update(imageBytes).digest("hex");
    const now = Date.now();
    const cached = transcriptionCache.get(checksum);
    if (cached && cached.expiresAt > now) return cached.promise;
    pruneCache(now);
    const promise = runTranscription(imageBytes).catch((error) => {
        transcriptionCache.delete(checksum);
        throw error;
    });
    transcriptionCache.set(checksum, { expiresAt: now + CACHE_LIFETIME_MS, promise });
    return promise;
}
