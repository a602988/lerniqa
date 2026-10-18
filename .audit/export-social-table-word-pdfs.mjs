#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const candidatesPath = new URL("./social-native-table-candidates.json", import.meta.url);
const outputRoot = "/private/tmp/lerniqa-social-table-word-pdfs";
const manifestPath = new URL("./social-table-word-pdfs.json", import.meta.url);
const { candidates } = JSON.parse(readFileSync(candidatesPath, "utf8"));

const sources = [...new Map(candidates.map((candidate) => [candidate.sourceSha256, candidate])).values()]
  .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, "zh-Hant"));

mkdirSync(outputRoot, { recursive: true });

const getAutomationSecurity = () => execFileSync(
  "osascript",
  ["-e", 'tell application "Microsoft Word" to get automation security'],
  { encoding: "utf8" },
).trim();

const setAutomationSecurity = (value) => execFileSync(
  "osascript",
  ["-e", `tell application "Microsoft Word" to set automation security to ${value}`],
  { stdio: "inherit" },
);

const exportOne = (sourcePath, outputPath) => execFileSync(
  "osascript",
  [
    "-e", 'tell application "Microsoft Word"',
    "-e", `open POSIX file ${JSON.stringify(sourcePath)}`,
    "-e", "set sourceDocument to active document",
    "-e", `save as sourceDocument file name ${JSON.stringify(outputPath)} file format format PDF`,
    "-e", "close sourceDocument saving no",
    "-e", "end tell",
  ],
  { stdio: "inherit" },
);

const originalSecurity = getAutomationSecurity();
const results = [];

try {
  setAutomationSecurity("msoAutomationSecurityForceDisable");

  for (const [index, source] of sources.entries()) {
    const outputPath = join(
      outputRoot,
      `${source.sourceSha256.slice(0, 12)}-${basename(source.sourcePath, ".doc")}.pdf`,
    );
    process.stdout.write(`[${index + 1}/${sources.length}] ${basename(source.sourcePath)}\n`);
    if (!(existsSync(outputPath) && statSync(outputPath).size > 0)) {
      exportOne(source.sourcePath, outputPath);
    }
    results.push({
      sourceSha256: source.sourceSha256,
      sourcePath: source.sourcePath,
      outputPath,
    });
    writeFileSync(manifestPath, `${JSON.stringify({ outputRoot, results }, null, 2)}\n`);
  }
} finally {
  setAutomationSecurity(originalSecurity);
}

writeFileSync(manifestPath, `${JSON.stringify({ outputRoot, results }, null, 2)}\n`);
process.stdout.write(`Exported ${results.length} Word PDFs to ${outputRoot}\n`);
