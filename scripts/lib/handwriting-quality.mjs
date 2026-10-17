import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
    compactErrorCode,
    HANDWRITING_MAX_ASSET_BYTES,
    inspectHandwritingModel,
    sanitizeModelText,
    transcribeHandwriting,
    unloadHandwritingModel,
} from "../../app/lib/handwriting-analysis.mjs";

export const QUALITY_MANIFEST_VERSION = "lerniqa.handwriting-quality-fixtures/v2";
export const QUALITY_FIXTURE_ROOT = path.join("tests", "fixtures", "handwriting-ai-synthetic");
const FIXTURE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const IMAGE_NAME = /^[a-z0-9][a-z0-9._-]{0,119}\.png$/u;
const KINDS = Object.freeze(["readable", "unclear", "blank"]);

function fail(code, message, cause = undefined) {
    const error = new Error(message, cause === undefined ? undefined : { cause });
    error.name = "HandwritingQualityError";
    error.code = code;
    throw error;
}

function exactKeys(value, expected, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_QUALITY_MANIFEST", `${label} 必須是物件。`);
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
        fail("INVALID_QUALITY_MANIFEST", `${label} 欄位不符合固定 schema。`);
    }
    return value;
}

function normalize(value) {
    return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-Hant");
}

function assertSyntheticText(value, label, maximumLength) {
    if (typeof value !== "string" || value.trim() === "" || value.length > maximumLength) {
        fail("INVALID_QUALITY_MANIFEST", `${label} 無效。`);
    }
    if (sanitizeModelText(value, maximumLength) !== value.normalize("NFKC").trim()) {
        fail("QUALITY_FIXTURE_PII", `${label} 含疑似個資或控制字元。`);
    }
    return value.normalize("NFKC").trim();
}

export function validateQualityManifest(value) {
    const manifest = exactKeys(value, ["schemaVersion", "qualityGates", "fixtures"], "manifest");
    if (manifest.schemaVersion !== QUALITY_MANIFEST_VERSION || !Array.isArray(manifest.fixtures) || manifest.fixtures.length < 1) {
        fail("INVALID_QUALITY_MANIFEST", "manifest schemaVersion 或 fixtures 無效。 ");
    }
    const gates = exactKeys(
        manifest.qualityGates,
        ["minimumReadableTranscriptionRate", "minimumBlankUnclearUnrecognizedRate", "requireFaultFailClosed"],
        "qualityGates",
    );
    for (const key of ["minimumReadableTranscriptionRate", "minimumBlankUnclearUnrecognizedRate"]) {
        if (typeof gates[key] !== "number" || !Number.isFinite(gates[key]) || gates[key] < 0 || gates[key] > 1) {
            fail("INVALID_QUALITY_MANIFEST", `${key} 必須是 0 到 1。`);
        }
    }
    if (typeof gates.requireFaultFailClosed !== "boolean") {
        fail("INVALID_QUALITY_MANIFEST", "quality gate 數值無效。 ");
    }
    const seen = new Set();
    const fixtures = manifest.fixtures.map((raw, index) => {
        const fixture = exactKeys(raw, [
            "id", "kind", "image", "imageSha256", "expectedTranscription",
        ], `fixtures[${index}]`);
        if (typeof fixture.id !== "string" || !FIXTURE_ID.test(fixture.id) || seen.has(fixture.id)) {
            fail("INVALID_QUALITY_MANIFEST", `fixtures[${index}].id 無效或重複。`);
        }
        seen.add(fixture.id);
        if (!KINDS.includes(fixture.kind) || typeof fixture.image !== "string" || !IMAGE_NAME.test(fixture.image)
            || typeof fixture.imageSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(fixture.imageSha256)) {
            fail("INVALID_QUALITY_MANIFEST", `fixtures[${index}] 的 kind、image 或 checksum 無效。`);
        }
        const expectedTranscription = fixture.expectedTranscription === null
            ? null
            : assertSyntheticText(fixture.expectedTranscription, `fixtures[${index}].expectedTranscription`, 2_000);
        if (fixture.kind === "readable" && expectedTranscription === null) {
            fail("INVALID_QUALITY_MANIFEST", `fixtures[${index}] readable fixture 必須有 expectedTranscription。`);
        }
        return Object.freeze({
            id: fixture.id,
            kind: fixture.kind,
            image: fixture.image,
            imageSha256: fixture.imageSha256,
            expectedTranscription,
        });
    });
    return Object.freeze({ schemaVersion: QUALITY_MANIFEST_VERSION, qualityGates: Object.freeze({ ...gates }), fixtures: Object.freeze(fixtures) });
}

function inside(parent, child) {
    const relative = path.relative(parent, child);
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function resolveSyntheticFixturePaths(repositoryRoot, manifestPath, pngDirectory) {
    const allowedRoot = path.resolve(repositoryRoot, QUALITY_FIXTURE_ROOT);
    const resolvedManifest = path.resolve(repositoryRoot, manifestPath);
    const resolvedPngDirectory = path.resolve(repositoryRoot, pngDirectory);
    if (!inside(allowedRoot, resolvedManifest) || !inside(allowedRoot, resolvedPngDirectory)) {
        fail("UNSAFE_QUALITY_FIXTURE_PATH", `manifest 與 PNG directory 必須位於 ${QUALITY_FIXTURE_ROOT}/。`);
    }
    const [allowedMetadata, manifestMetadata, directoryMetadata] = await Promise.all([
        lstat(allowedRoot), lstat(resolvedManifest), lstat(resolvedPngDirectory),
    ]).catch((cause) => fail("QUALITY_FIXTURE_UNAVAILABLE", "找不到合成 fixture 路徑。", cause));
    if (!allowedMetadata.isDirectory() || allowedMetadata.isSymbolicLink()
        || !manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()
        || !directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
        fail("UNSAFE_QUALITY_FIXTURE_PATH", "合成 fixture 路徑必須是非 symlink 的一般檔案／目錄。 ");
    }
    const [realAllowed, realManifest, realDirectory] = await Promise.all([
        realpath(allowedRoot), realpath(resolvedManifest), realpath(resolvedPngDirectory),
    ]);
    if (!inside(realAllowed, realManifest) || !inside(realAllowed, realDirectory)) {
        fail("UNSAFE_QUALITY_FIXTURE_PATH", "合成 fixture realpath 逸出允許目錄。 ");
    }
    return Object.freeze({ manifest: realManifest, pngDirectory: realDirectory });
}

export async function loadQualityManifest(paths) {
    let parsed;
    try {
        parsed = JSON.parse(await readFile(paths.manifest, "utf8"));
    }
    catch (cause) {
        fail("INVALID_QUALITY_MANIFEST", "無法解析合成 fixture manifest。", cause);
    }
    return validateQualityManifest(parsed);
}

async function readFixtureImage(paths, fixture) {
    const imagePath = path.resolve(paths.pngDirectory, fixture.image);
    if (!inside(paths.pngDirectory, imagePath)) fail("UNSAFE_QUALITY_FIXTURE_PATH", "PNG path 逸出合成 fixture 目錄。 ");
    const metadata = await lstat(imagePath).catch((cause) => fail("QUALITY_FIXTURE_UNAVAILABLE", "找不到合成 PNG。", cause));
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > HANDWRITING_MAX_ASSET_BYTES) {
        fail("INVALID_QUALITY_FIXTURE", "合成 PNG 不是允許大小的一般檔案。 ");
    }
    const bytes = await readFile(imagePath);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== fixture.imageSha256) fail("INVALID_QUALITY_FIXTURE", "合成 PNG checksum 不一致。 ");
    return bytes;
}

export function evaluateQualityRecords(manifest, records) {
    const byId = new Map(records.map((record) => [record.id, record]));
    const readable = manifest.fixtures.filter((fixture) => fixture.kind === "readable");
    const blankUnclear = manifest.fixtures.filter((fixture) => fixture.kind === "blank" || fixture.kind === "unclear");
    const readableMatches = readable.filter((fixture) => {
        const record = byId.get(fixture.id);
        return record?.status === "completed" && normalize(record.transcription) === normalize(fixture.expectedTranscription);
    }).length;
    const blankUnclearUnrecognized = blankUnclear.filter((fixture) => byId.get(fixture.id)?.transcription === null).length;
    const faults = records.filter((record) => record.status === "fault");
    const faultFailClosed = faults.every((record) => record.transcription === null);
    const readableRate = readable.length === 0 ? 0 : readableMatches / readable.length;
    const blankUnclearUnrecognizedRate = blankUnclear.length === 0 ? 0 : blankUnclearUnrecognized / blankUnclear.length;
    const gates = Object.freeze({
        readable_transcription: readable.length > 0 && readableRate >= manifest.qualityGates.minimumReadableTranscriptionRate,
        blank_unclear_unrecognized: blankUnclear.length > 0
            && blankUnclearUnrecognizedRate >= manifest.qualityGates.minimumBlankUnclearUnrecognizedRate,
        fault_fail_closed: !manifest.qualityGates.requireFaultFailClosed || faultFailClosed,
    });
    return Object.freeze({
        schema_version: QUALITY_MANIFEST_VERSION,
        fixtures: manifest.fixtures.length,
        completed: records.filter((record) => record.status === "completed").length,
        faults: faults.length,
        readable_total: readable.length,
        readable_exact: readableMatches,
        readable_transcription_rate: readableRate,
        blank_unclear_total: blankUnclear.length,
        blank_unclear_unrecognized: blankUnclearUnrecognized,
        blank_unclear_unrecognized_rate: blankUnclearUnrecognizedRate,
        fault_fail_closed: faultFailClosed,
        failed_fixture_ids: manifest.fixtures
            .filter((fixture) => {
                const record = byId.get(fixture.id);
                if (fixture.kind === "readable") {
                    return record?.status !== "completed"
                        || normalize(record.transcription) !== normalize(fixture.expectedTranscription);
                }
                return record?.transcription !== null;
            })
            .map((fixture) => fixture.id),
        gates,
        passed: Object.values(gates).every(Boolean),
    });
}

export async function runQualitySuite(manifest, paths, {
    fetchImpl = fetch,
    inspectModel = inspectHandwritingModel,
    transcribe = transcribeHandwriting,
    unloadModel = unloadHandwritingModel,
} = {}) {
    const model = await inspectModel({ fetchImpl });
    const records = [];
    try {
        for (const fixture of manifest.fixtures) {
            try {
                const bytes = await readFixtureImage(paths, fixture);
                const output = await transcribe(bytes, model, { fetchImpl });
                records.push(Object.freeze({
                    id: fixture.id,
                    status: "completed",
                    transcription: output.transcription,
                }));
            }
            catch (error) {
                records.push(Object.freeze({
                    id: fixture.id,
                    status: "fault",
                    transcription: null,
                    errorCode: compactErrorCode(error),
                }));
            }
        }
    }
    finally {
        await unloadModel({ fetchImpl });
    }
    return evaluateQualityRecords(manifest, records);
}
