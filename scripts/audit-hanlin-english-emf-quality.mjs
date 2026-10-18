#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "pg";

import {
    HANLIN_ENGLISH_APPROVED_EMF_IMAGE_MAPPINGS,
    trimNearWhitePng,
} from "./lib/hanlin-chinese-import.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGLISH_ROOT = "/Users/chianlin/Library/CloudStorage/GoogleDrive-jean@minmax.biz/我的雲端硬碟/個人/題庫資料/國中/國中英語/題本檔案/01_第一冊";
const LOCAL_SOCKET = path.join(REPOSITORY_ROOT, "local-data", "postgres-socket");
const REPORT_PATH = path.join(REPOSITORY_ROOT, "reports", "hanlin-english-emf-quality.json");
const PREVIEW_ROOT = path.join(REPOSITORY_ROOT, ".audit", "hanlin-english-emf-previews");
const RASTER_DPI = 300;

function sha256(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
}

function run(command, args, label, options = {}) {
    const result = spawnSync(command, args, {
        encoding: options.encoding ?? "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 900_000,
        cwd: options.cwd,
        stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0) {
        throw new Error(`${label} failed with ${result.status ?? result.error?.code ?? "unknown"}: ${result.stderr?.trim() ?? ""}`);
    }
    return result.stdout;
}

function attribute(fragment, name) {
    return fragment.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1] ?? null;
}

function htmlImages(html, htmlPath) {
    return [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)].map((match) => {
        const source = decodeURIComponent(match[1]);
        const absolutePath = path.resolve(path.dirname(htmlPath), source);
        return {
            name: attribute(match[0], "name"),
            source,
            absolutePath,
        };
    });
}

export function emfDrawings(documentXml, relationshipsXml) {
    const relationships = new Map([...relationshipsXml.matchAll(/<Relationship\b[^>]*\/>/g)].map((match) => [
        attribute(match[0], "Id"),
        { target: attribute(match[0], "Target"), type: attribute(match[0], "Type") },
    ]));
    const drawings = [];
    const fragments = documentXml.match(/<wp:(?:inline|anchor)\b[\s\S]*?<\/wp:(?:inline|anchor)>/g) ?? [];
    for (const fragment of fragments) {
        const name = attribute(fragment.match(/<wp:docPr\b[^>]*>/)?.[0] ?? "", "name");
        const relationshipId = attribute(fragment.match(/<a:blip\b[^>]*>/)?.[0] ?? "", "r:embed");
        const relationship = relationships.get(relationshipId);
        if (!name || !relationship?.type?.endsWith("/image") || !relationship.target?.toLowerCase().endsWith(".emf")) continue;
        drawings.push({ name, relationshipId, target: relationship.target });
    }
    const objectFragments = documentXml.match(/<w:object\b[\s\S]*?<\/w:object>/g) ?? [];
    objectFragments.forEach((fragment, index) => {
        const relationshipId = attribute(fragment.match(/<v:imagedata\b[^>]*>/)?.[0] ?? "", "r:id");
        const relationship = relationships.get(relationshipId);
        if (!relationship?.type?.endsWith("/image") || !relationship.target?.toLowerCase().endsWith(".emf")) return;
        drawings.push({ name: `Object${index + 1}`, relationshipId, target: relationship.target });
    });
    return drawings;
}

export function pairGifCandidate(candidate, images, drawings) {
    const matchingImages = images.filter((image) => image.checksum === candidate.derivedChecksum);
    if (matchingImages.length !== 1) {
        return { status: "inconclusive", reason: `derived-checksum-matches:${matchingImages.length}` };
    }
    const image = matchingImages[0];
    const matchingDrawings = drawings.filter((drawing) => drawing.name === image.name);
    if (matchingDrawings.length !== 1) {
        return { status: "inconclusive", reason: `emf-name-matches:${matchingDrawings.length}`, image };
    }
    return { status: "paired", image, drawing: matchingDrawings[0] };
}

async function sourceDocumentsBySha() {
    const result = new Map();
    async function walk(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) await walk(entryPath);
            else if (entry.isFile() && entry.name.endsWith(".doc") && !entry.name.startsWith("~$")) {
                const buffer = await readFile(entryPath);
                result.set(sha256(buffer), entryPath);
            }
        }
    }
    await walk(ENGLISH_ROOT);
    return result;
}

async function candidates(client) {
    const result = await client.query(`
        SELECT item.source_question_number AS question_number,
               question.id AS question_id,
               item.draft_payload->>'originalSha256' AS source_sha256,
               item.draft_payload->>'relativeFileName' AS file_name,
               asset.checksum AS derived_checksum,
               asset.width AS derived_width,
               asset.height AS derived_height,
               asset.byte_size AS derived_bytes,
               block.position
          FROM questions AS question
          JOIN question_revisions AS revision ON revision.id = question.current_revision_id
          JOIN subjects AS subject ON subject.id = revision.subject_id
          JOIN question_content_blocks AS block ON block.question_revision_id = revision.id
          JOIN assets AS asset ON asset.id = block.asset_id
          LEFT JOIN LATERAL (
              SELECT source_question_number, draft_payload
                FROM import_items
               WHERE question_revision_id = revision.id
               ORDER BY reviewed_at DESC NULLS LAST, source_order
               LIMIT 1
          ) AS item ON true
         WHERE question.status = 'published'
           AND revision.status = 'published'
           AND subject.name = '英文'
           AND asset.mime_type = 'image/gif'
         ORDER BY item.source_question_number, block.position
    `);
    return result.rows.map((row) => ({
        questionNumber: row.question_number,
        questionId: row.question_id,
        sourceSha256: row.source_sha256,
        fileName: row.file_name,
        derivedChecksum: row.derived_checksum,
        derivedDimensions: { width: row.derived_width, height: row.derived_height },
        derivedBytes: Number(row.derived_bytes),
        position: row.position,
    }));
}

function approvedQualityCandidates() {
    return Object.entries(HANLIN_ENGLISH_APPROVED_EMF_IMAGE_MAPPINGS).flatMap(([sourceSha256, mappings]) =>
        mappings.filter((mapping) => mapping.renderedChecksum).map((mapping, index) => ({
            questionNumber: mapping.questionNumber,
            questionId: null,
            sourceSha256,
            fileName: null,
            derivedChecksum: mapping.replacesDerivedChecksum,
            derivedDimensions: null,
            derivedBytes: null,
            position: index,
            expectedRawChecksum: mapping.rawChecksum,
            expectedRenderedChecksum: mapping.renderedChecksum,
        })));
}

async function convertSource(sourcePath, root) {
    const sourceCopy = path.join(root, "source.doc");
    await copyFile(sourcePath, sourceCopy);
    const docxProfile = path.join(root, "docx-profile");
    const htmlProfile = path.join(root, "html-profile");
    await mkdir(docxProfile);
    await mkdir(htmlProfile);
    const common = ["--headless", "--nologo", "--nodefault", "--nolockcheck", "--norestore"];
    run("soffice", [`-env:UserInstallation=${pathToFileURL(docxProfile).href}`, ...common, "--convert-to", "docx:Office Open XML Text", "--outdir", root, sourceCopy], "DOCX conversion");
    const docxPath = path.join(root, "source.docx");
    run("soffice", [`-env:UserInstallation=${pathToFileURL(htmlProfile).href}`, ...common, "--convert-to", "html", "--outdir", root, docxPath], "HTML conversion");
    const unpacked = path.join(root, "unpacked");
    await mkdir(unpacked);
    run("unzip", ["-q", docxPath, "-d", unpacked], "DOCX extraction");
    return { docxPath, htmlPath: path.join(root, "source.html"), unpacked };
}

async function renderEmf(emfPath, outputRoot, label) {
    await mkdir(outputRoot, { recursive: true });
    const sourcePath = path.join(outputRoot, "source.emf");
    await copyFile(emfPath, sourcePath);
    const profile = path.join(outputRoot, "profile");
    await mkdir(profile);
    run("soffice", [`-env:UserInstallation=${pathToFileURL(profile).href}`, "--headless", "--nologo", "--nodefault", "--nolockcheck", "--norestore", "--convert-to", "pdf", "--outdir", outputRoot, sourcePath], `${label} PDF conversion`);
    const rasterPrefix = path.join(outputRoot, "raster");
    run("pdftoppm", ["-png", "-r", String(RASTER_DPI), "-singlefile", path.join(outputRoot, "source.pdf"), rasterPrefix], `${label} rasterization`);
    const trimmed = await trimNearWhitePng(await readFile(`${rasterPrefix}.png`));
    const checksum = sha256(trimmed.buffer);
    const previewPath = path.join(PREVIEW_ROOT, `${label}-${checksum}.png`);
    await writeFile(previewPath, trimmed.buffer);
    return {
        checksum,
        dimensions: { width: trimmed.width, height: trimmed.height },
        bytes: trimmed.buffer.length,
        previewPath: path.relative(REPOSITORY_ROOT, previewPath),
    };
}

async function inspectDocument(sourceSha256, sourcePath, sourceCandidates, temporaryRoot) {
    const work = await mkdtemp(path.join(temporaryRoot, "document-"));
    const converted = await convertSource(sourcePath, work);
    const htmlPath = converted.htmlPath;
    const images = await Promise.all(htmlImages(await readFile(htmlPath, "utf8"), htmlPath).map(async (image) => ({
        ...image,
        checksum: sha256(await readFile(image.absolutePath)),
    })));
    const drawings = emfDrawings(
        await readFile(path.join(converted.unpacked, "word", "document.xml"), "utf8"),
        await readFile(path.join(converted.unpacked, "word", "_rels", "document.xml.rels"), "utf8"),
    );
    const results = [];
    for (const candidate of sourceCandidates) {
        const pairing = pairGifCandidate(candidate, images, drawings);
        if (pairing.status !== "paired") {
            results.push({ ...candidate, ...pairing });
            continue;
        }
        const emfPath = path.resolve(converted.unpacked, "word", pairing.drawing.target);
        const rawBuffer = await readFile(emfPath);
        const rawChecksum = sha256(rawBuffer);
        const rendered = await renderEmf(
            emfPath,
            path.join(work, "renders", `${candidate.questionNumber}-${candidate.position}`),
            `${candidate.questionNumber}-${candidate.position}`,
        );
        if (candidate.expectedRawChecksum && rawChecksum !== candidate.expectedRawChecksum) {
            results.push({ ...candidate, status: "inconclusive", reason: "raw-checksum-mismatch", rawChecksum, rendered });
            continue;
        }
        if (candidate.expectedRenderedChecksum && rendered.checksum !== candidate.expectedRenderedChecksum) {
            results.push({ ...candidate, status: "inconclusive", reason: "rendered-checksum-mismatch", rawChecksum, rendered });
            continue;
        }
        results.push({
            ...candidate,
            status: "paired",
            imageName: pairing.image.name,
            rawChecksum,
            rendered,
        });
    }
    return { sourceSha256, sourcePath, candidates: results };
}

async function main() {
    if (!existsSync(LOCAL_SOCKET)) throw new Error(`Local PostgreSQL socket not found: ${LOCAL_SOCKET}`);
    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await rm(PREVIEW_ROOT, { recursive: true, force: true });
    await mkdir(PREVIEW_ROOT, { recursive: true });
    const client = new Client({ host: LOCAL_SOCKET, port: 55432, database: "lerniqa_local", user: process.env.USER });
    await client.connect();
    const currentGifCandidates = await candidates(client);
    await client.end();
    const approvedCandidates = approvedQualityCandidates();
    const allCandidates = approvedCandidates;
    const sources = await sourceDocumentsBySha();
    const grouped = Map.groupBy(allCandidates, (candidate) => candidate.sourceSha256);
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lerniqa-emf-quality-"));
    try {
        const documents = [];
        for (const [sourceSha256, sourceCandidates] of grouped) {
            const sourcePath = sources.get(sourceSha256);
            if (!sourcePath) {
                documents.push({ sourceSha256, sourcePath: null, candidates: sourceCandidates.map((candidate) => ({ ...candidate, status: "inconclusive", reason: "source-not-found" })) });
                continue;
            }
            documents.push(await inspectDocument(sourceSha256, sourcePath, sourceCandidates, temporaryRoot));
        }
        const flat = documents.flatMap((document) => document.candidates);
        const report = {
            rasterDpi: RASTER_DPI,
            currentGifCandidates: currentGifCandidates.length,
            approvedQualityContracts: approvedCandidates.length,
            auditedContracts: flat.length,
            paired: flat.filter((candidate) => candidate.status === "paired").length,
            inconclusive: flat.filter((candidate) => candidate.status !== "paired").length,
            documents,
        };
        await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
        console.log(JSON.stringify({
            reportPath: REPORT_PATH,
            currentGifCandidates: report.currentGifCandidates,
            approvedQualityContracts: report.approvedQualityContracts,
            paired: report.paired,
            inconclusive: report.inconclusive,
        }, null, 2));
        if (report.inconclusive) process.exitCode = 1;
    }
    finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
