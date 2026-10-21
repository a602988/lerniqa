import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";

export const MAX_QUESTION_SOURCE_BYTES = 20 * 1024 * 1024;

export type QuestionSourceMime = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

export interface ValidatedQuestionSource {
    bytes: Buffer;
    checksum: string;
    extension: "jpg" | "pdf" | "png" | "webp";
    mimeType: QuestionSourceMime;
}

export interface QuestionSourceObjectIdentity {
    assetId: string;
    storageKey: string;
}

export interface StoredQuestionSource extends QuestionSourceObjectIdentity {
    absolutePath: string;
    created: boolean;
}

function digestUuid(digest: Buffer): string {
    const bytes = Buffer.from(digest.subarray(0, 16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sniffMime(bytes: Buffer): Pick<ValidatedQuestionSource, "extension" | "mimeType"> | null {
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        return { extension: "png", mimeType: "image/png" };
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return { extension: "jpg", mimeType: "image/jpeg" };
    }
    if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
        return { extension: "webp", mimeType: "image/webp" };
    }
    if (bytes.length >= 8 && bytes.toString("ascii", 0, 5) === "%PDF-") {
        return { extension: "pdf", mimeType: "application/pdf" };
    }
    return null;
}

export function validateQuestionSource(bytes: Buffer): ValidatedQuestionSource | null {
    if (!bytes.length || bytes.length > MAX_QUESTION_SOURCE_BYTES) return null;
    const detected = sniffMime(bytes);
    if (!detected) return null;
    return {
        bytes,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        ...detected,
    };
}

export function deriveQuestionSourceIdentity(userId: string, idempotencyKey: string, source: ValidatedQuestionSource): QuestionSourceObjectIdentity {
    const digest = createHash("sha256")
        .update("lerniqa-question-source-v1\0")
        .update(userId)
        .update("\0")
        .update(idempotencyKey)
        .update("\0")
        .update(source.checksum)
        .digest();
    const assetId = digestUuid(digest);
    return {
        assetId,
        storageKey: `question-sources/${digest.toString("hex", 0, 2)}/${assetId}.${source.extension}`,
    };
}

function assetRoot(): string {
    return path.resolve(process.cwd(), "local-data", "assets");
}

function resolveStoragePath(storageKey: string): string {
    const root = assetRoot();
    if (!storageKey || storageKey.includes("\\") || path.posix.isAbsolute(storageKey)) throw new Error("unsafe question source storage key");
    const segments = storageKey.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error("unsafe question source storage key");
    const target = path.resolve(root, ...segments);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("question source storage key escaped asset root");
    return target;
}

export async function storeQuestionSource(
    identity: QuestionSourceObjectIdentity,
    source: ValidatedQuestionSource,
): Promise<StoredQuestionSource> {
    const root = assetRoot();
    await mkdir(root, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("question source asset root is unsafe");
    const absolutePath = resolveStoragePath(identity.storageKey);
    const parent = path.dirname(absolutePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const [realRoot, realParent] = await Promise.all([realpath(root), realpath(parent)]);
    if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${path.sep}`)) throw new Error("question source directory escaped asset root");

    const temporaryPath = path.join(parent, `.${identity.assetId}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
        handle = await open(temporaryPath, "wx", 0o600);
        await handle.writeFile(source.bytes);
        await handle.sync();
        await handle.close();
        handle = undefined;
        try {
            await link(temporaryPath, absolutePath);
            return { ...identity, absolutePath, created: true };
        }
        catch (error) {
            if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
            const existingInfo = await lstat(absolutePath);
            if (existingInfo.isSymbolicLink() || !existingInfo.isFile() || existingInfo.size !== source.bytes.length) {
                throw new Error("existing question source object is unsafe or incomplete");
            }
            const checksum = createHash("sha256").update(await readFile(absolutePath)).digest("hex");
            if (checksum !== source.checksum) throw new Error("existing question source checksum mismatch");
            return { ...identity, absolutePath, created: false };
        }
    }
    finally {
        await handle?.close().catch(() => undefined);
        await unlink(temporaryPath).catch((error: unknown) => {
            if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
        });
    }
}

export async function removeQuestionSource(object: StoredQuestionSource): Promise<void> {
    if (!object.created) return;
    await unlink(object.absolutePath).catch((error: unknown) => {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    });
}

export async function resolveQuestionSourcePath(storageKey: string): Promise<string> {
    const root = assetRoot();
    const target = resolveStoragePath(storageKey);
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    if (!realTarget.startsWith(`${realRoot}${path.sep}`)) throw new Error("question source path escaped asset root");
    const info = await lstat(realTarget);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("question source is not a safe file");
    return realTarget;
}
