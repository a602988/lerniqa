export type FileSourceCandidate = {
    name: string;
    type: string;
};

export type FileSourceSelection<T extends FileSourceCandidate> =
    | { kind: "accepted"; files: T[] }
    | { kind: "empty" }
    | { kind: "too_many" }
    | { kind: "unsupported" };

const CLIPBOARD_EXTENSIONS = new Map([
    ["application/json", "json"],
    ["application/pdf", "pdf"],
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
]);

/**
 * Checks whether a selected file matches an HTML file input accept value.
 *
 * @param file - File name and MIME type supplied by the browser.
 * @param accept - Comma-separated MIME types, wildcards, and extensions.
 * @returns Whether at least one accept rule permits the file.
 */
export function fileMatchesAccept(file: FileSourceCandidate, accept: string): boolean {
    const rules = accept.split(",").map((rule) => rule.trim().toLowerCase()).filter(Boolean);
    if (!rules.length) return true;
    const name = file.name.toLowerCase();
    const mimeType = file.type.toLowerCase();
    return rules.some((rule) => {
        if (rule === "*/*") return true;
        if (rule.startsWith(".")) return name.endsWith(rule);
        if (rule.endsWith("/*")) return mimeType.startsWith(rule.slice(0, -1));
        return mimeType === rule;
    });
}

/**
 * Validates files from every picker source before they reach the upload callback.
 *
 * @param files - Files supplied by a file input, Google Drive, or the clipboard.
 * @param accept - Formats permitted by the current picker.
 * @param multiple - Whether the current picker accepts more than one file.
 * @returns A typed selection result for the picker to handle exhaustively.
 */
export function selectFilesForAccept<T extends FileSourceCandidate>(
    files: readonly T[],
    accept: string,
    multiple: boolean,
): FileSourceSelection<T> {
    if (!files.length) return { kind: "empty" };
    if (!multiple && files.length > 1) return { kind: "too_many" };
    if (files.some((file) => !fileMatchesAccept(file, accept))) return { kind: "unsupported" };
    return { kind: "accepted", files: [...files] };
}

/**
 * Gives unnamed clipboard blobs a stable extension accepted by the upload APIs.
 *
 * @param blob - Clipboard content returned by the browser.
 * @param index - Zero-based position within the clipboard contents.
 * @returns A named file for supported MIME types, or null for other content.
 */
export function createClipboardFile(blob: Blob, index: number): File | null {
    const extension = CLIPBOARD_EXTENSIONS.get(blob.type.toLowerCase());
    if (!extension) return null;
    return new File([blob], `clipboard-${index + 1}.${extension}`, { type: blob.type });
}
