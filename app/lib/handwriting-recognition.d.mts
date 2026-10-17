export type HandwritingRecognitionMode = "single_character" | "single_line";

export const HANDWRITING_RECOGNITION_MODES: readonly HandwritingRecognitionMode[];
export const HANDWRITING_RECOGNITION_TYPE_LABELS: readonly string[];

export function handwritingRecognitionModeForLabel(value: unknown): HandwritingRecognitionMode | null;

export function isHandwritingRecognitionMode(value: unknown): value is HandwritingRecognitionMode;
