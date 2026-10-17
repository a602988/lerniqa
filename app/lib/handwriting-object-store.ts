import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import type { ValidatedHandwritingPng } from "./handwriting-png";

export interface HandwritingObjectIdentity {
    assetId: string;
    storageKey: string;
}

export interface StoredHandwritingObject extends HandwritingObjectIdentity {
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

/** Stable across an uncertain retry, but scoped to one learner, item and request. */
export function deriveHandwritingObjectIdentity(input: {
    learnerId: string;
    sessionItemId: string;
    idempotencyKey: string;
    checksum: string;
}): HandwritingObjectIdentity {
    const digest = createHash("sha256")
        .update("lerniqa-handwriting-v1\0")
        .update(input.learnerId)
        .update("\0")
        .update(input.sessionItemId)
        .update("\0")
        .update(input.idempotencyKey)
        .update("\0")
        .update(input.checksum)
        .digest();
    const assetId = digestUuid(digest);
    return {
        assetId,
        storageKey: `handwriting/${digest.toString("hex", 0, 2)}/${assetId}.png`,
    };
}

/** Writes a private immutable object without following a repository-local symlink. */
export async function storeHandwritingObject(
    identity: HandwritingObjectIdentity,
    handwriting: ValidatedHandwritingPng,
): Promise<StoredHandwritingObject> {
    const root = path.resolve(process.cwd(), "local-data", "assets");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("handwriting asset root is unsafe");

    const absolutePath = path.resolve(root, ...identity.storageKey.split("/"));
    if (!absolutePath.startsWith(`${root}${path.sep}`)) throw new Error("handwriting storage key escaped asset root");
    const parent = path.dirname(absolutePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const [realRoot, realParent] = await Promise.all([realpath(root), realpath(parent)]);
    if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${path.sep}`)) {
        throw new Error("handwriting asset directory escaped asset root");
    }

    const temporaryPath = path.join(parent, `.${identity.assetId}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
        handle = await open(temporaryPath, "wx", 0o600);
        await handle.writeFile(handwriting.bytes);
        await handle.sync();
        await handle.close();
        handle = undefined;
        try {
            // A hard link publishes the fully flushed temp object without replacing an existing retry target.
            await link(temporaryPath, absolutePath);
            return { ...identity, absolutePath, created: true };
        }
        catch (error) {
            if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
            const existingInfo = await lstat(absolutePath);
            if (
                existingInfo.isSymbolicLink()
                || !existingInfo.isFile()
                || existingInfo.size !== handwriting.bytes.length
            ) {
                throw new Error("existing handwriting object is unsafe or incomplete");
            }
            const existing = await readFile(absolutePath);
            const checksum = createHash("sha256").update(existing).digest("hex");
            if (checksum !== handwriting.checksum) throw new Error("existing handwriting object checksum mismatch");
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

export async function removeHandwritingObject(object: StoredHandwritingObject): Promise<void> {
    if (!object.created) return;
    await unlink(object.absolutePath).catch((error: unknown) => {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    });
}
