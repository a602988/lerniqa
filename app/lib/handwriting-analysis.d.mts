export const HANDWRITING_MODEL_NAME: string;
export const HANDWRITING_MODEL_DIGEST: string;

export class HandwritingAnalysisError extends Error
{
    code: string;
    retryable: boolean;
}

export interface HandwritingModel {
    engine: "ollama";
    name: string;
    digest: string;
    version: string;
    baseUrl: string;
    keepAlive: string;
}

export interface HandwritingTranscription {
    schemaVersion: string;
    transcription: string | null;
    legibility: "clear" | "uncertain" | "unreadable";
    transcriptionConfidence: number;
    uncertaintyReasons: readonly string[];
}

export function handwritingAiConfiguration(environment?: NodeJS.ProcessEnv): {
    baseUrl: string;
    model: string;
    keepAlive: string;
};

export function inspectHandwritingModel(options?: {
    configuration?: { baseUrl: string; model: string; keepAlive: string };
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): Promise<HandwritingModel>;

export function transcribeHandwriting(
    imageBytes: Buffer,
    model: HandwritingModel,
    options?: { attempts?: number; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<HandwritingTranscription>;
