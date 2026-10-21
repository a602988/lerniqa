import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import {
    createQuestionExchangePrompt,
    createQuestionExchangeTemplate,
    listQuestionExchangeAssets,
    parseQuestionExchangePackage,
    resolveQuestionExchangePackage,
} from "../app/lib/question-exchange-contract.ts";
import { parseQuestionDraftPackage } from "../app/lib/question-import-contract.ts";
import { cropQuestionImage } from "../app/lib/question-image-crop.ts";
import { validateQuestionSource } from "../app/lib/question-source-object-store.ts";

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";

test("creates a multi-question exchange template from every authoring template", () => {
    const ids = [
        "single-choice",
        "image-choice",
        "multiple-choice",
        "true-false",
        "fill-blank",
        "multi-field",
        "short-answer",
        "question-group",
    ] as const;
    for (const id of ids) {
        const sample = createQuestionExchangeTemplate(id);
        const parsed = parseQuestionExchangePackage(sample);
        assert.equal(parsed.ok, true, `${id} 的交換格式應有效`);
        assert.equal(sample.questions.length, 2);
        assert.ok(sample.questions.every((question) => question.templateId === id));
    }

    const allTemplates = createQuestionExchangeTemplate(ids);
    assert.equal(parseQuestionExchangePackage(allTemplates).ok, true);
    assert.equal(allTemplates.questions.length, ids.length * 2);
    assert.deepEqual(new Set(allTemplates.questions.map((question) => question.templateId)), new Set(ids));
});

test("creates one exchange package from the selected authoring templates", () => {
    const sample = createQuestionExchangeTemplate(["single-choice", "fill-blank", "question-group"]);
    const parsed = parseQuestionExchangePackage(sample);

    assert.equal(parsed.ok, true);
    assert.equal(sample.questions.length, 6);
    assert.deepEqual(
        [...new Set(sample.questions.map((question) => question.templateId))],
        ["single-choice", "fill-blank", "question-group"],
    );
    assert.equal(new Set(sample.questions.map((question) => question.questionKey)).size, sample.questions.length);
    assert.throws(() => createQuestionExchangeTemplate([]), /QUESTION_EXCHANGE_TEMPLATE_REQUIRED/u);
});

test("keeps image references outside the persistent draft until they are resolved", () => {
    const sample = createQuestionExchangeTemplate("image-choice", 1);
    const parsed = parseQuestionExchangePackage(sample);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const assets = listQuestionExchangeAssets(parsed.value);
    assert.deepEqual(assets.map((asset) => asset.ref), ["q1-option-a", "q1-option-b", "q1-option-c", "q1-option-d"]);

    const incomplete = resolveQuestionExchangePackage(parsed.value, {}, () => DRAFT_ID);
    assert.equal(incomplete.ok, false);
    if (!incomplete.ok) assert.equal(incomplete.missingRefs.length, 4);

    const resolved = resolveQuestionExchangePackage(
        parsed.value,
        Object.fromEntries(assets.map((asset) => [asset.ref, ASSET_ID])),
        () => DRAFT_ID,
    );
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(parseQuestionDraftPackage(resolved.value).ok, true);
    assert.ok(resolved.value.questions[0]?.parts[0]?.options.every((option) => option.blocks[0]?.kind === "image"));
});

test("accepts normalized source crop references and rejects coordinates outside the page", () => {
    const sample = createQuestionExchangeTemplate("single-choice", 1);
    sample.questions[0]!.sharedPrompt.push({
        kind: "crop_ref",
        ref: "q1-chart",
        sourceRef: "exam-photo",
        page: 1,
        rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        alt: "第 1 題圖表",
    });
    const parsed = parseQuestionExchangePackage(sample);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(listQuestionExchangeAssets(parsed.value)[0], {
        kind: "crop",
        ref: "q1-chart",
        sourceRef: "exam-photo",
        page: 1,
        rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        alt: "第 1 題圖表",
    });

    sample.questions[0]!.sharedPrompt[1] = {
        kind: "crop_ref",
        ref: "q1-chart",
        sourceRef: "exam-photo",
        page: 1,
        rect: { x: 0.8, y: 0.2, width: 0.3, height: 0.4 },
        alt: "第 1 題圖表",
    };
    const invalid = parseQuestionExchangePackage(sample);
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.match(invalid.errors.map((error) => error.message).join("\n"), /不可超出頁面/u);
});

test("rejects a template id that does not match the answer structure", () => {
    const sample = createQuestionExchangeTemplate("single-choice", 1);
    sample.questions[0]!.templateId = "short-answer";
    const parsed = parseQuestionExchangePackage(sample);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.errors.map((error) => error.message).join("\n"), /與所選範本不一致/u);
});

test("the AI prompt constrains question cleanup, template inference, and image references", () => {
    const prompt = createQuestionExchangePrompt(["image-choice", "question-group"]);
    assert.match(prompt, /只回傳 JSON/u);
    assert.match(prompt, /questions 中放入多題/u);
    assert.match(prompt, /題號.*不得寫入.*sharedPrompt.*prompt/u);
    assert.match(prompt, /sourceQuestionNumber.*原稿.*null/u);
    assert.match(prompt, /題型名稱.*不得寫入.*sharedPrompt.*prompt/u);
    assert.match(prompt, /依作答結構.*templateId/u);
    assert.match(prompt, /適合的題型不在允許清單.*不得改寫/u);
    assert.match(prompt, /無法確認.*不可猜測/u);
    assert.match(prompt, /答案或解析.*空陣列/u);
    assert.match(prompt, /image_ref/u);
    assert.match(prompt, /crop_ref/u);
    assert.match(prompt, /每個.*ref.*整份 JSON.*唯一/u);
    assert.match(prompt, /"templateId": "image-choice"/u);
    assert.match(prompt, /"templateId": "question-group"/u);
    assert.doesNotMatch(prompt, /每題只可使用這些 templateId：single-choice/u);
});

test("rejects internal asset identifiers and more than one crop source", () => {
    const internalAsset = createQuestionExchangeTemplate("single-choice", 1);
    internalAsset.questions[0]!.sharedPrompt.push({ kind: "image", assetId: ASSET_ID, alt: "不應接受" } as never);
    const rejectedAsset = parseQuestionExchangePackage(internalAsset);
    assert.equal(rejectedAsset.ok, false);
    if (!rejectedAsset.ok) assert.match(rejectedAsset.errors.map((error) => error.message).join("\n"), /不能直接使用內部圖片資產識別碼/u);

    const multipleSources = createQuestionExchangeTemplate("single-choice", 1);
    multipleSources.questions[0]!.sharedPrompt.push(
        { kind: "crop_ref", ref: "crop-a", sourceRef: "source-a", page: 1, rect: { x: 0, y: 0, width: 0.5, height: 0.5 }, alt: "圖 A" },
        { kind: "crop_ref", ref: "crop-b", sourceRef: "source-b", page: 1, rect: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, alt: "圖 B" },
    );
    const rejectedSources = parseQuestionExchangePackage(multipleSources);
    assert.equal(rejectedSources.ok, false);
    if (!rejectedSources.ok) assert.match(rejectedSources.errors.map((error) => error.message).join("\n"), /只能引用一個原始照片或 PDF/u);
});

test("crops a real source image by normalized coordinates", async () => {
    const source = await sharp({
        create: { width: 200, height: 100, channels: 3, background: "#ffffff" },
    }).png().toBuffer();
    const crop = await cropQuestionImage(source, { x: 0.25, y: 0.2, width: 0.5, height: 0.4 });
    const metadata = await sharp(crop.bytes).metadata();
    assert.equal(crop.width, 100);
    assert.equal(crop.height, 40);
    assert.equal(metadata.width, 100);
    assert.equal(metadata.height, 40);
    assert.equal(metadata.format, "png");
});

test("accepts every documented raster upload format and rejects HEIC containers", async () => {
    const image = sharp({
        create: { width: 24, height: 16, channels: 3, background: "#ffffff" },
    });
    const [jpeg, png, webp] = await Promise.all([
        image.clone().jpeg().toBuffer(),
        image.clone().png().toBuffer(),
        image.clone().webp().toBuffer(),
    ]);
    assert.equal(validateQuestionSource(jpeg)?.mimeType, "image/jpeg");
    assert.equal(validateQuestionSource(png)?.mimeType, "image/png");
    assert.equal(validateQuestionSource(webp)?.mimeType, "image/webp");
    assert.equal(validateQuestionSource(Buffer.from("000000186674797068656963", "hex")), null);
});

test("authoring and format import reuse one template selector and one file source picker", async () => {
    const [workspace, richEditor, selector, filePicker, cropRoute, driveRoute] = await Promise.all([
        readFile(new URL("../app/questions/new/question-import-workspace.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/new/rich-content-editor.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/new/question-template-selector.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/new/file-source-picker.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/question-imports/assets/crop/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/question-imports/google-drive/download/route.ts", import.meta.url), "utf8"),
    ]);
    assert.equal(workspace.match(/<QuestionTemplateSelector/gu)?.length, 2);
    assert.match(workspace, /selectionMode="multiple"/u);
    assert.match(selector, /全選/u);
    assert.match(selector, /取消全選/u);
    assert.match(richEditor, /<FileSourcePicker/u);
    assert.doesNotMatch(richEditor, /<input[^>]+type="file"/u);
    assert.match(selector, /QUESTION_TEMPLATES\.map/u);
    assert.match(filePicker, /Google 雲端硬碟/u);
    assert.match(filePicker, /drive\.file/u);
    assert.match(filePicker, /\{driveEnabled && <button/u);
    assert.match(filePicker, /htmlFor=\{systemInputId\}/u);
    assert.match(filePicker, /htmlFor=\{cameraInputId\}/u);
    assert.equal(filePicker.match(/capture="environment"/gu)?.length, 1);
    assert.doesNotMatch(filePicker, /capture=\{capture\}/u);
    assert.match(filePicker, /onPaste=\{\(event\) => void pasteFiles\(event\)\}/u);
    assert.match(filePicker, /navigator\.clipboard\.read\(\)/u);
    assert.match(filePicker, /selectFilesForAccept\(files, accept, multiple\)/u);
    assert.match(filePicker, /ClipboardPaste \/>\{clipboardBusy \? "正在讀取…" : "貼上"\}/u);
    assert.match(filePicker, /const \[pasteInstruction, setPasteInstruction\] = useState\(false\)/u);
    assert.match(filePicker, /catch \{\s*setPasteInstruction\(true\);\s*\}/u);
    assert.doesNotMatch(filePicker, /catch \{\s*onError\?\.\("無法直接讀取剪貼簿/u);
    assert.match(filePicker, /role="status"/u);
    assert.match(cropRoute, /findQuestionImportAsset/u);
    assert.match(cropRoute, /cropQuestionImage/u);
    assert.match(workspace, /processSourceFile\(file, false\)/u);
    assert.match(workspace, /JSON\.stringify\(\{ analyze, dewarp: true, corners: \{\} \}\)/u);
    assert.match(driveRoute, /capabilities\(canDownload\)/u);
    assert.match(driveRoute, /validateQuestionSource/u);
});

test("saved image and PDF drafts can run source analysis again", async () => {
    const source = await readFile(new URL("../app/questions/new/question-import-workspace.tsx", import.meta.url), "utf8");

    assert.match(source, /儲存用途並重新分析/u);
    assert.match(source, /reanalyzeDraft/u);
    assert.match(source, /inputType !== "text"/u);
});
