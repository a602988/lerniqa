import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const PROCESS_TIMEOUT_MS = 60_000;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
const REPOSITORY_ROOT = process.cwd();
const PADDLE_PYTHON = path.join(REPOSITORY_ROOT, "local-data", "handwriting-python", "bin", "python");
const PADDLE_WORKER = path.join(REPOSITORY_ROOT, "scripts", "handwriting-paddle-worker.py");
const VISION_SOURCE = path.join(REPOSITORY_ROOT, "scripts", "handwriting-vision.swift");
const VISION_BINARY = path.join(REPOSITORY_ROOT, "local-data", "handwriting-runtime", "apple-vision-ocr");

let visionBuildPromise;

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
 * 以 PP-OCRv5 辨識已正規化的手寫圖片。
 *
 * @param {Buffer} imageBytes 正規化 PNG。
 * @returns {Promise<Readonly<{engine: string, text: string | null, confidence: number}> | null>} 辨識候選；未安裝時回傳 null。
 */
export async function recognizeWithPaddle(imageBytes) {
    try {
        await Promise.all([access(PADDLE_PYTHON), access(PADDLE_WORKER)]);
        const id = randomUUID();
        const input = Buffer.from(`${JSON.stringify({ id, image: imageBytes.toString("base64") })}\n`, "utf8");
        const environment = { ...process.env, PADDLE_PDX_MODEL_SOURCE: "BOS" };
        const { stdout } = await runProcess(PADDLE_PYTHON, [PADDLE_WORKER], input, environment);
        const response = stdout.split(/\r?\n/u)
            .flatMap((line) => {
                try {
                    return [JSON.parse(line)];
                }
                catch {
                    return [];
                }
            })
            .find((entry) => entry?.id === id);
        if (!response || response.error) return null;
        const text = typeof response.text === "string" ? response.text.normalize("NFKC").trim() : null;
        const confidence = Number(response.confidence);
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
        return Object.freeze({ engine: "paddleocr", text: text || null, confidence });
    }
    catch {
        return null;
    }
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
