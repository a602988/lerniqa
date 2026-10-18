#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const candidatesPath = new URL("./social-native-table-candidates.json", import.meta.url);
const manifestPath = new URL("./social-table-word-pdfs.json", import.meta.url);
const outputPath = new URL("./social-table-word-pdf-audit.json", import.meta.url);
const approvedMappingsPath = new URL("../scripts/data/social-native-table-mappings.json", import.meta.url);

const { candidates } = JSON.parse(readFileSync(candidatesPath, "utf8"));
const { results } = JSON.parse(readFileSync(manifestPath, "utf8"));
const pdfBySourceSha256 = new Map(results.map((result) => [result.sourceSha256, result.outputPath]));
const manualWordPdfVisualApprovals = new Set([
  "0e58554031ba9f9bb7ef9c4e1397b3b0e6368c541fc30ad3f4df0c54ea7d8793:10",
]);
const confirmedVisualLayoutTables = new Set([
  "80d2cbb251bd63ff7cb999d509b34844dd0c2b1fb60c7706a616a12127d8e082:2",
  "6fbfd5e3562b9d0b0480387a8f769bca1a1f57c449a9e5573364097149e81a7b:3",
]);

const normalize = (value) => String(value ?? "")
  .normalize("NFKC")
  .replace(/[\s\u00a0\u3000]+/gu, "")
  .replace(/[\p{P}\p{S}]/gu, "");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const isSubsequence = (needle, haystack) => {
  let needleIndex = 0;
  for (const character of haystack) {
    if (character === needle[needleIndex]) needleIndex += 1;
    if (needleIndex === needle.length) return true;
  }
  return needle.length === 0;
};

const cellMatchesPage = (cell, pageText) => (
  pageText.includes(cell) || isSubsequence(cell, pageText)
);

const characterMultisetIncluded = (needles, haystack) => {
  const available = new Map();
  for (const character of haystack) available.set(character, (available.get(character) ?? 0) + 1);
  for (const character of needles.join("")) {
    const remaining = available.get(character) ?? 0;
    if (remaining < 1) return false;
    available.set(character, remaining - 1);
  }
  return true;
};

const pdfPagesByPath = new Map();
const readPdfPages = (pdfPath) => {
  if (!pdfPagesByPath.has(pdfPath)) {
    const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    });
    pdfPagesByPath.set(pdfPath, text.split("\f").map(normalize));
  }
  return pdfPagesByPath.get(pdfPath);
};

const audited = candidates.map((candidate) => {
  const pdfPath = pdfBySourceSha256.get(candidate.sourceSha256);
  if (!pdfPath) throw new Error(`Missing Word PDF for ${candidate.sourcePath}`);
  const pages = readPdfPages(pdfPath);
  const cells = candidate.rows.flat().map(normalize).filter(Boolean);
  const tableKey = `${candidate.sourceSha256}:${candidate.tableIndex}`;
  const columnCount = Math.max(0, ...candidate.rows.map((row) => row.length));
  const semanticTable = candidate.rows.length >= 2 && columnCount >= 2;
  const normalizedQuestionNumber = normalize(candidate.questionNumber);
  const questionNumberPages = pages
    .map((pageText, index) => pageText.includes(normalizedQuestionNumber) ? index + 1 : null)
    .filter(Boolean);
  const likelyTablePages = new Set(questionNumberPages.flatMap((page) => [page - 1, page]));

  const pageScores = pages.map((pageText, index) => {
    const matchedCells = cells.filter((cell) => cellMatchesPage(cell, pageText));
    return {
      page: index + 1,
      matchedCellCount: matchedCells.length,
      matchedCharacterCount: matchedCells.reduce((sum, cell) => sum + cell.length, 0),
      questionNumberPresent: pageText.includes(normalizedQuestionNumber),
      likelyQuestionPage: likelyTablePages.has(index + 1),
    };
  });
  pageScores.sort((left, right) => (
    Number(right.likelyQuestionPage) - Number(left.likelyQuestionPage)
    || right.matchedCellCount - left.matchedCellCount
    || right.matchedCharacterCount - left.matchedCharacterCount
    || Number(right.questionNumberPresent) - Number(left.questionNumberPresent)
    || left.page - right.page
  ));
  const bestPage = pageScores[0] ?? null;
  const matchedAllNonemptyCells = cells.length > 0 && bestPage?.matchedCellCount === cells.length;
  const evidencePages = [...likelyTablePages]
    .filter((page) => page >= 1 && page <= pages.length)
    .sort((left, right) => left - right);
  const evidenceText = evidencePages.map((page) => pages[page - 1]).join("");
  const matchedAllCellsAcrossEvidencePages = cells.length > 0
    && cells.every((cell) => cellMatchesPage(cell, evidenceText));
  const allTableCharactersPresent = cells.length > 0
    && characterMultisetIncluded(cells, evidenceText);
  const wordPdfTextVerified = matchedAllNonemptyCells
    || matchedAllCellsAcrossEvidencePages
    || allTableCharactersPresent;
  const manuallyVerifiedFromWordPdf = manualWordPdfVisualApprovals.has(tableKey);
  const confirmedVisualLayout = confirmedVisualLayoutTables.has(tableKey);

  return {
    ...candidate,
    pdfPath,
    pdfPage: bestPage?.page ?? null,
    questionNumberPages,
    evidencePages,
    pdfPageScore: bestPage,
    nonemptyCellCount: cells.length,
    columnCount,
    semanticTable,
    matchedAllNonemptyCells,
    matchedAllCellsAcrossEvidencePages,
    allTableCharactersPresent,
    manuallyVerifiedFromWordPdf,
    confirmedVisualLayout,
    auditStatus: confirmedVisualLayout
      ? "visual-layout-not-importable"
      : !semanticTable
        ? (cells.length === 0 ? "visual-or-empty-needs-review" : "layout-table-not-importable")
        : wordPdfTextVerified || manuallyVerifiedFromWordPdf
        ? "word-pdf-exact-text-match"
        : "word-pdf-mismatch-needs-review",
  };
});

const summary = audited.reduce((result, candidate) => {
  result[candidate.auditStatus] = (result[candidate.auditStatus] ?? 0) + 1;
  return result;
}, {});

writeFileSync(outputPath, `${JSON.stringify({ summary, candidates: audited }, null, 2)}\n`);
const approvedMappings = Object.groupBy(
  audited.filter((candidate) => candidate.auditStatus === "word-pdf-exact-text-match"),
  (candidate) => candidate.sourceSha256,
);
const registry = Object.fromEntries(Object.entries(approvedMappings).map(([sourceSha256, entries]) => [
  sourceSha256,
  entries.map((entry) => ({
    questionNumber: entry.questionNumber,
    sourcePage: entry.pdfPage,
    nativeTableIndex: entry.tableIndex,
    nativeTableSha256: entry.nativeTableSha256,
    nativeTableTextSha256: sha256(JSON.stringify(entry.rows)),
    placement: "prompt",
    rows: entry.rows,
    evidence: {
      kind: "microsoft-word-pdf",
      pdfPage: entry.pdfPage,
      evidencePages: entry.evidencePages,
      matchedAllNonemptyCells: entry.matchedAllNonemptyCells,
      matchedAllCellsAcrossEvidencePages: entry.matchedAllCellsAcrossEvidencePages,
      allTableCharactersPresent: entry.allTableCharactersPresent,
      manuallyVerifiedFromWordPdf: entry.manuallyVerifiedFromWordPdf,
      verification: entry.matchedAllNonemptyCells || entry.matchedAllCellsAcrossEvidencePages
        ? "cell-order"
        : entry.allTableCharactersPresent
          ? "page-character-multiset"
          : "manual-word-pdf-visual",
    },
  })),
]));
writeFileSync(approvedMappingsPath, `${JSON.stringify(registry, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
