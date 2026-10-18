#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const inventoryPath = path.join(repositoryRoot, ".audit", "social-table-source-inventory.json");
const outputRoot = path.join(repositoryRoot, "tmp", "pdfs", "social-table-audit");
const manifestPath = path.join(repositoryRoot, ".audit", "social-table-pdf-evidence.json");

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        ...options,
    });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} 失敗\n${result.stderr || result.stdout}`);
    }
    return result.stdout;
}

function safeBaseName(fileName) {
    return path.basename(fileName, path.extname(fileName)).replaceAll(/[\\/:*?"<>|]/gu, "_");
}

const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
await mkdir(outputRoot, { recursive: true });
const evidence = [];
const documents = inventory.documents.filter((document) => document.nativeTables.length > 0);

for (const [documentIndex, document] of documents.entries()) {
    const key = `${document.originalSha256.slice(0, 16)}-${safeBaseName(document.fileName)}`;
    const documentOutput = path.join(outputRoot, key);
    const profile = path.join(documentOutput, "libreoffice-profile");
    await rm(documentOutput, { recursive: true, force: true });
    await mkdir(documentOutput, { recursive: true });
    try {
        run("/opt/homebrew/bin/soffice", [
            "--headless",
            `-env:UserInstallation=${pathToFileURL(profile).href}`,
            "--convert-to",
            "pdf",
            "--outdir",
            documentOutput,
            document.sourcePath,
        ]);
        const pdfPath = path.join(documentOutput, `${path.basename(document.sourcePath, path.extname(document.sourcePath))}.pdf`);
        await readFile(pdfPath);
        const pageCount = Number(run("/opt/homebrew/bin/pdfinfo", [pdfPath])
            .match(/^Pages:\s+(\d+)$/mu)?.[1] ?? 0);
        const pages = [...new Set(document.nativeTables.map((table) => Number(table.sourcePage)).filter(Number.isInteger))]
            .sort((left, right) => left - right);
        const pageEvidence = [];
        for (const page of pages) {
            if (page < 1 || page > pageCount) {
                pageEvidence.push({ page, error: `PDF 共 ${pageCount} 頁` });
                continue;
            }
            const prefix = path.join(documentOutput, `page-${String(page).padStart(3, "0")}`);
            run("/opt/homebrew/bin/pdftoppm", ["-f", String(page), "-l", String(page), "-r", "140", "-png", "-singlefile", pdfPath, prefix]);
            const text = run("/opt/homebrew/bin/pdftotext", ["-f", String(page), "-l", String(page), "-layout", pdfPath, "-"]);
            const textPath = `${prefix}.txt`;
            await writeFile(textPath, text, "utf8");
            pageEvidence.push({ page, imagePath: `${prefix}.png`, textPath });
        }
        evidence.push({
            sourceDocumentId: document.sourceDocumentId,
            fileName: document.fileName,
            originalSha256: document.originalSha256,
            sourcePath: document.sourcePath,
            pdfPath,
            pageCount,
            tables: document.nativeTables,
            pages: pageEvidence,
        });
        process.stdout.write(`[${documentIndex + 1}/${documents.length}] ${document.fileName}: ${pages.length} 頁\n`);
    }
    finally {
        await rm(profile, { recursive: true, force: true });
    }
}

await writeFile(manifestPath, `${JSON.stringify({ documents: evidence }, null, 2)}\n`, "utf8");
process.stdout.write(`${manifestPath}\n`);
