/** 使用者介面與新資料一律顯示的國語科目名稱。 */
export const CHINESE_SUBJECT_LABEL = "國語";

/** 舊題庫與外部來源可能使用的同義科目名稱。 */
export const LEGACY_CHINESE_SUBJECT_LABEL = "國文";

/** 將舊科目名稱收斂到介面使用的名稱，避免建立第二個國語科目。 */
export function normalizeSubjectLabel(value: string): string {
    const normalized = value.normalize("NFKC").trim();
    return normalized === LEGACY_CHINESE_SUBJECT_LABEL ? CHINESE_SUBJECT_LABEL : normalized;
}

/** 正規化科目清單並合併舊名與目前名稱。 */
export function normalizeSubjectLabels(values: readonly string[]): string[] {
    return [...new Set(values.map(normalizeSubjectLabel))];
}

/**
 * 將以科目為 key 的舊資料搬到目前名稱；新名稱已存在時以新名稱的值為準。
 */
export function normalizeSubjectRecord<T>(values: Readonly<Record<string, T>>): Record<string, T> {
    const normalized = new Map<string, T>();

    Object.entries(values).forEach(([subject, value]) => {
        const canonicalSubject = normalizeSubjectLabel(subject);
        if (!normalized.has(canonicalSubject)) normalized.set(canonicalSubject, value);
    });
    Object.entries(values).forEach(([subject, value]) => {
        const canonicalSubject = normalizeSubjectLabel(subject);
        if (canonicalSubject === subject) normalized.set(canonicalSubject, value);
    });

    return Object.fromEntries(normalized);
}

/** 將排程等顯示字串開頭的舊科目名稱換成目前名稱。 */
export function normalizeSubjectDisplayLabel(value: string): string {
    return value.replace(/^國文(?=$|\s*·)/u, CHINESE_SUBJECT_LABEL);
}

/** 取得查詢既有題庫時需要接受的 canonical 名稱與舊別名。 */
export function getSubjectLookupLabels(value: string): string[] {
    const normalized = normalizeSubjectLabel(value);
    return normalized === CHINESE_SUBJECT_LABEL
        ? [CHINESE_SUBJECT_LABEL, LEGACY_CHINESE_SUBJECT_LABEL]
        : [normalized];
}
