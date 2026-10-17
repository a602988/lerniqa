#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
    AUTHORIZED_HANLIN_LESSON_IMPORTS,
    hasFragmentedMathScript,
    prepareHanlinChineseImport,
} from "./lib/hanlin-chinese-import.mjs";

const SOURCE_FOLDERS = Object.freeze({
    "publisher-test-bank": "01_題庫題目",
    "literacy-question": "07_素養題",
    "mock-comprehensive-written": "08_仿會考非選題",
});

function usage() {
    return "Usage: node scripts/audit-kangxuan-math-scripts.mjs <math-source-root> [--output <json-file>]";
}

function parseArguments(argv) {
    const [sourceRoot, ...rest] = argv;
    if (!sourceRoot || sourceRoot.startsWith("--")) throw new Error(usage());
    let output = null;
    for (let index = 0; index < rest.length; index += 1) {
        if (rest[index] !== "--output" || !rest[index + 1] || rest[index + 1].startsWith("--")) {
            throw new Error(usage());
        }
        output = path.resolve(rest[index + 1]);
        index += 1;
    }
    return { sourceRoot: path.resolve(sourceRoot), output };
}

function scriptSyntaxIssues(text) {
    const issues = [];
    if (hasFragmentedMathScript(text)) issues.push("fragmented-math-script");
    if (/\^(?!\()/u.test(text)) issues.push("bare-caret");
    if (/\^\(\s*\)/u.test(text) || /_\(\s*\)/u.test(text)) issues.push("empty-script");
    let index = 0;
    while (index < text.length) {
        const marker = text.slice(index).search(/[\^_]\(/u);
        if (marker < 0) break;
        const start = index + marker + 1;
        let depth = 0;
        let closed = false;
        for (let cursor = start; cursor < text.length; cursor += 1) {
            if (text[cursor] === "(") depth += 1;
            else if (text[cursor] === ")") {
                depth -= 1;
                if (depth === 0) {
                    index = cursor + 1;
                    closed = true;
                    break;
                }
            }
        }
        if (!closed) {
            issues.push("unclosed-script");
            break;
        }
    }
    return [...new Set(issues)];
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const entries = AUTHORIZED_HANLIN_LESSON_IMPORTS.filter((entry) =>
        entry.target.publisherCode === "kangxuan" && entry.target.subjectCode === "math");
    const reportEntries = [];
    const pendingEntries = [];
    const sources = [];

    for (const authorizedLesson of entries) {
        const folder = SOURCE_FOLDERS[authorizedLesson.target.sourceCategoryCode];
        if (!folder) throw new Error(`Unknown math source category: ${authorizedLesson.target.sourceCategoryCode}`);
        const sourcePath = path.join(options.sourceRoot, folder, "第一冊", authorizedLesson.fileName);
        const prepared = await prepareHanlinChineseImport(sourcePath, {
            allowDirectory: false,
            authorizedLesson,
        });
        try {
            const document = prepared.plan.documents[0];
            sources.push({
                fileName: authorizedLesson.fileName,
                folder,
                originalSha256: document.originalSha256,
                parserVersion: authorizedLesson.parserVersion,
                parsed: document.records.length,
                publishable: document.records.filter((record) => !record.pendingReasons.length).length,
                pendingReview: document.records.filter((record) => record.pendingReasons.length).length,
            });
            for (const record of document.records) {
                const serialized = JSON.stringify(record.structured);
                if (record.pendingReasons.length) {
                    pendingEntries.push({
                        questionNumber: record.sourceQuestionNumber,
                        sourceFile: path.relative(options.sourceRoot, sourcePath),
                        sourcePage: record.sourcePage,
                        pendingReasons: record.pendingReasons,
                        unresolvedInlineMathImageEvidence: record.unresolvedInlineMathImageEvidence,
                        prompt: record.structured.prompt,
                        parts: record.structured.parts,
                        explanation: record.structured.explanation,
                        images: record.images.map((image) => ({
                            checksum: image.checksum,
                            placement: image.placement,
                            optionKey: image.optionKey,
                            width: image.width,
                            height: image.height,
                        })),
                    });
                }
                if (!/[\^_]\(/u.test(serialized)) continue;
                reportEntries.push({
                    questionNumber: record.sourceQuestionNumber,
                    sourceFile: path.relative(options.sourceRoot, sourcePath),
                    sourcePage: record.sourcePage,
                    parserVersion: authorizedLesson.parserVersion,
                    pendingReasons: record.pendingReasons,
                    syntaxIssues: scriptSyntaxIssues(serialized),
                    prompt: record.structured.prompt,
                    parts: record.structured.parts,
                    explanation: record.structured.explanation,
                    contentFingerprint: record.contentFingerprint,
                });
            }
        }
        finally {
            await prepared.cleanup();
        }
    }

    const report = {
        generatedAt: new Date().toISOString(),
        sourceRoot: options.sourceRoot,
        sourceCount: sources.length,
        parsedCount: sources.reduce((total, source) => total + source.parsed, 0),
        publishableCount: sources.reduce((total, source) => total + source.publishable, 0),
        pendingReviewCount: sources.reduce((total, source) => total + source.pendingReview, 0),
        scriptQuestionCount: reportEntries.length,
        caretQuestionCount: reportEntries.filter((entry) =>
            JSON.stringify(entry).includes("^(")).length,
        subscriptQuestionCount: reportEntries.filter((entry) =>
            JSON.stringify(entry).includes("_(")).length,
        syntaxIssueCount: reportEntries.filter((entry) => entry.syntaxIssues.length).length,
        publishedSyntaxIssueCount: reportEntries.filter((entry) =>
            entry.syntaxIssues.length && !entry.pendingReasons.length).length,
        sources,
        entries: reportEntries,
        pendingEntries,
    };
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) {
        await mkdir(path.dirname(options.output), { recursive: true });
        await writeFile(options.output, output, "utf8");
    }
    process.stdout.write(JSON.stringify({
        sourceCount: report.sourceCount,
        parsedCount: report.parsedCount,
        publishableCount: report.publishableCount,
        pendingReviewCount: report.pendingReviewCount,
        scriptQuestionCount: report.scriptQuestionCount,
        caretQuestionCount: report.caretQuestionCount,
        subscriptQuestionCount: report.subscriptQuestionCount,
        syntaxIssueCount: report.syntaxIssueCount,
        publishedSyntaxIssueCount: report.publishedSyntaxIssueCount,
        output: options.output,
    }) + "\n");
    if (report.publishedSyntaxIssueCount) process.exitCode = 1;
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
});
