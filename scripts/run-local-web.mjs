#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") throw new Error("Usage: run-local-web.mjs dev|start");

const nextCli = path.join(repositoryRoot, "node_modules", "next", "dist", "bin", "next");
const nextArguments = mode === "dev"
    ? [nextCli, "dev", "-p", "3500", "--hostname", "127.0.0.1"]
    : [nextCli, "start", "-p", "3500", "--hostname", "127.0.0.1"];
const workerArguments = [
    "--no-warnings",
    "--experimental-transform-types",
    path.join(repositoryRoot, "scripts", "process-question-source-analysis.ts"),
    "--continuous",
    "--execute",
];

let stopping = false;
let worker;
const web = spawn(process.execPath, nextArguments, { cwd: repositoryRoot, env: process.env, stdio: "inherit" });

function startWorker() {
    if (stopping) return;
    worker = spawn(process.execPath, workerArguments, { cwd: repositoryRoot, env: process.env, stdio: "inherit" });
    worker.once("exit", (code) => {
        worker = undefined;
        if (!stopping) {
            process.stderr.write(`[question-source-worker] stopped with code ${code ?? "signal"}; retrying in 3 seconds.\n`);
            setTimeout(startWorker, 3_000).unref();
        }
    });
}

function stop(signal) {
    if (stopping) return;
    stopping = true;
    worker?.kill(signal);
    web.kill(signal);
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
web.once("exit", (code, signal) => {
    stopping = true;
    worker?.kill("SIGTERM");
    process.exitCode = code ?? (signal ? 1 : 0);
});

startWorker();
