const QUESTION_CONTENT_PLACEMENT_LABELS: Readonly<Record<string, string>> = {
    prompt: "題幹",
    option: "選項",
    answer: "答案內容",
    explanation: "解析",
    transcript: "逐字稿",
};

const QUESTION_CONTENT_TYPE_LABELS: Readonly<Record<string, string>> = {
    text: "文字",
    image: "圖片",
    audio: "音訊",
    transcript: "逐字稿",
    formula: "公式",
    table: "表格",
    page_crop: "頁面裁切",
};

export function questionContentPlacementLabel(placement: string): string {
    return QUESTION_CONTENT_PLACEMENT_LABELS[placement] ?? placement;
}

export function questionContentTypeLabel(contentType: string): string {
    return QUESTION_CONTENT_TYPE_LABELS[contentType] ?? contentType;
}

export function questionContentBlockLabel(
    placement: string,
    contentType: string,
): string {
    return `${questionContentPlacementLabel(placement)} · ${questionContentTypeLabel(contentType)}`;
}
