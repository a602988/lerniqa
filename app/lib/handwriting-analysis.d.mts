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
}): Promise<HandwritingModel>;

export function transcribeHandwriting(
    imageBytes: Buffer,
    model: HandwritingModel,
    options?: { fetchImpl?: typeof fetch },
): Promise<HandwritingTranscription>;
