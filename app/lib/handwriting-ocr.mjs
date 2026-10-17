import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const PROCESS_TIMEOUT_MS = 60_000;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
const PADDLE_IDLE_TIMEOUT_MS = 5 * 60 * 1_000;
const PADDLE_MAXIMUM_PENDING = 8;
const REPOSITORY_ROOT = process.cwd();
const PADDLE_PYTHON = path.join(REPOSITORY_ROOT, "local-data", "handwriting-python", "bin", "python");
const PADDLE_WORKER = path.join(REPOSITORY_ROOT, "scripts", "handwriting-paddle-worker.py");
const VISION_SOURCE = path.join(REPOSITORY_ROOT, "scripts", "handwriting-vision.swift");
const VISION_BINARY = path.join(REPOSITORY_ROOT, "local-data", "handwriting-runtime", "apple-vision-ocr");

let visionBuildPromise;
const PADDLE_STATE_KEY = Symbol.for("lerniqa.handwriting.paddle-worker");
const paddleState = globalThis[PADDLE_STATE_KEY] ?? {
    child: null,
    idleTimer: null,
    pending: new Map(),
    startPromise: null,
    stderrLength: 0,
    stdoutBuffer: "",
};
globalThis[PADDLE_STATE_KEY] = paddleState;

/**
 * 清除常駐 Paddle worker，讓下一次請求可重新建立乾淨程序。
 *
 * @param {import("node:child_process").ChildProcessWithoutNullStreams} child 發生狀態變更的 worker。
 * @param {Error} error 交給等待中請求的錯誤。
 * @returns {void} 無回傳值。
 */
function resetPaddleWorker(child, error) {
    if (paddleState.child !== child) return;
    if (paddleState.idleTimer) clearTimeout(paddleState.idleTimer);
    paddleState.idleTimer = null;
    paddleState.child = null;
    paddleState.startPromise = null;
    paddleState.stderrLength = 0;
    paddleState.stdoutBuffer = "";
    for (const pending of paddleState.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
    }
    paddleState.pending.clear();
}

/**
 * 沒有等待中工作時延後關閉模型，兼顧連續辨識速度與閒置記憶體。
 *
 * @returns {void} 無回傳值。
 */
function schedulePaddleIdleShutdown() {
    if (paddleState.idleTimer) clearTimeout(paddleState.idleTimer);
    paddleState.idleTimer = setTimeout(() => {
        const child = paddleState.child;
        if (!child || paddleState.pending.size > 0) return;
        resetPaddleWorker(child, new Error("HANDWRITING_OCR_IDLE_SHUTDOWN"));
        child.kill("SIGTERM");
    }, PADDLE_IDLE_TIMEOUT_MS);
    paddleState.idleTimer.unref();
}

/**
 * 處理常駐 Paddle worker 的逐行 JSON 回應。
 *
 * @param {import("node:child_process").ChildProcessWithoutNullStreams} child 回傳資料的 worker。
 * @param {Buffer} chunk worker 標準輸出片段。
 * @returns {boolean} 是否收到完成暖機訊號。
 */
function handlePaddleOutput(child, chunk) {
    if (paddleState.child !== child) return false;
    let sawReady = false;
    paddleState.stdoutBuffer += chunk.toString("utf8");
    if (Buffer.byteLength(paddleState.stdoutBuffer, "utf8") > MAX_PROCESS_OUTPUT_BYTES) {
        paddleState.child?.kill("SIGKILL");
        return false;
    }
    const lines = paddleState.stdoutBuffer.split(/\r?\n/u);
    paddleState.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
        let response;
        try {
            response = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (response?.type === "ready") {
            sawReady = true;
            continue;
        }
        const pending = paddleState.pending.get(response?.id);
        if (!pending) continue;
        clearTimeout(pending.timer);
        paddleState.pending.delete(response.id);
        paddleState.stderrLength = 0;
        pending.resolve(response);
        if (paddleState.pending.size === 0) schedulePaddleIdleShutdown();
    }
    return sawReady;
}

/**
 * 啟動一次並重用 PP-OCRv6 程序，避免每題重新載入模型。
 *
 * @returns {Promise<import("node:child_process").ChildProcessWithoutNullStreams>} 已完成暖機的 worker。
 */
async function paddleWorker() {
    if (paddleState.child && !paddleState.child.killed) return paddleState.child;
    if (paddleState.startPromise) return paddleState.startPromise;

    paddleState.startPromise = (async () => {
        await Promise.all([access(PADDLE_PYTHON), access(PADDLE_WORKER)]);
        const environment = { ...process.env, PADDLE_PDX_MODEL_SOURCE: "BOS" };
        return new Promise((resolve, reject) => {
            const child = spawn(PADDLE_PYTHON, [PADDLE_WORKER], {
                cwd: REPOSITORY_ROOT,
                env: environment,
                shell: false,
                stdio: ["pipe", "pipe", "pipe"],
            });
            let ready = false;
            const startupTimer = setTimeout(() => child.kill("SIGKILL"), PROCESS_TIMEOUT_MS);
            const fail = (error) => {
                clearTimeout(startupTimer);
                if (!ready) reject(error);
                resetPaddleWorker(child, error);
            };
            child.once("error", fail);
            child.once("close", (code) => fail(new Error(`HANDWRITING_OCR_EXIT_${code ?? "UNKNOWN"}`)));
            child.stderr.on("data", (chunk) => {
                if (paddleState.child !== child) return;
                paddleState.stderrLength += chunk.length;
                if (paddleState.stderrLength > MAX_PROCESS_OUTPUT_BYTES) child.kill("SIGKILL");
            });
            child.stdout.on("data", (chunk) => {
                const sawReady = handlePaddleOutput(child, chunk);
                if (ready || !sawReady) return;
                ready = true;
                clearTimeout(startupTimer);
                resolve(child);
            });
            paddleState.child = child;
        });
    })().catch((error) => {
        paddleState.startPromise = null;
        throw error;
    });
    return paddleState.startPromise;
}

/**
 * 執行固定的本機辨識程序，並限制執行時間與輸出大小。
 *
 * @param {string} command 固定的執行檔路徑。
 * @param {string[]} commandArguments 固定的參數。
 * @param {Buffer} input 傳給程序標準輸入的資料。
 * @param {NodeJS.ProcessEnv} environment 子程序環境變數。
 * @returns {Promise<{stdout: string, stderr: string}>} 程序輸出。
 */
function runProcess(command, commandArguments, input, environment = process.env) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, commandArguments, {
            cwd: REPOSITORY_ROOT,
            env: environment,
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
        });
        const stdout = [];
        const stderr = [];
        let stdoutLength = 0;
        let stderrLength = 0;
        let settled = false;
        const finish = (callback) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback();
        };
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            finish(() => reject(new Error("HANDWRITING_OCR_TIMEOUT")));
        }, PROCESS_TIMEOUT_MS);
        child.once("error", (error) => finish(() => reject(error)));
        child.stdout.on("data", (chunk) => {
            stdoutLength += chunk.length;
            if (stdoutLength > MAX_PROCESS_OUTPUT_BYTES) {
                child.kill("SIGKILL");
                finish(() => reject(new Error("HANDWRITING_OCR_OUTPUT_TOO_LARGE")));
                return;
            }
            stdout.push(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderrLength += chunk.length;
            if (stderrLength <= MAX_PROCESS_OUTPUT_BYTES) stderr.push(chunk);
        });
        child.once("close", (code) => finish(() => {
            const output = {
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
            };
            if (code === 0) resolve(output);
            else reject(Object.assign(new Error(`HANDWRITING_OCR_EXIT_${code ?? "UNKNOWN"}`), output));
        }));
        child.stdin.end(input);
    });
}

/**
 * 以 PP-OCRv6 辨識已正規化的手寫圖片。
 *
 * @param {Buffer} imageBytes 正規化 PNG。
 * @returns {Promise<Readonly<{engine: string, text: string | null, confidence: number}> | null>} 辨識候選；未安裝時回傳 null。
 */
export async function recognizeWithPaddle(imageBytes) {
    try {
        const child = await paddleWorker();
        if (paddleState.pending.size >= PADDLE_MAXIMUM_PENDING) return null;
        const id = randomUUID();
        if (paddleState.idleTimer) clearTimeout(paddleState.idleTimer);
        paddleState.idleTimer = null;
        const response = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                paddleState.pending.delete(id);
                const error = new Error("HANDWRITING_OCR_TIMEOUT");
                resetPaddleWorker(child, error);
                child.kill("SIGKILL");
                reject(error);
            }, PROCESS_TIMEOUT_MS);
            paddleState.pending.set(id, { reject, resolve, timer });
            const input = `${JSON.stringify({ id, image: imageBytes.toString("base64") })}\n`;
            child.stdin.write(input, "utf8", (error) => {
                if (!error) return;
                clearTimeout(timer);
                paddleState.pending.delete(id);
                resetPaddleWorker(child, error);
                child.kill("SIGKILL");
                reject(error);
            });
        });
        if (!response || response.error) return null;
        return selectPaddleCandidate(response.candidates);
    }
    catch {
        return null;
    }
}

/**
 * 合併原圖與單字強化圖的辨識結果；衝突時只接受明顯領先的高信心候選。
 *
 * @param {unknown} value Paddle worker 回傳的候選陣列。
 * @returns {Readonly<{engine: string, text: string | null, confidence: number}> | null} 可採用的辨識候選。
 */
export function selectPaddleCandidate(value) {
    if (!Array.isArray(value) || value.length !== 2) return null;
    const candidates = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object") return null;
        const text = typeof entry.text === "string" ? entry.text.normalize("NFKC").trim() : null;
        const confidence = Number(entry.confidence);
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
        candidates.push({ engine: "paddleocr", text: text || null, confidence });
    }
    const visible = candidates.filter((candidate) => candidate.text);
    if (!visible.length) return Object.freeze({ engine: "paddleocr", text: null, confidence: 0 });
    const strongestByText = new Map();
    for (const candidate of visible) {
        const existing = strongestByText.get(candidate.text);
        if (!existing || candidate.confidence > existing.confidence) {
            strongestByText.set(candidate.text, candidate);
        }
    }
    const ranked = [...strongestByText.values()].sort((left, right) => right.confidence - left.confidence);
    const strongest = ranked[0];
    if (ranked.length === 1) return Object.freeze(strongest);
    if (strongest.confidence >= 0.9 && strongest.confidence - ranked[1].confidence >= 0.05) {
        return Object.freeze(strongest);
    }
    return null;
}

/**
 * 關閉常駐 Paddle worker，供一次性驗收程序確實釋放本機資源。
 *
 * @returns {Promise<void>} worker 結束後完成。
 */
export async function shutdownHandwritingOcr() {
    const child = paddleState.child;
    if (!child) return;
    await new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
        }
        child.once("close", resolve);
        child.kill("SIGTERM");
    });
}

/**
 * 編譯固定來源的 Apple Vision helper，產物只保存在忽略版控的 local-data。
 *
 * @returns {Promise<string | null>} 可執行檔路徑；非 macOS 或編譯失敗時回傳 null。
 */
async function prepareVisionBinary() {
    if (process.platform !== "darwin") return null;
    visionBuildPromise ??= (async () => {
        try {
            const [sourceMetadata, binaryMetadata] = await Promise.all([
                stat(VISION_SOURCE),
                stat(VISION_BINARY).catch(() => null),
            ]);
            if (!binaryMetadata || binaryMetadata.mtimeMs < sourceMetadata.mtimeMs) {
                await mkdir(path.dirname(VISION_BINARY), { recursive: true });
                await runProcess("/usr/bin/xcrun", ["swiftc", "-O", VISION_SOURCE, "-o", VISION_BINARY], Buffer.alloc(0));
            }
            await access(VISION_BINARY);
            return VISION_BINARY;
        }
        catch {
            return null;
        }
    })();
    return visionBuildPromise;
}

/**
 * 在使用者開始書寫前載入本機 OCR，避免第一次辨識承擔模型暖機時間。
 *
 * @returns {Promise<void>} 可用的辨識器完成暖機後結束。
 */
export async function warmHandwritingOcr() {
    await Promise.all([paddleWorker(), prepareVisionBinary()]);
}

/**
 * 以 Apple Vision 交叉辨識已正規化的手寫圖片。
 *
 * @param {Buffer} imageBytes 正規化 PNG。
 * @returns {Promise<Readonly<{engine: string, text: string | null, confidence: number}> | null>} 辨識候選；平台不支援時回傳 null。
 */
export async function recognizeWithAppleVision(imageBytes) {
    try {
        const binary = await prepareVisionBinary();
        if (!binary) return null;
        const { stdout } = await runProcess(binary, [], imageBytes);
        const observations = JSON.parse(stdout);
        if (!Array.isArray(observations)) return null;
        const valid = observations.filter((entry) => (
            entry
            && typeof entry.text === "string"
            && entry.text.trim() !== ""
            && Number.isFinite(entry.confidence)
            && entry.confidence >= 0
            && entry.confidence <= 1
        ));
        const text = valid.map((entry) => entry.text.normalize("NFKC").trim()).join("\n") || null;
        const confidence = valid.length
            ? valid.reduce((sum, entry) => sum + entry.confidence, 0) / valid.length
            : 0;
        return Object.freeze({ engine: "apple-vision", text, confidence });
    }
    catch {
        return null;
    }
}
