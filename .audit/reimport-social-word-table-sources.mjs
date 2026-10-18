#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const auditPath = new URL("./social-table-word-pdf-audit.json", import.meta.url);
const progressPath = new URL("./social-table-reimport-progress.json", import.meta.url);
const { candidates } = JSON.parse(readFileSync(auditPath, "utf8"));
const startIndexArgument = process.argv.indexOf("--start-index");
const startIndex = startIndexArgument >= 0 ? Number(process.argv[startIndexArgument + 1]) : 0;
if (!Number.isInteger(startIndex) || startIndex < 0) throw new Error("--start-index must be a non-negative integer");
const allApprovedSources = [...new Map(candidates
  .filter((candidate) => candidate.auditStatus === "word-pdf-exact-text-match")
  .map((candidate) => [candidate.sourceSha256, candidate])).values()]
  .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, "zh-Hant"));
const approvedSources = allApprovedSources.slice(startIndex);

const completed = [];
const failed = [];

for (const [index, source] of approvedSources.entries()) {
  process.stdout.write(`[${startIndex + index + 1}/${allApprovedSources.length}] ${source.fileName}\n`);
  const result = spawnSync(
    process.execPath,
    ["scripts/import-hanlin-social-postgres.mjs", "--source-path", source.sourcePath, "--details"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const record = {
    sourceSha256: source.sourceSha256,
    sourcePath: source.sourcePath,
    exitCode: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
  if (result.status === 0) completed.push(record);
  else failed.push(record);
  writeFileSync(progressPath, `${JSON.stringify({ completed, failed }, null, 2)}\n`);
  if (result.status !== 0) process.stderr.write(`${result.stderr}\n`);
}

process.stdout.write(`Completed ${completed.length}; failed ${failed.length}.\n`);
if (failed.length) process.exitCode = 1;
