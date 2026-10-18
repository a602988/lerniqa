#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { AUTHORIZED_HANLIN_LESSON_IMPORTS } from "../scripts/lib/hanlin-chinese-import.mjs";

const DRIVE_ROOT = "/Users/chianlin/Library/CloudStorage/GoogleDrive-jean@minmax.biz/我的雲端硬碟/個人/題庫資料/國中";
const CHINESE_ROOT = path.join(DRIVE_ROOT, "國中國文", "01_第一冊");
const MATH_ROOT = path.join(DRIVE_ROOT, "國中數學");
const SCIENCE_ROOT = path.join(DRIVE_ROOT, "國中自然");
const SOCIAL_ROOT = path.join(DRIVE_ROOT, "國中社會", "題本檔案", "01_第一冊");
const MATH_REPORT = new URL("../reports/kangxuan-math-v9-audit-2026-10-18.json", import.meta.url);
const MANIFEST_PATH = new URL("./all-import-scope-word-pdfs.json", import.meta.url);

const socialFolders = Object.freeze([
  "01_試題",
  "02_素養題",
  "04_練習本",
  "05_各章節基測試題",
  "06_各章節會考試題",
]);

function documentIndex(root) {
  const paths = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && /\.docx?$/iu.test(entry.name)) paths.push(entryPath);
    }
  };
  visit(root);
  return new Map(paths.map((sourcePath) => [createHash("sha256").update(readFileSync(sourcePath)).digest("hex"), sourcePath]));
}

function wordSources(subjectCode, root) {
  const byHash = documentIndex(root);
  return AUTHORIZED_HANLIN_LESSON_IMPORTS
    .filter((entry) => entry.target.subjectCode === subjectCode)
    .map((entry) => {
      const sourcePath = byHash.get(entry.originalSha256);
      if (!sourcePath) throw new Error(`找不到核准來源雜湊：${entry.originalSha256} ${entry.fileName}`);
      return sourcePath;
    });
}

function mathSources() {
  const report = JSON.parse(readFileSync(MATH_REPORT, "utf8"));
  return report.sources.map((source) => path.join(MATH_ROOT, source.folder, "第一冊", source.fileName));
}

function socialSources() {
  return socialFolders.flatMap((folder) => {
    const directory = path.join(SOCIAL_ROOT, folder);
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith("~$") && /\.docx?$/iu.test(entry.name))
      .map((entry) => path.join(directory, entry.name));
  });
}

function pdfPathFor(sourcePath) {
  return sourcePath.replace(/\.docx?$/iu, ".pdf");
}

function pdfInfo(outputPath) {
  if (!existsSync(outputPath) || statSync(outputPath).size === 0) return null;
  try {
    const output = execFileSync("pdfinfo", [outputPath], { encoding: "utf8" });
    const pages = Number(output.match(/^Pages:\s+(\d+)/mu)?.[1] ?? 0);
    const producer = output.match(/^Producer:\s+(.+)$/mu)?.[1]?.trim() ?? "";
    return pages > 0 ? { pages, producer, size: statSync(outputPath).size } : null;
  }
  catch {
    return null;
  }
}

function exportWithWord(sourcePath, outputPath) {
  const temporaryPath = `/tmp/lerniqa-word-pdf-${createHash("sha256").update(outputPath).digest("hex")}.pdf`;
  if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  try {
    execFileSync("osascript", [
      "-e", 'tell application "Microsoft Word"',
      "-e", "ignoring application responses",
      "-e", `open POSIX file ${JSON.stringify(sourcePath)}`,
      "-e", "end ignoring",
      "-e", "end tell",
      "-e", "delay 1",
      "-e", 'tell application "System Events"',
      "-e", 'tell process "Microsoft Word"',
      "-e", 'if exists button "停用巨集" of window 1 then click button "停用巨集" of window 1',
      "-e", "end tell",
      "-e", "end tell",
      "-e", "repeat 50 times",
      "-e", 'tell application "System Events"',
      "-e", 'tell process "Microsoft Word"',
      "-e", 'if exists button "停用巨集" of window 1 then click button "停用巨集" of window 1',
      "-e", "end tell",
      "-e", "end tell",
      "-e", 'tell application "Microsoft Word" to set documentCount to count documents',
      "-e", "if documentCount > 0 then exit repeat",
      "-e", "delay 0.2",
      "-e", "end repeat",
      "-e", 'if documentCount is 0 then error "Word did not open the source document"',
      "-e", 'tell application "Microsoft Word"',
      "-e", "set sourceDocument to active document",
      // Word accepts POSIX paths for `open`, but compatibility-mode `.doc`
      // files can reject cloud-storage output paths with Apple event error
      // -1708. Export locally through Word, then copy the verified PDF beside
      // the source document.
      "-e", `set outputFile to (POSIX file ${JSON.stringify(temporaryPath)}) as text`,
      "-e", "save as sourceDocument file name outputFile file format format PDF",
      "-e", "close sourceDocument saving no",
      "-e", "end tell",
    ], { stdio: "inherit" });
    copyFileSync(temporaryPath, outputPath);
  }
  finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    execFileSync("osascript", ["-e", 'tell application "Microsoft Word" to close every document saving no'], { stdio: "ignore" });
  }
}

const sourcesBySubject = Object.freeze({
  國文: wordSources("chinese", CHINESE_ROOT),
  數學: mathSources(),
  自然: wordSources("biology", SCIENCE_ROOT),
  社會: socialSources(),
});
const sources = Object.entries(sourcesBySubject)
  .flatMap(([subject, paths]) => paths.map((sourcePath) => ({ subject, sourcePath })))
  .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, "zh-Hant", { numeric: true }));

const missing = sources.filter(({ sourcePath }) => !existsSync(sourcePath));
if (missing.length) throw new Error(`找不到 ${missing.length} 份來源文件：\n${missing.map(({ sourcePath }) => sourcePath).join("\n")}`);
if (new Set(sources.map(({ sourcePath }) => sourcePath)).size !== sources.length) throw new Error("來源清單含重複路徑");

const dryRun = process.argv.includes("--dry-run");
const originalSecurity = execFileSync("osascript", ["-e", 'tell application "Microsoft Word" to get automation security'], { encoding: "utf8" }).trim();
const results = [];

try {
  // Some legacy sources contain AutoOpen macros that close the document when
  // run non-interactively. Keep Word's normal security UI and explicitly open
  // those files with macros disabled, preserving their existing visible content.
  if (!dryRun) execFileSync("osascript", ["-e", 'tell application "Microsoft Word" to set automation security to msoAutomationSecurityByUI']);
  for (const [index, source] of sources.entries()) {
    const outputPath = pdfPathFor(source.sourcePath);
    let info = pdfInfo(outputPath);
    const wordNative = info?.producer.includes("Quartz PDFContext") ?? false;
    const action = wordNative ? "verified-existing" : dryRun ? "would-export" : "exported";
    process.stdout.write(`[${index + 1}/${sources.length}] ${source.subject} ${action} ${path.basename(source.sourcePath)}\n`);
    if (!wordNative && !dryRun) {
      exportWithWord(source.sourcePath, outputPath);
      info = pdfInfo(outputPath);
      if (!info || !info.producer.includes("Quartz PDFContext")) throw new Error(`Word PDF 驗證失敗：${outputPath}`);
    }
    results.push({ ...source, outputPath, action, ...info });
    writeFileSync(MANIFEST_PATH, `${JSON.stringify({ dryRun, totals: Object.fromEntries(Object.entries(sourcesBySubject).map(([subject, paths]) => [subject, paths.length])), results }, null, 2)}\n`);
  }
}
finally {
  if (!dryRun) execFileSync("osascript", ["-e", `tell application "Microsoft Word" to set automation security to ${originalSecurity}`]);
}

const totals = Object.fromEntries(Object.entries(sourcesBySubject).map(([subject, paths]) => [subject, paths.length]));
process.stdout.write(`${JSON.stringify({ total: sources.length, totals, dryRun })}\n`);
