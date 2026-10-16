import { createHash } from "node:crypto";
import { copyFile, link, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import {
    VISUAL_REFERENCE,
    cleanText,
    parseAnswerLetters,
    parseMetadataLast,
    parseOptions,
    parseParts,
    parseWrittenParts,
} from "../import-grade-seven-fixtures.mjs";

export const PARSER_VERSION = "hanlin-zh-doc-v2";
export const SANITIZER_VERSION = "libreoffice-macro-disabled-docx-v1";
export const AUTHORIZED_FOURTH_LESSON_FILE = "05_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc";
export const AUTHORIZED_FOURTH_LESSON_SHA256 = "c2b09d04ef9e0a32a2fbe71a8f8e930d2061fb87e78bb6bc60f694df6be8cfb2";
export const HANLIN_CHINESE_TYPES = [
    "寫出國字、注音",
    "注釋",
    "改錯題",
    "填充題",
    "配合題",
    "單一選擇題",
    "選詞測驗",
    "題組",
];

export const TARGET_CLASSIFICATION = Object.freeze({
    key: "jh1-zh-hanlin-v1-l4",
    gradeCode: "junior-high-1",
    gradeName: "國一",
    semesterCode: "semester-1",
    semesterName: "上學期",
    subjectCode: "chinese",
    subjectName: "國語",
    subjectAlias: "國文",
    publisherCode: "hanlin",
    publisherName: "翰林",
    bookName: "第一冊",
    volumeCode: "volume-1",
    volumeName: "第一冊",
    unitCode: "lesson-4",
    unitName: "第四課",
    sourceCategoryCode: "publisher-test-bank",
    sourceCategoryName: "出版社題庫",
});

const UUID_NAMESPACE = "a14dc152-b0c8-4c88-93e6-17c4e5171cc9";

/**
 * 固定本機練習身份；API 串接必須使用相同的 user/learner UUID。
 */
export const LOCAL_PRACTICE_IDS = Object.freeze({
    userId: "10000000-0000-4000-8000-000000000001",
    learnerId: "10000000-0000-4000-8000-000000000002",
});

function namespaceBytes(namespace) {
    return Buffer.from(namespace.replaceAll("-", ""), "hex");
}

/** 產生 RFC 4122 UUID v5，讓同一來源重跑時使用完全相同的識別碼。 */
export function deterministicUuid(name) {
    const hash = createHash("sha1")
        .update(namespaceBytes(UUID_NAMESPACE))
        .update(String(name), "utf8")
        .digest()
        .subarray(0, 16);
    hash[6] = (hash[6] & 0x0f) | 0x50;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const value = hash.toString("hex");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export const LOCAL_CATALOG_IDS = Object.freeze({
    roleId: deterministicUuid("local-practice:role:learner"),
    learnerAccessId: deterministicUuid("local-practice:learner-access"),
    gradeId: deterministicUuid("catalog:grade:junior-high-1"),
    semesterId: deterministicUuid("catalog:semester:semester-1"),
    publisherId: deterministicUuid("catalog:publisher:hanlin"),
    subjectId: deterministicUuid("catalog:subject:chinese"),
    subjectAliasId: deterministicUuid("catalog:subject-alias:chinese:國文"),
    bookVersionId: deterministicUuid("catalog:book:chinese:junior-high-1:hanlin:volume-1"),
    volumeUnitId: deterministicUuid("catalog:unit:hanlin:chinese:volume-1"),
    targetUnitId: deterministicUuid("catalog:unit:hanlin:chinese:volume-1:lesson-4"),
    learnerSubjectSettingId: deterministicUuid("local-practice:learner-subject:chinese"),
    questionBankId: deterministicUuid("local-practice:question-bank:default"),
    sourceCategoryId: deterministicUuid("catalog:source-category:publisher-test-bank"),
    questionTypeChoiceId: deterministicUuid("catalog:question-type:single-choice"),
    questionTypeMultiId: deterministicUuid("catalog:question-type:multi-choice"),
    questionTypeWrittenId: deterministicUuid("catalog:question-type:written"),
    difficultyBasicId: deterministicUuid("catalog:difficulty:basic"),
    difficultyIntermediateId: deterministicUuid("catalog:difficulty:intermediate"),
    difficultyAdvancedId: deterministicUuid("catalog:difficulty:advanced"),
});

export class HanlinImportError extends Error {
    constructor(code, message, fileName = null) {
        super(message);
        this.name = "HanlinImportError";
        this.code = code;
        this.fileName = fileName;
    }
}

function runTool(command, args, fileName, options = {}) {
    const result = spawnSync(command, args, {
        encoding: options.encoding ?? "utf8",
        maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
        timeout: options.timeout ?? 120_000,
        env: options.env ?? process.env,
        cwd: options.cwd,
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0) {
        throw new HanlinImportError(
            "LOCAL_TOOL_FAILED",
            `${path.basename(command)} 無法處理 ${fileName}（exit ${result.status ?? "unavailable"}）。`,
            fileName,
        );
    }
    return result.stdout;
}

function findTool(preferredPath, fallback) {
    return existsSync(preferredPath) ? preferredPath : fallback;
}

const TOOLS = Object.freeze({
    file: "/usr/bin/file",
    textutil: "/usr/bin/textutil",
    soffice: findTool("/opt/homebrew/bin/soffice", "soffice"),
    pdfinfo: findTool("/opt/homebrew/bin/pdfinfo", "pdfinfo"),
    pdftotext: findTool("/opt/homebrew/bin/pdftotext", "pdftotext"),
    pdfimages: findTool("/opt/homebrew/bin/pdfimages", "pdfimages"),
    pdfdetach: findTool("/opt/homebrew/bin/pdfdetach", "pdfdetach"),
    unzip: findTool("/usr/bin/unzip", "unzip"),
    zip: findTool("/usr/bin/zip", "zip"),
    sevenZip: findTool("/opt/homebrew/bin/7z", "7z"),
});

const STORAGE_KEY_SEGMENT = /^(?!\.{1,2}$)[^/\\]+$/;

/** DB storage_key 是相對 local-data/assets 根目錄的 POSIX 路徑。 */
export function assertAssetStorageKey(storageKey) {
    if (typeof storageKey !== "string"
        || !storageKey
        || path.posix.isAbsolute(storageKey)
        || storageKey.includes("\\")
        || storageKey.startsWith("local-data/assets/")
        || !storageKey.split("/").every((segment) => STORAGE_KEY_SEGMENT.test(segment))) {
        throw new HanlinImportError("INVALID_STORAGE_KEY", "產生了不合法的本機資產 storage_key。");
    }
    return storageKey;
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function stableJson(value) {
    return JSON.stringify(stableValue(value));
}

function sha256Buffer(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
}

function sha256Text(value) {
    return sha256Buffer(Buffer.from(value, "utf8"));
}

function normalizeQuestionNumber(value) {
    return String(value ?? "").normalize("NFKC").trim().toLowerCase();
}

function normalizeSanitizedSectionHeaders(value) {
    const escapedTypes = HANLIN_CHINESE_TYPES.map((type) => escapeRegex(type)).join("|");
    return String(value).replace(
        new RegExp(`^[\\t 　]*(?:[•●▪◦][\\t 　]*)?(${escapedTypes})[\\t 　]*$`, "gm"),
        "$1",
    );
}

/**
 * LibreOffice preserves some legacy Word sequence fields as strings such as
 * `\\S\\do 4(１)１...` at the beginning of a question line. They are layout
 * instructions for the source question number, not question content.
 */
export function stripLegacyWordSequenceFieldPrefixes(value) {
    return String(value).replace(
        /^[\t 　]*(?=\\S\\do)(?:\\S\\do\s+\d+\([0-9０-９]\)?|[0-9０-９()（）])+/gm,
        "",
    );
}

function normalizeStableKey(value, fallback) {
    const normalized = String(value ?? "")
        .normalize("NFKC")
        .trim()
        .replace(/[^0-9A-Za-z_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized || fallback;
}

function strictDifficulty(value) {
    const normalized = String(value ?? "").normalize("NFKC").trim();
    if (normalized === "易") return "basic";
    if (normalized === "中") return "intermediate";
    if (normalized === "難") return "advanced";
    return null;
}

function imageDimensions(buffer, mimeType) {
    if (mimeType === "image/gif" && buffer.length >= 10) {
        return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (mimeType === "image/png" && buffer.length >= 24) {
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mimeType === "image/jpeg") {
        let offset = 2;
        while (offset + 9 < buffer.length) {
            if (buffer[offset] !== 0xff) {
                offset += 1;
                continue;
            }
            const marker = buffer[offset + 1];
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
                return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
            }
            const length = buffer.readUInt16BE(offset + 2);
            if (length < 2) break;
            offset += length + 2;
        }
    }
    return { width: null, height: null };
}

function macroHeuristic(buffer) {
    const latin = buffer.toString("latin1").toLowerCase();
    const utf16 = buffer.toString("utf16le").toLowerCase();
    const markers = [
        "_vba_project",
        "vbaproject",
        "wordbasic",
        "autoopen",
        "autoexec",
        "document_open",
        "thisdocument",
        "macros",
    ];
    return markers.filter((marker) => latin.includes(marker) || utf16.includes(marker));
}

async function validateWordDocument(sourcePath, fileName) {
    const metadata = await stat(sourcePath);
    if (!metadata.isFile()) throw new HanlinImportError("NOT_A_FILE", `${fileName} 不是一般檔案。`, fileName);
    const mimeType = runTool(TOOLS.file, ["--brief", "--mime-type", sourcePath], fileName).trim();
    const description = runTool(TOOLS.file, ["--brief", sourcePath], fileName).trim();
    if (mimeType !== "application/msword" || !description.includes("Composite Document File V2 Document")) {
        throw new HanlinImportError("UNSUPPORTED_DOCUMENT", `${fileName} 不是預期的 OLE2 Word .doc。`, fileName);
    }
    const buffer = await readFile(sourcePath);
    const macroMarkers = macroHeuristic(buffer);
    return {
        byteSize: metadata.size,
        sha256: sha256Buffer(buffer),
        mimeType,
        macroMarkers,
    };
}

/**
 * Read one stable source descriptor and keep those exact bytes in the private
 * import workspace. Conversion and quarantine must both use this snapshot so
 * a source replacement cannot split checksum evidence from parsed content.
 */
export async function snapshotWordDocument(sourcePath, snapshotPath, fileName = path.basename(sourcePath)) {
    let sourceHandle;
    try {
        sourceHandle = await open(sourcePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const metadata = await sourceHandle.stat();
        if (!metadata.isFile()) throw new HanlinImportError("NOT_A_FILE", `${fileName} 不是一般檔案。`, fileName);
        const sourceBytes = await sourceHandle.readFile();
        await writeFile(snapshotPath, sourceBytes, { flag: "wx", mode: 0o400 });
        return {
            snapshotPath,
            byteSize: sourceBytes.length,
            sha256: sha256Buffer(sourceBytes),
        };
    }
    catch (error) {
        if (error instanceof HanlinImportError) throw error;
        throw new HanlinImportError("SOURCE_FILE_READ_FAILED", `無法安全讀取 ${fileName}。`, fileName);
    }
    finally {
        await sourceHandle?.close().catch(() => undefined);
    }
}

async function configureLockedLibreOfficeProfile(profilePath, fileName) {
    const profileUrl = pathToFileURL(profilePath).href;
    runTool(TOOLS.soffice, [
        `-env:UserInstallation=${profileUrl}`,
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--norestore",
        "--terminate_after_init",
    ], fileName);
    const registryPath = path.join(profilePath, "user", "registrymodifications.xcu");
    const currentSettings = await readFile(registryPath, "utf8");
    const lockedSetting = `  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>
  </item>
`;
    if (!currentSettings.includes("</oor:items>")) {
        throw new HanlinImportError("LIBREOFFICE_PROFILE_INVALID", `${fileName} 的隔離轉檔 profile 無法鎖定巨集安全層級。`, fileName);
    }
    const settings = currentSettings.replace("</oor:items>", `${lockedSetting}</oor:items>`);
    await writeFile(registryPath, settings, "utf8");
}

async function validateSanitizedPdf(pdfPath, fileName) {
    const mimeType = runTool(TOOLS.file, ["--brief", "--mime-type", pdfPath], fileName).trim();
    if (mimeType !== "application/pdf") {
        throw new HanlinImportError("SANITIZED_TYPE_MISMATCH", `${fileName} 未產生預期的無巨集 PDF。`, fileName);
    }
    const buffer = await readFile(pdfPath);
    const pdfText = buffer.toString("latin1");
    const javascript = runTool(TOOLS.pdfinfo, ["-js", pdfPath], fileName).trim();
    const embeddedFiles = runTool(TOOLS.pdfdetach, ["-list", pdfPath], fileName).trim();
    const embeddedFileCount = Number(embeddedFiles.match(/^(\d+)\s+embedded files?\b/i)?.[1] ?? 0);
    const dangerousDictionary = /\/(?:Launch|RichMedia)\b/.test(pdfText);
    if (javascript || embeddedFileCount > 0 || dangerousDictionary) {
        throw new HanlinImportError(
            "SANITIZED_ACTIVE_CONTENT",
            `${fileName} 的衍生 PDF 仍含主動內容，拒絕匯入。`,
            fileName,
        );
    }
    return {
        mimeType,
        byteSize: buffer.length,
        sha256: sha256Buffer(buffer),
    };
}

async function validateSanitizedDocx(docxPath, fileName) {
    const mimeType = runTool(TOOLS.file, ["--brief", "--mime-type", docxPath], fileName).trim();
    const acceptedMimeTypes = new Set([
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/zip",
    ]);
    if (!acceptedMimeTypes.has(mimeType)) {
        throw new HanlinImportError("SANITIZED_TYPE_MISMATCH", `${fileName} 未產生預期的無巨集 DOCX。`, fileName);
    }
    const entries = runTool(TOOLS.unzip, ["-Z1", docxPath], fileName)
        .split("\n")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
    if (entries.some((entry) => entry.includes("vbaproject") || entry.startsWith("macros/") || entry.startsWith("word/activex/"))) {
        throw new HanlinImportError("SANITIZED_MACRO_RETAINED", `${fileName} 的衍生 DOCX 仍含巨集或 ActiveX 內容。`, fileName);
    }
    const buffer = await readFile(docxPath);
    return {
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byteSize: buffer.length,
        sha256: sha256Buffer(buffer),
    };
}

async function listRelativeFiles(root, current = "") {
    const directory = path.join(root, current);
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name, "en"))) {
        const relative = current ? path.posix.join(current, entry.name) : entry.name;
        if (entry.isDirectory()) files.push(...await listRelativeFiles(root, relative));
        else if (entry.isFile()) files.push(relative);
    }
    return files;
}

async function normalizeUnpackedDocx(unpacked, scratchRoot, fileName, depth = 0) {
    if (depth > 3) {
        throw new HanlinImportError("SANITIZED_NESTING_TOO_DEEP", `${fileName} 的內嵌 DOCX 層數異常。`, fileName);
    }
    const corePath = path.join(unpacked, "docProps", "core.xml");
    const core = await readFile(corePath, "utf8").catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
    });
    if (core !== null) {
        const scrubbed = core
            .replace(/(<dc:creator\b[^>]*>)[\s\S]*?(<\/dc:creator>)/gi, "$1$2")
            .replace(/(<cp:lastModifiedBy\b[^>]*>)[\s\S]*?(<\/cp:lastModifiedBy>)/gi, "$1$2")
            .replace(
                /(<dcterms:(?:created|modified)\b[^>]*>)[\s\S]*?(<\/dcterms:(?:created|modified)>)/gi,
                (_match, opening, closing) => `${opening}2000-01-01T00:00:00Z${closing}`,
            )
            .replace(
                /(<cp:revision\b[^>]*>)[\s\S]*?(<\/cp:revision>)/gi,
                (_match, opening, closing) => `${opening}1${closing}`,
            );
        await writeFile(corePath, scrubbed, "utf8");
    }

    const initialFiles = await listRelativeFiles(unpacked);
    const nestedDocxFiles = initialFiles.filter((entry) => entry.toLowerCase().endsWith(".docx"));
    for (const [index, relative] of nestedDocxFiles.entries()) {
        const nestedPath = path.join(unpacked, ...relative.split("/"));
        const nestedRoot = path.join(scratchRoot, `nested-${depth}-${index}`);
        await mkdir(nestedRoot, { recursive: true });
        runTool(TOOLS.unzip, ["-q", nestedPath, "-d", nestedRoot], fileName);
        await normalizeUnpackedDocx(nestedRoot, scratchRoot, fileName, depth + 1);
        const nestedFiles = await listRelativeFiles(nestedRoot);
        const fixedTimestamp = new Date("2000-01-01T00:00:00.000Z");
        for (const nestedRelative of nestedFiles) {
            await utimes(path.join(nestedRoot, ...nestedRelative.split("/")), fixedTimestamp, fixedTimestamp);
        }
        await unlink(nestedPath);
        runTool(TOOLS.zip, ["-X", "-q", nestedPath, ...nestedFiles], fileName, { cwd: nestedRoot });
        await rm(nestedRoot, { recursive: true, force: true });
    }

    const files = await listRelativeFiles(unpacked);
    for (const relative of files.filter((entry) => entry.toLowerCase().endsWith(".xml"))) {
        const xmlPath = path.join(unpacked, ...relative.split("/"));
        const xml = await readFile(xmlPath, "utf8");
        let objectIndex = 0;
        let layerIndex = 0;
        const normalized = xml
            // LibreOffice allocates these opaque identifiers from process state.
            .replace(/ObjectID="_\d+"/g, () => `ObjectID="_${++objectIndex}"`)
            // Preserve drawing order while removing the process-specific z-order seed.
            .replace(/relativeHeight="\d+"/g, () => `relativeHeight="${++layerIndex}"`)
            // Cached dynamic field values (notably PAGE) vary with the conversion session.
            .replace(
                /(<w:fldChar\b[^>]*w:fldCharType="separate"[^>]*\/>)([\s\S]*?)(<w:fldChar\b[^>]*w:fldCharType="end"[^>]*\/>)/g,
                (_match, opening, body, closing) => `${opening}${body.replace(/(<w:t\b[^>]*>)\d+(<\/w:t>)/g, "$11$2")}${closing}`,
            );
        if (normalized !== xml) await writeFile(xmlPath, normalized, "utf8");
    }
}

async function normalizeSanitizedDocx(docxPath, documentWork, fileName) {
    const unpacked = path.join(documentWork, "normalized-docx");
    const normalizedPath = path.join(documentWork, "sanitized.docx");
    const nestedScratch = path.join(documentWork, "normalized-nested-docx");
    await mkdir(unpacked, { recursive: true });
    await mkdir(nestedScratch, { recursive: true });
    runTool(TOOLS.unzip, ["-q", docxPath, "-d", unpacked], fileName);
    await normalizeUnpackedDocx(unpacked, nestedScratch, fileName);

    const files = await listRelativeFiles(unpacked);
    const fixedTimestamp = new Date("2000-01-01T00:00:00.000Z");
    for (const relative of files) {
        await utimes(path.join(unpacked, ...relative.split("/")), fixedTimestamp, fixedTimestamp);
    }
    runTool(TOOLS.zip, ["-X", "-q", normalizedPath, ...files], fileName, { cwd: unpacked });
    return normalizedPath;
}

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let value = 0; value < table.length; value += 1) {
        let crc = value;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        table[value] = crc >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const value of buffer) crc = CRC32_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function extractPngPayloads(buffer, { requireWholeBuffer = false } = {}) {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const payloads = [];
    let searchOffset = 0;
    while (searchOffset < buffer.length) {
        const start = buffer.indexOf(signature, searchOffset);
        if (start < 0) break;
        let offset = start + signature.length;
        let valid = false;
        let chunkIndex = 0;
        let sawImageData = false;
        while (offset + 12 <= buffer.length) {
            const length = buffer.readUInt32BE(offset);
            const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
            const end = offset + 12 + length;
            if (!/^[A-Za-z]{4}$/.test(type) || end > buffer.length) break;
            const data = buffer.subarray(offset + 8, offset + 8 + length);
            const declaredCrc = buffer.readUInt32BE(offset + 8 + length);
            const computedCrc = crc32(buffer.subarray(offset + 4, offset + 8 + length));
            if (declaredCrc !== computedCrc) break;
            if (chunkIndex === 0) {
                if (type !== "IHDR" || length !== 13) break;
                const width = data.readUInt32BE(0);
                const height = data.readUInt32BE(4);
                const bitDepth = data[8];
                const colorType = data[9];
                const validDepths = {
                    0: [1, 2, 4, 8, 16],
                    2: [8, 16],
                    3: [1, 2, 4, 8],
                    4: [8, 16],
                    6: [8, 16],
                };
                if (!width || !height || width > 20_000 || height > 20_000
                    || !validDepths[colorType]?.includes(bitDepth)
                    || data[10] !== 0 || data[11] !== 0 || ![0, 1].includes(data[12])) break;
            }
            if (type === "IDAT") sawImageData = true;
            offset = end;
            if (type === "IEND") {
                const payload = buffer.subarray(start, end);
                if (length === 0 && sawImageData && (!requireWholeBuffer || (start === 0 && end === buffer.length))) {
                    payloads.push({ buffer: payload, mimeType: "image/png", extension: ".png" });
                    valid = true;
                }
                break;
            }
            chunkIndex += 1;
        }
        searchOffset = valid ? offset : start + signature.length;
    }
    return payloads;
}

function xmlAttribute(fragment, name) {
    return fragment.match(new RegExp(`\\b${escapeRegex(name)}="([^"]+)"`))?.[1] ?? null;
}

function parseDocumentRelationships(xml) {
    const relationships = new Map();
    for (const match of xml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
        const fragment = match[0];
        const id = xmlAttribute(fragment, "Id");
        const target = xmlAttribute(fragment, "Target");
        const type = xmlAttribute(fragment, "Type");
        if (id && target && type) relationships.set(id, { target, type });
    }
    return relationships;
}

function resolveDocxRelationship(unpackedDocx, target) {
    if (!target || target.includes("\\") || path.posix.isAbsolute(target)) return null;
    const segments = path.posix.normalize(path.posix.join("word", target)).split("/");
    if (segments.some((segment) => segment === ".." || !segment)) return null;
    const resolved = path.resolve(unpackedDocx, ...segments);
    return resolved.startsWith(`${path.resolve(unpackedDocx)}${path.sep}`) ? resolved : null;
}

function safeSevenZipEntries(archivePath, fileName) {
    const listing = runTool(TOOLS.sevenZip, ["l", "-ba", archivePath], fileName);
    return listing.split("\n").map((line) => line.trim().split(/\s{2,}/).at(-1)).filter(Boolean);
}

function assertSafeEmbeddedArchive(archivePath, fileName) {
    const dangerous = /(?:^|[/\\])(?:vba|_vba_project|projectwm|ole10native|activex)(?:$|[/\\])/i;
    const entries = safeSevenZipEntries(archivePath, fileName);
    if (entries.some((entry) => dangerous.test(entry))) {
        throw new HanlinImportError("SANITIZED_EMBEDDED_ACTIVE_CONTENT", `${fileName} 的衍生 DOCX 仍含不安全內嵌內容。`, fileName);
    }
    return entries;
}

async function extractOlePng(objectPath, extractionRoot, fileName) {
    const entries = assertSafeEmbeddedArchive(objectPath, fileName);
    if (entries.filter((entry) => entry === "Data").length !== 1) return null;
    await mkdir(extractionRoot, { recursive: true });
    try {
        runTool(TOOLS.sevenZip, ["e", "-y", `-o${extractionRoot}`, objectPath, "Data"], fileName);
    }
    catch (error) {
        if (!(error instanceof HanlinImportError) || error.code !== "LOCAL_TOOL_FAILED") throw error;
        return null;
    }
    const data = await readFile(path.join(extractionRoot, "Data")).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
    });
    if (!data || data.length > 64 * 1024 * 1024) return null;
    const payloads = extractPngPayloads(data).filter(({ buffer }) => data.indexOf(buffer) + buffer.length === data.length);
    return payloads.length === 1 ? payloads[0] : null;
}

async function extractStableEmbeddedImages(unpackedDocx, documentWork, fileName) {
    const documentXml = await readFile(path.join(unpackedDocx, "word", "document.xml"), "utf8");
    const relationshipsXml = await readFile(path.join(unpackedDocx, "word", "_rels", "document.xml.rels"), "utf8");
    const relationships = parseDocumentRelationships(relationshipsXml);
    const tokens = [...documentXml.matchAll(/<w:object\b[\s\S]*?<\/w:object>|<a:blip\b[^>]*\br:embed="[^"]+"[^>]*\/?\s*>|<v:imagedata\b[^>]*\br:id="[^"]+"[^>]*\/?\s*>/g)];
    const outputRoot = path.join(documentWork, "stable-question-images");
    await mkdir(outputRoot, { recursive: true });
    const images = [];
    let ambiguous = false;

    for (const [objectIndex, match] of tokens.entries()) {
        const fragment = match[0];
        let payload = null;
        if (fragment.startsWith("<w:object")) {
            const oleFragment = fragment.match(/<o:OLEObject\b[^>]*\br:id="[^"]+"[^>]*\/?\s*>/)?.[0];
            const relationshipId = oleFragment ? xmlAttribute(oleFragment, "r:id") : null;
            const relationship = relationshipId ? relationships.get(relationshipId) : null;
            const objectPath = relationship?.type.endsWith("/oleObject")
                ? resolveDocxRelationship(unpackedDocx, relationship.target)
                : null;
            if (objectPath) {
                payload = await extractOlePng(
                    objectPath,
                    path.join(documentWork, `embedded-${String(objectIndex).padStart(3, "0")}`),
                    fileName,
                );
                if (payload) payload = { ...payload, provenance: "ole-data" };
            }
        }
        else {
            const relationshipId = xmlAttribute(fragment, fragment.startsWith("<a:blip") ? "r:embed" : "r:id");
            const relationship = relationshipId ? relationships.get(relationshipId) : null;
            const mediaPath = relationship?.type.endsWith("/image")
                ? resolveDocxRelationship(unpackedDocx, relationship.target)
                : null;
            if (mediaPath) {
                const media = await readFile(mediaPath);
                const payloads = extractPngPayloads(media, { requireWholeBuffer: true });
                if (payloads.length === 1) payload = { ...payloads[0], provenance: "docx-media" };
            }
        }
        if (!payload) {
            ambiguous = true;
            continue;
        }
        const checksum = sha256Buffer(payload.buffer);
        const temporaryPath = path.join(outputRoot, `${String(objectIndex).padStart(3, "0")}-${checksum}${payload.extension}`);
        await writeFile(temporaryPath, payload.buffer);
        images.push({
            ...payload,
            checksum,
            temporaryPath,
            dimensions: imageDimensions(payload.buffer, payload.mimeType),
        });
    }
    return { images, ambiguous };
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mapQuestionPages(records, pages) {
    return records.map((record) => {
        const number = normalizeQuestionNumber(record.number);
        if (!number) return [];
        const escaped = escapeRegex(number);
        const numeric = /^[0-9]+$/.test(number);
        const labeledMatcher = new RegExp(`編\\s*號\\s*[:：]\\s*${escaped}(?:\\s|$)`, "i");
        const fallbackMatcher = new RegExp(numeric ? `(^|[^0-9])${escaped}([^0-9]|$)` : escaped, "i");
        const labeledPages = pages.flatMap((pageText, index) =>
            labeledMatcher.test(pageText.normalize("NFKC").toLowerCase()) ? [index + 1] : []);
        if (labeledPages.length) return labeledPages;
        return pages.flatMap((pageText, index) => fallbackMatcher.test(pageText.normalize("NFKC").toLowerCase()) ? [index + 1] : []);
    });
}

function parsePdfImageRows(value) {
    return value.split("\n").flatMap((line) => {
        const columns = line.trim().split(/\s+/);
        if (!/^\d+$/.test(columns[0] ?? "") || columns[2] !== "image") return [];
        return [{ page: Number(columns[0]), width: Number(columns[3]), height: Number(columns[4]) }];
    });
}

function parseHtmlNumberMatches(html) {
    return [...html.matchAll(/編號：(?:\s|<[^>]*>)*([0-9]+)/g)].map((match) => ({
        index: match.index ?? 0,
        number: normalizeQuestionNumber(match[1]),
    }));
}

async function extractImages({ html, htmlPath, pdfImageRows, stableImages, records, recordPages }) {
    const imageTags = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)].map((match) => ({
        index: match.index ?? 0,
        source: decodeURIComponent(match[1]),
    }));
    const numberMatches = parseHtmlNumberMatches(html);
    const recordIndexesByNumber = new Map();
    records.forEach((record, index) => {
        const key = normalizeQuestionNumber(record.number);
        recordIndexesByNumber.set(key, [...(recordIndexesByNumber.get(key) ?? []), index]);
    });
    const pendingIndexes = new Set();
    const imagesByRecord = new Map();
    const countMismatch = imageTags.length !== pdfImageRows.length || imageTags.length !== stableImages.images.length
        || stableImages.ambiguous || stableImages.images.some((image) => image.provenance !== "ole-data");

    if (countMismatch) {
        for (const tag of imageTags) {
            const following = numberMatches.find((entry) => entry.index > tag.index);
            const candidateIndexes = following ? recordIndexesByNumber.get(following.number) ?? [] : [];
            if (candidateIndexes.length === 1) pendingIndexes.add(candidateIndexes[0]);
        }
        records.forEach((record, index) => {
            if (VISUAL_REFERENCE.test(record.body)) pendingIndexes.add(index);
        });
        return { imagesByRecord, pendingIndexes, imageTags: imageTags.length, pdfImages: pdfImageRows.length };
    }

    for (let imageIndex = 0; imageIndex < imageTags.length; imageIndex += 1) {
        const tag = imageTags[imageIndex];
        const pdfImage = pdfImageRows[imageIndex];
        const stableImage = stableImages.images[imageIndex];
        const following = tag ? numberMatches.find((entry) => entry.index > tag.index) : null;
        const candidateIndexes = following ? recordIndexesByNumber.get(following.number) ?? [] : [];
        const pageIndexes = pdfImage
            ? records.flatMap((_, recordIndex) => recordPages[recordIndex].includes(pdfImage.page) ? [recordIndex] : [])
            : [];
        const candidateIndex = candidateIndexes.length === 1 ? candidateIndexes[0] : null;
        const pageMatches = candidateIndex !== null && pdfImage
            ? recordPages[candidateIndex].length === 1 && recordPages[candidateIndex][0] === pdfImage.page
            : false;

        if (!tag || !pdfImage || !stableImage || candidateIndex === null || !pageMatches) {
            const affected = new Set([...candidateIndexes, ...pageIndexes]);
            if (!affected.size) {
                records.forEach((record, index) => {
                    if (VISUAL_REFERENCE.test(record.body)) affected.add(index);
                });
            }
            affected.forEach((index) => pendingIndexes.add(index));
            continue;
        }

        const imagePath = path.resolve(path.dirname(htmlPath), tag.source);
        const htmlRoot = `${path.resolve(path.dirname(htmlPath))}${path.sep}`;
        if (!imagePath.startsWith(htmlRoot)) {
            pendingIndexes.add(candidateIndex);
            continue;
        }
        const { buffer, checksum, mimeType, extension, dimensions, temporaryPath } = stableImage;
        const image = {
            assetId: deterministicUuid(`asset:question-content:${checksum}`),
            checksum,
            storageKey: assertAssetStorageKey(`questions/${checksum}${extension}`),
            mimeType,
            byteSize: buffer.length,
            width: dimensions.width ?? pdfImage.width,
            height: dimensions.height ?? pdfImage.height,
            temporaryPath,
        };
        imagesByRecord.set(candidateIndex, [...(imagesByRecord.get(candidateIndex) ?? []), image]);
    }

    return { imagesByRecord, pendingIndexes, imageTags: imageTags.length, pdfImages: pdfImageRows.length };
}

function structuredRecord(record) {
    const pendingReasons = [];
    const body = String(record.body ?? "").trim();
    const sourceAnswer = String(record.sourceAnswer ?? "").trim();
    const difficultyCode = strictDifficulty(record.difficulty);
    if (!body) pendingReasons.push("missing-prompt");
    if (!sourceAnswer) pendingReasons.push("missing-answer");
    if (!difficultyCode) pendingReasons.push("unknown-difficulty");

    if (record.type === "單一選擇題") {
        const parsed = parseOptions(body);
        const answerKey = parseAnswerLetters(sourceAnswer)[0];
        const matchingAnswer = parsed?.options.find((option) => option.label === answerKey);
        if (!parsed || parsed.options.length < 2 || !answerKey || !matchingAnswer
            || parsed.options.some((option) => !option.value.replace(/^\([A-H]\)/, "").trim())) {
            pendingReasons.push("choice-parse-failed");
        }
        return {
            kind: "choice",
            questionTypeCode: "single-choice",
            difficultyCode,
            prompt: parsed?.prompt ?? body,
            parts: parsed ? [{
                stableKey: "main",
                prompt: "",
                answerMode: "single_choice",
                gradingPolicy: "automatic",
                options: parsed.options.map((option) => ({ key: option.label, text: option.value })),
                answer: matchingAnswer ? { answerKey } : null,
            }] : [],
            explanation: String(record.explanation ?? "").trim(),
            pendingReasons,
        };
    }

    if (["配合題", "選詞測驗", "題組"].includes(record.type)) {
        const parsed = parseParts(body, sourceAnswer);
        if (!parsed) pendingReasons.push("multi-part-parse-failed");
        const stableKeys = new Set();
        const parts = (parsed?.parts ?? []).map((part, index) => {
            const stableKey = normalizeStableKey(part.id, `part-${index + 1}`);
            if (stableKeys.has(stableKey)) pendingReasons.push("duplicate-part-key");
            stableKeys.add(stableKey);
            const options = part.options.map((text, optionIndex) => ({
                key: String.fromCharCode(65 + optionIndex),
                text,
            }));
            const matchingOptions = options.filter((option) => option.text === part.answer);
            const answer = matchingOptions.length === 1 ? { answerKey: matchingOptions[0].key } : null;
            if (options.length && matchingOptions.length !== 1) {
                pendingReasons.push("multi-part-answer-option-mismatch");
            }
            if (!part.prompt || options.length < 2 || !part.answer) pendingReasons.push("multi-part-incomplete");
            return {
                stableKey,
                prompt: part.prompt,
                answerMode: "single_choice",
                gradingPolicy: "automatic",
                options,
                answer,
            };
        });
        return {
            kind: "multi-choice",
            questionTypeCode: "multi-choice",
            difficultyCode,
            prompt: parsed?.prompt ?? body,
            parts,
            explanation: String(record.explanation ?? "").trim(),
            pendingReasons,
        };
    }

    if (!["寫出國字、注音", "注釋", "改錯題", "填充題"].includes(record.type)) {
        pendingReasons.push("unsupported-question-type");
    }
    const parsedParts = body && sourceAnswer ? parseWrittenParts(body, sourceAnswer) : null;
    const parts = parsedParts?.length
        ? parsedParts.map((part, index) => ({
            stableKey: normalizeStableKey(part.id, `part-${index + 1}`),
            prompt: part.prompt,
            answerMode: "text",
            gradingPolicy: "manual_review",
            options: [],
            answer: part.answer ? { acceptedValue: part.answer } : null,
        }))
        : [{
            stableKey: "main",
            prompt: "",
            answerMode: "text",
            gradingPolicy: "manual_review",
            options: [],
            answer: sourceAnswer ? { acceptedValue: sourceAnswer } : null,
        }];
    if (parts.some((part) => !part.answer)) pendingReasons.push("written-answer-incomplete");
    return {
        kind: "written",
        questionTypeCode: "written",
        difficultyCode,
        prompt: body,
        parts,
        explanation: String(record.explanation ?? "").trim(),
        pendingReasons,
    };
}

function recordFingerprint(record) {
    return sha256Text(stableJson({
        type: record.originalType,
        difficulty: record.originalDifficulty,
        knowledge: record.originalKnowledge,
        sourceOrigin: record.originalSource,
        prompt: record.structured.prompt,
        parts: record.structured.parts,
        explanation: record.structured.explanation,
        images: record.images.map((image) => image.checksum),
    }));
}

async function convertAndParseDocument(sourceDir, fileName, documentIndex, temporaryRoot) {
    const selectedSourcePath = path.join(sourceDir, fileName);
    const documentWork = await mkdtemp(path.join(temporaryRoot, `document-${String(documentIndex).padStart(2, "0")}-`));
    const sourceSnapshot = await snapshotWordDocument(
        selectedSourcePath,
        path.join(documentWork, "source-input.doc"),
        fileName,
    );
    const sourcePath = sourceSnapshot.snapshotPath;
    const validation = await validateWordDocument(sourcePath, fileName);
    if (validation.sha256 !== sourceSnapshot.sha256 || validation.byteSize !== sourceSnapshot.byteSize) {
        throw new HanlinImportError("SOURCE_SNAPSHOT_MISMATCH", `${fileName} 的私有快照與已讀取來源不一致。`, fileName);
    }
    const profile = path.join(documentWork, "profile");
    await configureLockedLibreOfficeProfile(profile, fileName);
    const profileUrl = pathToFileURL(profile).href;
    const commandPrefix = [
        `-env:UserInstallation=${profileUrl}`,
        "--safe-mode",
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--norestore",
    ];
    runTool(TOOLS.soffice, [
        ...commandPrefix,
        "--convert-to",
        "docx:Office Open XML Text",
        "--outdir",
        documentWork,
        sourcePath,
    ], fileName);
    const initialOutputs = await readdir(documentWork);
    const docxName = initialOutputs.find((name) => name.toLowerCase().endsWith(".docx"));
    if (!docxName) {
        throw new HanlinImportError("CONVERSION_OUTPUT_MISSING", `${fileName} 未產生 DOCX。`, fileName);
    }
    const convertedDocxPath = path.join(documentWork, docxName);
    const docxPath = await normalizeSanitizedDocx(convertedDocxPath, documentWork, fileName);
    const sanitized = await validateSanitizedDocx(docxPath, fileName);

    const derivativeProfile = path.join(documentWork, "derivative-profile");
    await configureLockedLibreOfficeProfile(derivativeProfile, fileName);
    const derivativeProfileUrl = pathToFileURL(derivativeProfile).href;
    const derivativeCommandPrefix = [
        `-env:UserInstallation=${derivativeProfileUrl}`,
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--norestore",
    ];
    runTool(TOOLS.soffice, [...derivativeCommandPrefix, "--convert-to", "pdf", "--outdir", documentWork, docxPath], fileName);
    runTool(TOOLS.soffice, [...derivativeCommandPrefix, "--convert-to", "html", "--outdir", documentWork, docxPath], fileName);
    const outputs = await readdir(documentWork);
    const pdfName = outputs.find((name) => name.toLowerCase().endsWith(".pdf"));
    const htmlName = outputs.find((name) => name.toLowerCase().endsWith(".html"));
    if (!pdfName || !htmlName) {
        throw new HanlinImportError("CONVERSION_OUTPUT_MISSING", `${fileName} 的安全 DOCX 未產生 PDF/HTML。`, fileName);
    }
    const pdfPath = path.join(documentWork, pdfName);
    const htmlPath = path.join(documentWork, htmlName);
    await validateSanitizedPdf(pdfPath, fileName);
    const textPath = path.join(documentWork, "pages.txt");
    runTool(TOOLS.pdftotext, ["-layout", pdfPath, textPath], fileName);
    const info = runTool(TOOLS.pdfinfo, [pdfPath], fileName);
    const declaredPages = Number(info.match(/^Pages:\s+(\d+)$/m)?.[1] ?? 0);
    const pages = (await readFile(textPath, "utf8")).split("\f").filter((page) => page.trim());
    if (!declaredPages || pages.length !== declaredPages) {
        throw new HanlinImportError("PAGE_COUNT_MISMATCH", `${fileName} 的 PDF 頁數與文字頁面不一致。`, fileName);
    }
    const sanitizedText = runTool(TOOLS.textutil, ["-convert", "txt", "-stdout", docxPath], fileName, {
        maxBuffer: 64 * 1024 * 1024,
    });
    const records = parseMetadataLast(
        cleanText(stripLegacyWordSequenceFieldPrefixes(normalizeSanitizedSectionHeaders(sanitizedText))),
        HANLIN_CHINESE_TYPES,
        fileName,
    );
    if (!records.length) throw new HanlinImportError("NO_QUESTIONS", `${fileName} 找不到可辨識題目。`, fileName);
    const recordPages = mapQuestionPages(records, pages);
    const html = await readFile(htmlPath, "utf8");
    const pdfImageRows = parsePdfImageRows(runTool(TOOLS.pdfimages, ["-list", pdfPath], fileName));
    const stableImages = await extractStableEmbeddedImages(
        path.join(documentWork, "normalized-docx"),
        documentWork,
        fileName,
    );
    const imageAnalysis = await extractImages({ html, htmlPath, pdfImageRows, stableImages, records, recordPages });
    const originalTitle = path.basename(fileName, path.extname(fileName));
    const sourceDocumentId = deterministicUuid(`source-document:sanitized-docx:${SANITIZER_VERSION}:${validation.sha256}`);

    const parsedRecords = records.map((record, recordIndex) => {
        const structured = structuredRecord(record);
        const pendingReasons = [...structured.pendingReasons];
        if (recordPages[recordIndex].length !== 1) pendingReasons.push("source-page-not-unique");
        if (VISUAL_REFERENCE.test(record.body) && !(imageAnalysis.imagesByRecord.get(recordIndex)?.length)) {
            pendingReasons.push("visual-reference-without-image");
        }
        if (imageAnalysis.pendingIndexes.has(recordIndex)) pendingReasons.push("image-mapping-unverified");
        const number = normalizeQuestionNumber(record.number);
        if (!number || number.length > 120) pendingReasons.push("invalid-question-number");
        const item = {
            documentIndex,
            recordIndex,
            sourceDocumentId,
            sourcePage: recordPages[recordIndex].length === 1 ? recordPages[recordIndex][0] : null,
            sourceQuestionNumber: String(record.number ?? "").trim(),
            normalizedQuestionNumber: number,
            originalType: record.type,
            originalDifficulty: String(record.difficulty ?? "").trim(),
            originalKnowledge: String(record.knowledge ?? "").trim(),
            originalSource: String(record.origin ?? "").trim(),
            originalUnit: String(record.unit ?? "").trim() || originalTitle,
            structured,
            images: imageAnalysis.imagesByRecord.get(recordIndex) ?? [],
            pendingReasons: [...new Set(pendingReasons)],
        };
        return { ...item, contentFingerprint: recordFingerprint(item) };
    });

    return {
        documentIndex,
        fileName,
        relativePath: fileName.normalize("NFC"),
        originalTitle,
        sourcePath,
        originalSha256: validation.sha256,
        originalByteSize: validation.byteSize,
        originalMimeType: validation.mimeType,
        originalStorageKey: assertAssetStorageKey(`quarantine/source-documents/${validation.sha256}.doc`),
        originalAssetId: deterministicUuid(`asset:quarantine-source-document:${validation.sha256}`),
        originalMacroMarkers: validation.macroMarkers,
        sanitizedSha256: sanitized.sha256,
        sanitizedByteSize: sanitized.byteSize,
        sanitizedMimeType: sanitized.mimeType,
        sanitizedPath: docxPath,
        storageKey: assertAssetStorageKey(`sanitized-source-documents/${validation.sha256}.docx`),
        assetId: deterministicUuid(`asset:sanitized-source-document:${SANITIZER_VERSION}:${validation.sha256}`),
        sourceDocumentId,
        sanitization: {
            tool: "LibreOffice",
            version: SANITIZER_VERSION,
            policy: "fresh-profile;safe-mode;macro-security-level=3;headless;docx-macro-denylist;deterministic-zip;pdf-active-content-denylist",
            originalScanStatus: validation.macroMarkers.length ? "rejected" : "quarantined",
        },
        pageCount: declaredPages,
        htmlImageCount: imageAnalysis.imageTags,
        pdfImageCount: imageAnalysis.pdfImages,
        records: parsedRecords,
    };
}

function addCrossDocumentDuplicateState(documents) {
    const allRecords = documents.flatMap((document) => document.records.map((record) => ({ document, record })));
    const byDocumentNumber = new Map();
    for (const entry of allRecords) {
        const key = entry.record.normalizedQuestionNumber;
        if (!key) continue;
        const scopedKey = `${entry.document.originalSha256}:${key}`;
        byDocumentNumber.set(scopedKey, [...(byDocumentNumber.get(scopedKey) ?? []), entry]);
    }
    for (const entries of byDocumentNumber.values()) {
        if (entries.length > 1) {
            entries.forEach(({ record }) => record.pendingReasons.push("duplicate-question-number-in-document"));
        }
    }

    const byFingerprint = new Map();
    for (const entry of allRecords) {
        byFingerprint.set(entry.record.contentFingerprint, [
            ...(byFingerprint.get(entry.record.contentFingerprint) ?? []),
            entry,
        ]);
    }

    let duplicatesSkipped = 0;
    const groups = [];
    for (const entries of byFingerprint.values()) {
        entries.sort((first, second) => first.document.documentIndex - second.document.documentIndex
            || first.record.recordIndex - second.record.recordIndex);
        const documentIds = new Set(entries.map(({ document }) => document.sourceDocumentId));
        const canDedupeAcrossDocuments = entries.length > 1 && documentIds.size === entries.length;
        const grouped = canDedupeAcrossDocuments ? [entries] : entries.map((entry) => [entry]);
        if (canDedupeAcrossDocuments) duplicatesSkipped += entries.length - 1;
        for (const occurrences of grouped) {
            const canonical = occurrences[0];
            groups.push({
                number: canonical.record.normalizedQuestionNumber,
                identityKey: `${canonical.document.originalSha256}:${canonical.record.normalizedQuestionNumber || `record-${canonical.record.recordIndex}`}`,
                entries: occurrences,
            });
        }
    }
    return { groups, duplicatesSkipped };
}

function buildSummary(plan, failed = []) {
    const records = plan.documents.flatMap((document) => document.records);
    const pending = records.filter((record) => record.pendingReasons.length);
    const byType = Object.fromEntries(HANLIN_CHINESE_TYPES.map((type) => [type, records.filter((record) => record.originalType === type).length]));
    const byFile = Object.fromEntries(plan.documents.map((document) => [document.fileName, {
        parsed: document.records.length,
        publishable: document.records.filter((record) => !record.pendingReasons.length).length,
        pendingReview: document.records.filter((record) => record.pendingReasons.length).length,
        pages: document.pageCount,
        images: document.pdfImageCount,
    }]));
    const uniquePublishable = plan.questionGroups.filter((group) => group.publishable).length;
    const publishableGroups = plan.questionGroups.filter((group) => group.publishable);
    const pendingReasons = {};
    for (const record of records) {
        for (const reason of new Set(record.pendingReasons)) {
            pendingReasons[reason] = (pendingReasons[reason] ?? 0) + 1;
        }
    }
    const gradingPolicyParts = {};
    for (const group of publishableGroups) {
        for (const part of group.canonical.record.structured.parts) {
            gradingPolicyParts[part.gradingPolicy] = (gradingPolicyParts[part.gradingPolicy] ?? 0) + 1;
        }
    }
    const automaticPublished = publishableGroups.filter((group) =>
        group.canonical.record.structured.parts.every((part) => part.gradingPolicy === "automatic")).length;
    const manualReviewPublished = publishableGroups.filter((group) =>
        group.canonical.record.structured.parts.some((part) => part.gradingPolicy === "manual_review")).length;
    const sourceAssetCount = plan.documents.length;
    const questionAssets = new Set(records.flatMap((record) => record.images.map((image) => image.checksum))).size;
    return {
        sourceFiles: plan.documents.length,
        parsed: records.length,
        published: uniquePublishable,
        pendingReview: pending.length,
        duplicatesSkipped: plan.duplicatesSkipped,
        failed: failed.length,
        failedFiles: failed,
        byType,
        byFile,
        pendingReasons,
        automaticPublished,
        manualReviewPublished,
        gradingPolicyParts,
        pageMapping: {
            total: records.length,
            unique: records.filter((record) => record.sourcePage !== null).length,
            ambiguous: records.filter((record) => record.sourcePage === null).length,
        },
        assetCounts: { sourceDocuments: sourceAssetCount, questionContent: questionAssets },
        batchId: plan.batchId,
        sourceDocumentIds: plan.documents.map((document) => document.sourceDocumentId),
    };
}

async function resolveSourceSelection(sourceInput, allowDirectory) {
    const sourceMetadata = await lstat(sourceInput).catch(() => null);
    if (!sourceMetadata) {
        throw new HanlinImportError("SOURCE_PATH_MISSING", "指定題庫來源不存在或不可讀。");
    }
    if (sourceMetadata.isSymbolicLink()) {
        throw new HanlinImportError("SOURCE_PATH_SYMLINK", "題庫來源不可使用符號連結。");
    }
    if (sourceMetadata.isFile()) {
        const fileName = path.basename(sourceInput);
        if (path.extname(fileName).toLowerCase() !== ".doc") {
            throw new HanlinImportError("INVALID_SOURCE_FILE", "指定來源檔案必須是頂層 .doc 檔案。", fileName);
        }
        return { sourceDirectory: path.dirname(sourceInput), fileNames: [fileName], sourceKind: "file" };
    }
    if (!sourceMetadata.isDirectory()) {
        throw new HanlinImportError("INVALID_SOURCE_PATH", "題庫來源必須是單一 .doc 檔案或資料夾。");
    }
    if (!allowDirectory) {
        throw new HanlinImportError(
            "WRITE_SCOPE_REQUIRES_SINGLE_FILE",
            "正式匯入必須明確指定單一 .doc 檔案；資料夾只能用於 dry-run 盤點。",
        );
    }
    const entries = await readdir(sourceInput, { withFileTypes: true });
    const fileNames = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".doc"))
        .map((entry) => entry.name)
        .sort((first, second) => first.localeCompare(second, "zh-Hant"));
    if (!fileNames.length) throw new HanlinImportError("NO_SOURCE_FILES", "指定目錄沒有頂層 .doc 題庫檔案。");
    return { sourceDirectory: sourceInput, fileNames, sourceKind: "directory" };
}

/**
 * 解析明確指定的單一 `.doc`，或盤點資料夾內所有頂層 `.doc`。
 * 只在系統暫存目錄建立轉檔中間產物；呼叫端完成後必須呼叫 cleanup。
 */
export async function prepareHanlinChineseImport(sourceInput, { allowDirectory = true } = {}) {
    const { sourceDirectory, fileNames, sourceKind } = await resolveSourceSelection(sourceInput, allowDirectory);

    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lerniqa-hanlin-import-"));
    try {
        const documents = [];
        for (const [index, fileName] of fileNames.entries()) {
            documents.push(await convertAndParseDocument(sourceDirectory, fileName, index, temporaryRoot));
        }
        const duplicateState = addCrossDocumentDuplicateState(documents);
        let globalOrder = 0;
        for (const document of documents) {
            for (const record of document.records) {
                record.sourceOrder = globalOrder;
                globalOrder += 1;
            }
        }
        const manifest = documents.map((document) => ({
            relativePath: document.relativePath,
            originalSha256: document.originalSha256,
        }));
        const sourceSetHash = sha256Text(stableJson(manifest));
        const idempotencyKey = `${PARSER_VERSION}:${TARGET_CLASSIFICATION.key}:${sourceSetHash}`;
        const batchId = deterministicUuid(`import-batch:${idempotencyKey}`);
        const questionGroups = duplicateState.groups.map((group) => {
            const conflict = group.entries.some(({ record }) => record.pendingReasons.length);
            const fingerprints = new Set(group.entries.map(({ record }) => record.contentFingerprint));
            const publishable = Boolean(group.number) && !conflict && fingerprints.size === 1;
            const publisherIdentifier = `${group.entries[0].document.originalSha256.slice(0, 16)}:${group.number}`;
            return {
                number: group.number,
                identityKey: group.identityKey,
                publishable,
                contentFingerprint: group.entries[0].record.contentFingerprint,
                publisherIdentifier: publisherIdentifier.length <= 120
                    ? publisherIdentifier
                    : `${group.entries[0].document.originalSha256.slice(0, 16)}:${sha256Text(group.number)}`,
                canonical: group.entries[0],
                occurrences: group.entries,
                questionId: group.number ? deterministicUuid(`question:hanlin:${group.identityKey}`) : null,
                revisionId: group.number ? deterministicUuid(`revision:${batchId}:${group.identityKey}:${group.entries[0].record.contentFingerprint}`) : null,
            };
        });
        const plan = {
            parserVersion: PARSER_VERSION,
            target: TARGET_CLASSIFICATION,
            sourceKind,
            ids: { ...LOCAL_PRACTICE_IDS, ...LOCAL_CATALOG_IDS },
            idempotencyKey,
            batchId,
            sourceSetHash,
            documents,
            questionGroups,
            duplicatesSkipped: duplicateState.duplicatesSkipped,
        };
        return {
            plan,
            summary: buildSummary(plan),
            cleanup: () => rm(temporaryRoot, { recursive: true, force: true }),
        };
    }
    catch (error) {
        await rm(temporaryRoot, { recursive: true, force: true });
        throw error;
    }
}

async function copyVerified(sourcePath, destinationPath, expectedChecksum) {
    await mkdir(path.dirname(destinationPath), { recursive: true });
    try {
        await copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL);
    }
    catch (error) {
        if (error?.code !== "EEXIST") throw error;
    }
    const checksum = sha256Buffer(await readFile(destinationPath));
    if (checksum !== expectedChecksum) {
        throw new HanlinImportError("ASSET_CHECKSUM_MISMATCH", `本機資產 ${path.basename(destinationPath)} 雜湊不符。`);
    }
}

/** 把已驗證來源與圖片寫到本機資產目錄；storage_key 永遠維持相對路徑。 */
export async function materializeHanlinAssets(plan, assetRoot) {
    const resolvedRoot = path.resolve(assetRoot);
    const written = new Set();
    for (const document of plan.documents) {
        assertAssetStorageKey(document.storageKey);
        const sourceDestination = path.resolve(resolvedRoot, ...document.storageKey.split("/"));
        if (!sourceDestination.startsWith(`${resolvedRoot}${path.sep}`)) {
            throw new HanlinImportError("INVALID_STORAGE_KEY", "來源資產 storage_key 超出本機資產根目錄。");
        }
        await copyVerified(document.sanitizedPath, sourceDestination, document.sanitizedSha256);
        written.add(document.storageKey);
        assertAssetStorageKey(document.originalStorageKey);
        const quarantineDestination = path.resolve(resolvedRoot, ...document.originalStorageKey.split("/"));
        if (!quarantineDestination.startsWith(`${resolvedRoot}${path.sep}`)) {
            throw new HanlinImportError("INVALID_STORAGE_KEY", "隔離資產 storage_key 超出本機資產根目錄。");
        }
        await copyVerified(document.sourcePath, quarantineDestination, document.originalSha256);
        written.add(document.originalStorageKey);
        for (const record of document.records) {
            for (const image of record.images) {
                if (written.has(image.storageKey)) continue;
                assertAssetStorageKey(image.storageKey);
                const imageDestination = path.resolve(resolvedRoot, ...image.storageKey.split("/"));
                if (!imageDestination.startsWith(`${resolvedRoot}${path.sep}`)) {
                    throw new HanlinImportError("INVALID_STORAGE_KEY", "題目資產 storage_key 超出本機資產根目錄。");
                }
                await copyVerified(image.temporaryPath, imageDestination, image.checksum);
                written.add(image.storageKey);
            }
        }
    }
    return [...written];
}

function expectedAssetChecksums(plan) {
    const values = new Map();
    for (const document of plan.documents) {
        values.set(document.originalStorageKey, document.originalSha256);
        values.set(document.storageKey, document.sanitizedSha256);
        for (const record of document.records) {
            for (const image of record.images) values.set(image.storageKey, image.checksum);
        }
    }
    return values;
}

/**
 * 將同一檔案系統內的 staging 檔以 hard-link 排他方式提升到正式位置。
 * 已存在的檔案只驗證 checksum，不會覆寫；回傳值只列出本次新建檔案。
 */
export async function promoteHanlinAssets(plan, stagingRoot, assetRoot, storageKeys) {
    const resolvedStaging = path.resolve(stagingRoot);
    const resolvedAssetRoot = path.resolve(assetRoot);
    const checksums = expectedAssetChecksums(plan);
    const createdStorageKeys = [];
    try {
        for (const storageKey of storageKeys) {
            assertAssetStorageKey(storageKey);
            const expectedChecksum = checksums.get(storageKey);
            if (!expectedChecksum) throw new HanlinImportError("UNKNOWN_STAGED_ASSET", "staging 出現未知資產。");
            const stagedPath = path.resolve(resolvedStaging, ...storageKey.split("/"));
            const finalPath = path.resolve(resolvedAssetRoot, ...storageKey.split("/"));
            if (!stagedPath.startsWith(`${resolvedStaging}${path.sep}`)
                || !finalPath.startsWith(`${resolvedAssetRoot}${path.sep}`)) {
                throw new HanlinImportError("INVALID_STORAGE_KEY", "資產路徑超出 staging 或正式根目錄。");
            }
            const existing = await readFile(finalPath).catch((error) => {
                if (error?.code === "ENOENT") return null;
                throw error;
            });
            if (existing) {
                if (sha256Buffer(existing) !== expectedChecksum) {
                    throw new HanlinImportError("ASSET_CHECKSUM_MISMATCH", `已存在資產 ${path.basename(finalPath)} 雜湊不符。`);
                }
                continue;
            }
            await mkdir(path.dirname(finalPath), { recursive: true });
            try {
                await link(stagedPath, finalPath);
            }
            catch (error) {
                if (error?.code === "EEXIST") {
                    const raced = await readFile(finalPath);
                    if (sha256Buffer(raced) !== expectedChecksum) throw error;
                    continue;
                }
                if (error?.code !== "EXDEV") throw error;
                await copyFile(stagedPath, finalPath, fsConstants.COPYFILE_EXCL);
            }
            createdStorageKeys.push(storageKey);
            await unlink(stagedPath).catch((error) => {
                if (error?.code !== "ENOENT") throw error;
            });
        }
        return { createdStorageKeys };
    }
    catch (error) {
        await rollbackHanlinAssets(assetRoot, createdStorageKeys);
        throw error;
    }
}

/** 僅刪除本次 promote 新建的確切檔案，不觸碰既有資產。 */
export async function rollbackHanlinAssets(assetRoot, createdStorageKeys) {
    const resolvedAssetRoot = path.resolve(assetRoot);
    for (const storageKey of [...createdStorageKeys].reverse()) {
        assertAssetStorageKey(storageKey);
        const finalPath = path.resolve(resolvedAssetRoot, ...storageKey.split("/"));
        if (!finalPath.startsWith(`${resolvedAssetRoot}${path.sep}`)) continue;
        await unlink(finalPath).catch((error) => {
            if (error?.code !== "ENOENT") throw error;
        });
    }
}

export async function cleanupHanlinAssetStaging(stagingRoot) {
    await rm(stagingRoot, { recursive: true, force: true });
}

export function safeFailureSummary(error) {
    return {
        sourceFiles: 0,
        parsed: 0,
        published: 0,
        pendingReview: 0,
        duplicatesSkipped: 0,
        failed: 1,
        failedFiles: [{
            fileName: error instanceof HanlinImportError ? error.fileName : null,
            code: error instanceof HanlinImportError ? error.code : "IMPORT_FAILED",
            message: error instanceof Error ? error.message : "匯入失敗。",
        }],
        byType: {},
        byFile: {},
        pendingReasons: {},
        automaticPublished: 0,
        manualReviewPublished: 0,
        gradingPolicyParts: {},
        pageMapping: { total: 0, unique: 0, ambiguous: 0 },
        assetCounts: { sourceDocuments: 0, questionContent: 0 },
        batchId: null,
        sourceDocumentIds: [],
    };
}
