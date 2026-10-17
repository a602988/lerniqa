#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("PDF path is required");

const bytes = new Uint8Array(await readFile(sourcePath));
const document = await getDocument({ data: bytes, useSystemFonts: true }).promise;
const pages = [];
const images = [];

for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str ?? "").join(" "));
    const operators = await page.getOperatorList();
    operators.fnArray.forEach((operator, index) => {
        if ([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].includes(operator)) {
            const args = operators.argsArray[index] ?? [];
            const image = args.find((argument) => argument && typeof argument === "object"
                && Number.isFinite(argument.width) && Number.isFinite(argument.height));
            images.push({ page: pageNumber, width: image?.width ?? 0, height: image?.height ?? 0 });
        }
    });
}

const javaScript = await document.getJSActions().catch(() => null);
const attachments = await document.getAttachments().catch(() => null);
process.stdout.write(JSON.stringify({
    pageCount: document.numPages,
    pages,
    images,
    hasJavaScript: Boolean(javaScript && Object.keys(javaScript).length),
    attachmentCount: attachments ? Object.keys(attachments).length : 0,
}));
