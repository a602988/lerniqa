import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { trimNearWhitePng } from "../scripts/lib/hanlin-chinese-import.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const assetRoot = path.join(repositoryRoot, "local-data", "assets");
const outputRoot = path.join(import.meta.dirname, "emf-previews");
const documents = [
    "sanitized-source-documents/10b0e26b82329f0590def4811e513ff9db7d19d3ca90803151a6c7052eff3740.docx",
    "sanitized-source-documents/4506bf8eb30de242755f814a3734238f266746226f12d8711cc3d274fa7b58a9.docx",
    "sanitized-source-documents/38288e2bec85304c669dce072738d57fe9610445f2a40da3ba3f7f829a9a4ecf.docx",
    "sanitized-source-documents/d0027ec148dfa6e31b5fee856975d4f42e79e9fecf1206ce54eac06d76ade3ec.docx",
    "sanitized-source-documents/19d8a15aaf285ce063b20dc9a81689038068bd9b662da41b5e10a0b5e22e26c8.docx",
    "sanitized-source-documents/54f7eab7ca49d8599d7b57cbc6adf0e5c6d7ddc72cb69388c90cd87477e3d6aa.docx",
    "sanitized-source-documents/2661ca1f729c4a5718123103c1949ff1fe45d6e33a1762d9adc71396bc15b683.docx",
];

function run(command, args) {
    const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(result.stderr || `${command} exited ${result.status}`);
}

await mkdir(outputRoot, { recursive: true });
for (const storageKey of documents) {
    const slug = path.basename(storageKey, ".docx");
    const documentOutput = path.join(outputRoot, slug);
    const unpacked = path.join(documentOutput, "unpacked");
    const rendered = path.join(documentOutput, "rendered");
    await mkdir(unpacked, { recursive: true });
    await mkdir(rendered, { recursive: true });
    run("unzip", ["-oq", path.join(assetRoot, storageKey), "word/media/*", "-d", unpacked]);
    const mediaRoot = path.join(unpacked, "word", "media");
    const entries = (await readdir(mediaRoot)).filter((name) => name.endsWith(".emf")).sort();
    for (const name of entries) {
        const emfPath = path.join(mediaRoot, name);
        run("soffice", ["--headless", "--convert-to", "png", "--outdir", rendered, emfPath]);
        const pngPath = path.join(rendered, name.replace(/\.emf$/u, ".png"));
        const raw = await readFile(emfPath);
        const trimmed = await trimNearWhitePng(await readFile(pngPath));
        const rawChecksum = createHash("sha256").update(raw).digest("hex");
        const finalName = `${path.basename(name, ".emf")}-${rawChecksum}-${trimmed.width}x${trimmed.height}.png`;
        await writeFile(path.join(documentOutput, finalName), trimmed.buffer);
        console.log(JSON.stringify({ storageKey, name, rawChecksum, width: trimmed.width, height: trimmed.height, path: path.join(documentOutput, finalName) }));
    }
}
