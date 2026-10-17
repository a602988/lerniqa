import {
    handwritingAiConfiguration,
    inspectHandwritingModel,
    transcribeHandwriting,
} from "./handwriting-analysis.mjs";

let handwritingModelPromise;

/**
 * 使用已核對的本機模型辨識手寫內容，並在模型失效後清除快取。
 * @param {Buffer} imageBytes 已驗證的 PNG 內容。
 * @returns {Promise<Readonly<{schemaVersion: string, transcription: string | null, legibility: string, transcriptionConfidence: number, uncertaintyReasons: readonly string[]}>>} 辨識結果。
 */
export async function transcribeLocalHandwriting(imageBytes) {
    handwritingModelPromise ??= inspectHandwritingModel({
        configuration: handwritingAiConfiguration(),
    });
    try {
        const model = await handwritingModelPromise;
        return await transcribeHandwriting(imageBytes, model);
    }
    catch (error) {
        handwritingModelPromise = undefined;
        throw error;
    }
}
