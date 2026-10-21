import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    createQuestionFromTemplate,
    getQuestionTemplate,
    inferQuestionTemplate,
    QUESTION_TEMPLATES,
    replaceQuestionTemplate,
} from "../app/lib/question-authoring-templates.ts";
import { parseQuestionDraftPackage, parseQuestionImportPackage } from "../app/lib/question-import-contract.ts";

const ID = "11111111-1111-4111-8111-111111111111";

function validPackage() {
    return {
        schemaVersion: 2,
        learnerId: ID,
        idempotencyKey: "question-import-contract-test",
        sourceBatchId: null,
        sourceTitle: "測試來源",
        catalog: {
            subjectId: ID,
            gradeId: null,
            semesterId: null,
            bookVersionId: null,
            curriculumUnitId: null,
            difficultyLevelId: null,
            sourceCategoryId: null,
            questionTypeId: null,
        },
        questions: [{
            draftKey: ID,
            classifications: [{ fieldId: ID, optionIds: [ID] }],
            sourceQuestionNumber: "1",
            sourcePage: 1,
            sharedPrompt: [
                { kind: "text", text: "閱讀表格後回答問題。" },
                { kind: "table", rows: [["項目", "數量"], ["甲", "2"]] },
                { kind: "image", assetId: ID, alt: "題目附圖" },
            ],
            parts: [
                {
                    stableKey: "part-1",
                    parentStableKey: null,
                    prompt: [{ kind: "text", text: "答案是哪一項？" }],
                    answerMode: "single_choice",
                    answerFieldCount: 1,
                    gradingPolicy: "automatic",
                    options: [
                        { key: "A", blocks: [{ kind: "text", text: "甲" }] },
                        { key: "B", blocks: [{ kind: "text", text: "乙" }] },
                    ],
                    answers: ["A"],
                    hints: [[
                        { kind: "text", text: "先比較表格中的數量。" },
                        { kind: "image", assetId: ID, alt: "提示示意圖" },
                    ]],
                    explanation: [{ kind: "text", text: "由表格可知答案是甲。" }],
                },
                {
                    stableKey: "part-2",
                    parentStableKey: null,
                    prompt: [{ kind: "formula", tex: "2+2=" }],
                    answerMode: "text",
                    answerFieldCount: 1,
                    gradingPolicy: "automatic",
                    options: [],
                    answers: ["4"],
                    hints: [],
                    explanation: [],
                },
            ],
        }],
    };
}

test("accepts rich questions with subparts, images, tables, formulas, options and answers", () => {
    const result = parseQuestionImportPackage(validPackage());
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.questions[0]?.parts.length, 2);
});
test("keeps ordered rich hints in the normalized draft", () => {
    const result = parseQuestionImportPackage(validPackage());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.questions[0]?.parts[0]?.hints, [[
        { kind: "text", text: "先比較表格中的數量。" },
        { kind: "image", assetId: ID, alt: "提示示意圖" },
    ]]);
});

test("upgrades existing version 2 parts without hints to an empty hint list", () => {
    const input = validPackage();
    delete (input.questions[0]!.parts[0] as Partial<typeof input.questions[0]["parts"][number]>).hints;
    const result = parseQuestionImportPackage(input);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value.questions[0]?.parts[0]?.hints, []);
});

test("rejects empty authored hint groups", () => {
    const input = validPackage();
    input.questions[0]!.parts[0]!.hints = [[]];
    const result = parseQuestionImportPackage(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors.map((error) => error.message).join("\n"), /至少需要一個內容區塊/u);
});

test("rejects choice answers that do not belong to the same part", () => {
    const input = validPackage();
    input.questions[0]!.parts[0]!.answers = ["C"];
    const result = parseQuestionImportPackage(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors.map((error) => error.message).join("\n"), /同一小題/u);
});

test("rejects automatic questions without a reference answer", () => {
    const input = validPackage();
    input.questions[0]!.parts[1]!.answers = [];
    const result = parseQuestionImportPackage(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors.map((error) => error.message).join("\n"), /必須提供答案/u);
});

test("rejects unknown fields instead of silently ignoring them", () => {
    const input = { ...validPackage(), fallback: true };
    const result = parseQuestionImportPackage(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors[0]?.message ?? "", /未知欄位/u);
});

test("accepts an account draft without learner, bank or catalog classification", () => {
    const input = {
        schemaVersion: 2,
        sourceTitle: "未分類練習",
        questions: validPackage().questions,
    };
    const result = parseQuestionDraftPackage(input);
    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(result.value.sourceTitle, "未分類練習");
        assert.equal(result.value.questions.length, 1);
    }
});

test("every authoring template creates a valid editable question", () => {
    for (const template of QUESTION_TEMPLATES) {
        const question = createQuestionFromTemplate(template.id, () => ID);
        const result = parseQuestionDraftPackage({
            schemaVersion: 2,
            sourceTitle: template.name,
            questions: [question],
        });
        assert.equal(result.ok, true, `${template.name} 應符合題目草稿契約`);
        assert.equal(inferQuestionTemplate(question), template.id);
        assert.equal(question.parts.every((part) => part.hints.length === 0), true, `${template.name} 不應自動建立作答前提示`);
    }
});

test("authoring templates use original practice-ready examples with one table and visual image choices", () => {
    const templatesWithTables = QUESTION_TEMPLATES.filter((template) => template.blueprint.sharedPrompt.some((block) => block.kind === "table"));
    assert.deepEqual(templatesWithTables.map((template) => template.id), ["question-group"]);
    const serialized = JSON.stringify(QUESTION_TEMPLATES);
    for (const placeholder of ["選項 A", "範例答案", "參考答案", "請根據題目內容寫出答案", "在這裡補充"]) {
        assert.doesNotMatch(serialized, new RegExp(placeholder, "u"));
    }
    assert.match(serialized, /請加入圖片 A：斜坡提醒標誌/u);
    const imageTemplate = getQuestionTemplate("image-choice");
    assert.deepEqual(Object.keys(imageTemplate.previewOptionImages ?? {}), ["A", "B", "C", "D"]);
    assert.match(JSON.stringify(imageTemplate.previewOptionImages), /\/question-template\/slope-sign\.svg/u);
    assert.match(serialized, /ㄘㄞˇ ㄏㄨㄥˊ/u);
    assert.match(serialized, /"彩虹"/u);
    assert.match(serialized, /"library","breakfast"/u);
});

test("changing a template keeps authored prompt and source metadata", () => {
    const question = createQuestionFromTemplate("single-choice", () => ID);
    question.sharedPrompt = [{ kind: "text", text: "保留這段題目內容" }];
    question.sourcePage = 7;
    question.sourceQuestionNumber = "12";

    const replaced = replaceQuestionTemplate(question, "short-answer");

    assert.deepEqual(replaced.sharedPrompt, question.sharedPrompt);
    assert.equal(replaced.sourcePage, 7);
    assert.equal(replaced.sourceQuestionNumber, "12");
    assert.equal(replaced.parts[0]?.answerMode, "text");
    assert.equal(replaced.parts[0]?.gradingPolicy, "manual_review");
});

test("upgrades a version 1 draft to stable version 2 question keys", () => {
    const question = validPackage().questions[0]!;
    const { draftKey: _draftKey, classifications: _classifications, ...legacyQuestion } = question;
    const result = parseQuestionDraftPackage({
        schemaVersion: 1,
        sourceTitle: "舊版草稿",
        questions: [legacyQuestion],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(result.value.schemaVersion, 2);
        assert.match(result.value.questions[0]!.draftKey, /^[0-9a-f-]{36}$/u);
        assert.deepEqual(result.value.questions[0]!.classifications, []);
    }
});

test("rejects duplicate classification options", () => {
    const input = validPackage();
    input.questions[0]!.classifications[0]!.optionIds = [ID, ID];
    const result = parseQuestionImportPackage(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors.map((error) => error.message).join("\n"), /不可重複/u);
});

test("keeps learner and catalog fields out of the account draft contract", () => {
    const input = {
        schemaVersion: 1,
        sourceTitle: "未分類練習",
        questions: validPackage().questions,
        learnerId: ID,
    };
    const result = parseQuestionDraftPackage(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors[0]?.message ?? "", /未知欄位/u);
});

test("orders the unscoped subject catalog by columns owned by subjects", async () => {
    const sourceUrl = new URL("../app/lib/question-import-store.ts", import.meta.url);
    const source = await readFile(sourceUrl, "utf8");
    const query = source.match(/SELECT id,code,name,origin FROM subjects[\s\S]*?ORDER BY[^`]+/u)?.[0];

    assert.ok(query, "找不到新增題目使用的科目目錄查詢");
    assert.doesNotMatch(query, /\bsort_order\b/u);
    assert.match(query, /ORDER BY origin DESC, normalized_name, id/u);
});

test("saving a scanned draft preserves the source document input contract", async () => {
    const source = await readFile(new URL("../app/lib/question-import-store.ts", import.meta.url), "utf8");
    const update = source.match(/UPDATE source_documents[\s\S]*?WHERE id = \$1 AND owner_user_id = \$4/u)?.[0];

    assert.ok(update, "找不到題目草稿的來源文件更新語句");
    assert.match(update, /pasted_text = CASE WHEN input_type = 'text' THEN \$3 ELSE NULL END/u);
});

test("question authoring keeps source previews above the practice-like editor", async () => {
    const [source, richEditor, styles] = await Promise.all([
        readFile(new URL("../app/questions/new/question-import-workspace.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/new/rich-content-editor.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/new/question-import.module.css", import.meta.url), "utf8"),
    ]);

    assert.match(source, /const route = useMemo\(\(\) => resolveWorkspaceRoute\(pathname\)/u);
    assert.match(source, /async function createImportedDraft\(draft: QuestionDraftPackage\)[\s\S]*await persistDraft\(\{[\s\S]*batchId: null,[\s\S]*router\.replace\(getDraftPath\(batchId\)\)/u);
    assert.match(source, /檢查並建立草稿/u);
    assert.doesNotMatch(source, /setTab\(|useState<"drafts" \| "editor" \| "scan" \| "json">/u);
    assert.match(source, /<nav aria-label="題目工作台">[\s\S]*?<button[^>]*data-active=\{!isDraftRoute\}[\s\S]*?建立題目/u);
    assert.match(source, /<nav className=\{styles\.createTabs\} aria-label="建立題目方式"[^>]*>[\s\S]*檔案上傳[\s\S]*格式匯入[\s\S]*手動編輯/u);
    assert.match(source, /role="tab" aria-selected=\{tab === "scan"\}/u);
    assert.match(source, /tab === "drafts" \? "我的草稿" : "建立題目"/u);
    assert.match(source, /<div className=\{styles\.headerTitleRow\}>[\s\S]*?<h1>[\s\S]*?\{status && <span className=\{styles\.headerStatus\} role="status">\{status\}<\/span>\}/u);
    assert.doesNotMatch(source, /\{status && <div className=\{styles\.status\}/u);
    assert.match(source, /data-authoring-layout="practice"/u);
    assert.match(source, /activeDraft\.sourceAssets\.map\(\(sourceAsset\) =>[\s\S]*<SourceAssetDialog sourceAsset=\{sourceAsset\} \/>/u);
    assert.doesNotMatch(source, /data-source-preview|原稿對照|scanViewModes/u);
    assert.match(source, /data-part-authoring/u);
    assert.match(source, />更多設定</u);
    assert.match(source, /question\.parts\.length > 1 \? "新增小題" : "建立題組"/u);
    assert.match(source, /const \[editorIndex, setEditorIndex\] = useState\(0\)/u);
    assert.match(source, /aria-label="題目編輯進度"/u);
    assert.match(source, /if \(questionIndex !== activeEditorIndex\) return null/u);
    assert.match(source, />上一題</u);
    assert.match(source, />下一題</u);
    assert.match(source, /新增下一題/u);
    assert.match(source, /draft: "處理中"/u);
    assert.match(source, /recognizing: "處理中"/u);
    assert.match(source, /role="status"[^>]*>\{DRAFT_STATUS_LABELS\[draft\.status\]\}/u);
    assert.match(styles, /\.draftsPanel\s*\{[^}]*background:\s*#fff/u);
    assert.match(source, /className=\{styles\.processingState\}[^>]*role="status"[^>]*aria-busy="true"/u);
    assert.match(source, /aria-label="背景分析內容"[\s\S]*頁面校正[\s\S]*文字辨識[\s\S]*題目分析/u);
    assert.match(source, /className=\{styles\.draftMeta\} data-merged=\{questions\.length === 0/u);
    assert.match(styles, /\.processingState\s*\{[^}]*background:\s*#fff/u);
    assert.match(styles, /\.draftMeta\[data-merged="true"\]\s*\+\s*\.processingState\s*\{[^}]*border-radius:\s*0 0 1rem 1rem/u);
    assert.match(styles, /\.draftMeta\[data-merged="true"\]\s*\+\s*\.emptyState\s*\{[^}]*background:\s*#fff[^}]*border-style:\s*solid/u);
    assert.doesNotMatch(styles, /\.processingState\s*\{[^}]*min-height:\s*24rem/u);
    assert.match(styles, /\.authoringCanvas\s*\{\s*min-width:\s*0;\s*\}/u);
    assert.doesNotMatch(styles, /\.authoringCanvas\s*\{[^}]*(?:border|background|padding):/u);
    assert.match(styles, /\.contentBlock\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto/u);
    assert.doesNotMatch(styles, /\.contentBlock\s*\{[^}]*(?:border|background|padding):/u);
    assert.match(richEditor, /draggable=\{blocks\.length > 1\}/u);
    assert.match(richEditor, /dataTransfer\.setData\(CONTENT_BLOCK_DRAG_TYPE, String\(index\)\)/u);
    assert.match(richEditor, /className=\{styles\.blockDelete\}/u);
    assert.match(styles, /\.hints\s*\{[^}]*border-top:\s*1px solid #e2dfea/u);
    assert.doesNotMatch(styles, /\.hints\s*\{[^}]*(?:border-radius|background):/u);
    assert.match(styles, /\.hints \.secondary\s*\{[^}]*min-height:\s*1\.75rem[^}]*align-self:\s*flex-start[^}]*font-size:\s*\.7rem/u);
    assert.match(styles, /\.contentActions button, \.contentActions label, \.emptyContent\s*\{[^}]*min-height:\s*1\.75rem[^}]*font-size:\s*\.68rem/u);
    assert.match(styles, /\.hintEditor \.contentEditor\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent/u);
    assert.match(styles, /@media \(max-width:\s*680px\)[\s\S]*\.contentBlock\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/u);
    assert.match(styles, /@media \(max-width:\s*680px\)[\s\S]*\.contentActions button, \.contentActions label, \.emptyContent\s*\{ min-height:\s*1\.75rem; \}/u);
    assert.doesNotMatch(styles, /\.authoringCanvas\s*\{[^}]*background:\s*#[fF][0-9a-fA-F]{5}/u);
    assert.doesNotMatch(styles, /\.question,\s*\.authoringCanvas\s*\{\s*padding:/u);
});

test("saved source files expose authorized previews and roles in the editor", async () => {
    const [workspace, store, styles] = await Promise.all([
        readFile(new URL("../app/questions/new/question-import-workspace.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/question-import-store.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/new/question-import.module.css", import.meta.url), "utf8"),
    ]);

    assert.match(store, /sourceAssets:\s*QuestionDraftSourceAsset\[\]/u);
    assert.match(store, /question-source:\$\{userId\}:\$\{input\.idempotencyKey\}/u);
    assert.match(store, /LEFT JOIN assets AS source_asset\s+ON source_asset\.id = document\.asset_id/u);
    assert.match(store, /source_asset\.created_by_user_id = batch\.created_by_user_id/u);
    assert.match(store, /url:\s*`\/api\/v1\/question-import-assets\/\$\{row\.asset_id\}`/u);
    assert.match(workspace, /<DialogTitle>上傳的原始檔<\/DialogTitle>/u);
    assert.match(workspace, /aria-label=\{isImage \? `查看上傳的圖片：\$\{sourceAsset\.fileName\}`/u);
    assert.match(workspace, /<img src=\{sourceAsset\.url\} alt=\{`上傳的原始圖片：\$\{sourceAsset\.fileName\}`\}/u);
    assert.doesNotMatch(workspace, /查看上傳原圖/u);
    assert.match(workspace, /<AppSelect aria-label=\{`圖片用途：\$\{sourceAsset\.fileName\}`\} className=\{styles\.sourceRoleSelect\}/u);
    assert.match(workspace, /QUESTION_SOURCE_ROLE_LABELS\[sourceAsset\.role\]/u);
    assert.match(workspace, /AI 判斷 · \{Math\.round/u);
    assert.match(workspace, /草稿名稱[\s\S]*?className=\{styles\.sourceAssets\}[\s\S]*?原始檔案/u);
    assert.match(workspace, /共 \{activeDraft\.sourceAssets\.length\} 個檔案/u);
    assert.match(styles, /\.sourceAssetList\s*\{[^}]*display:\s*grid;[^}]*repeat\(auto-fill, minmax\(10rem, 12rem\)\)/u);
    assert.match(styles, /\.sourceAssetItem\s*\{[^}]*display:\s*grid;[^}]*align-content:\s*start/u);
    assert.match(styles, /\.sourceAssetTrigger\s*\{[^}]*height:\s*7rem;[^}]*cursor:\s*zoom-in/u);
    assert.match(styles, /\.sourceRoleSelect\s*\{[^}]*height:\s*2rem;[^}]*min-height:\s*2rem[^}]*font-size:\s*\.72rem/u);
    assert.match(styles, /\.sourceAssetDialogImage\s*\{[^}]*object-fit:\s*contain/u);
});

test("an existing draft can append multiple sources through the shared upload contract", async () => {
    const [workspace, sourceRoute, uploadRoute, uploadContract, store, styles] = await Promise.all([
        readFile(new URL("../app/questions/new/question-import-workspace.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/question-imports/[batchId]/sources/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/question-imports/upload/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/question-source-upload.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/question-import-store.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/new/question-import.module.css", import.meta.url), "utf8"),
    ]);

    assert.match(workspace, /async function appendDraftSources\(files: File\[\]\)/u);
    assert.match(workspace, /activeDraft\.sourceAssets\.length \+ files\.length > 20/u);
    assert.match(workspace, /method: "PATCH"[\s\S]*method: "POST"/u);
    assert.match(workspace, /systemLabel="新增圖片或 PDF"[\s\S]*onFiles=\{appendDraftSources\}/u);
    assert.match(workspace, /multiple/u);
    assert.match(workspace, /可一次新增多張圖片或 PDF，新增後會重新分析整份草稿/u);
    assert.match(workspace, /const sourceSummaryMessage = \[[\s\S]*sourceAppendMessage[\s\S]*掃描影像已套用透視校正、展平與去除手寫預覽[\s\S]*draftStatusMessage\.replace/u);
    assert.match(workspace, /<div className=\{styles\.sourceAssetsCopy\}>[\s\S]*<p className=\{styles\.sourceAssetsHint\}>\{sourceSummaryMessage\}。<\/p>[\s\S]*<FileSourcePicker/u);
    assert.doesNotMatch(workspace, /styles\.draftMetaStatus/u);
    assert.match(workspace, /!activeDraft\?\.sourceAssets\.length && <div className=\{styles\.draftMetaFooter\}><p>\{draftStatusMessage\}<\/p><\/div>/u);
    assert.match(workspace, /<div className=\{styles\.draftTitleRow\}>[\s\S]*草稿名稱[\s\S]*儲存用途並重新分析[\s\S]*<\/div>/u);
    assert.match(sourceRoute, /export async function POST/u);
    assert.match(sourceRoute, /appendQuestionSourceBatch/u);
    assert.match(sourceRoute, /deriveQuestionSourceIdentity/u);
    assert.match(sourceRoute, /removeQuestionSource/u);
    assert.match(sourceRoute, /prepareQuestionSourceUploads/u);
    assert.match(uploadRoute, /prepareQuestionSourceUploads/u);
    assert.match(uploadContract, /MAX_QUESTION_SOURCE_FILES = 20/u);
    assert.match(uploadContract, /只接受 JPG、PNG、WebP 或 PDF/u);
    assert.match(store, /export async function appendQuestionSourceBatch/u);
    assert.match(store, /question-source-batch:\$\{batchId\}/u);
    assert.match(store, /status IN \('queued', 'retry', 'running'\)/u);
    assert.match(store, /documents\.rows\.length \+ input\.sources\.length > 20/u);
    assert.match(store, /INSERT INTO question_source_analysis_jobs/u);
    assert.ok(
        store.indexOf("if (appended.every(Boolean))") < store.indexOf("const active = await client.query", store.indexOf("export async function appendQuestionSourceBatch")),
        "重送判定應先於背景工作衝突，避免成功回應遺失時無法安全重試",
    );
    assert.match(styles, /\.primary, \.secondary, \.addQuestion, \.uploadButton, \.sourceButton\s*\{[^}]*min-height:\s*2\.35rem[^}]*padding:\s*\.5rem \.75rem[^}]*font-size:\s*\.82rem/u);
    assert.match(styles, /\.headerActions button\s*\{[^}]*min-height:\s*2\.2rem[^}]*font-size:\s*\.78rem/u);
    assert.match(styles, /\.createTabs button\s*\{[^}]*min-height:\s*2\.35rem[^}]*font-size:\s*\.82rem/u);
    assert.match(styles, /\.createTabs\s*\{[^}]*width:\s*100%;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/u);
    assert.match(styles, /\.headerTitleRow\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*align-items:\s*center/u);
    assert.match(styles, /\.headerStatus\s*\{[^}]*display:\s*inline-flex;[^}]*border-radius:\s*999px;[^}]*background:\s*#effaf6/u);
    assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.primary, \.secondary, \.addQuestion, \.uploadButton, \.sourceButton\s*\{ min-height: 2\.75rem; \}/u);
    assert.match(styles, /\.sourceAssetsHeading \.fileSourcePicker\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/u);
    assert.match(styles, /\.sourceAssetsHeading \.sourceButton\s*\{[^}]*min-height:\s*2rem[^}]*display:\s*inline-flex[^}]*font-size:\s*\.72rem[^}]*white-space:\s*nowrap/u);
    assert.match(styles, /\.sourceAssetsCopy\s*\{[^}]*display:\s*grid;[^}]*gap:\s*\.2rem/u);
    assert.match(styles, /\.draftTitleRow\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto[^}]*align-items:\s*end/u);
    assert.match(styles, /\.draftTitleRow input, \.draftTitleRow > button\s*\{[^}]*height:\s*2\.65rem;[^}]*min-height:\s*2\.65rem;[^}]*border-radius:\s*\.65rem/u);
    assert.match(styles, /@media \(max-width:\s*680px\)[\s\S]*\.draftTitleRow\s*\{?[^}]*grid-template-columns:\s*1fr/u);
    assert.match(styles, /@media \(max-width:\s*680px\)[\s\S]*\.draftTitleRow input, \.draftTitleRow > button\s*\{[^}]*height:\s*2\.75rem;[^}]*min-height:\s*2\.75rem/u);
    assert.match(styles, /@media \(max-width:\s*680px\)[\s\S]*\.sourceAssetsHeading \.sourceButton\s*\{ min-height:\s*2rem; \}/u);
});

test("an uncertain Bopomofo crop can be enlarged and replaced only after validation", async () => {
    const [editor, styles] = await Promise.all([
        readFile(new URL("../app/questions/new/rich-content-editor.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/new/question-import.module.css", import.meta.url), "utf8"),
    ]);

    assert.match(editor, /isUncertainBopomofoAlt\(block\.alt\)/u);
    assert.match(editor, /<DialogTitle>放大待確認的注音<\/DialogTitle>/u);
    assert.match(editor, /如果原稿有引號或括號，請一起輸入/u);
    assert.match(editor, /parseBopomofoCorrection\(correction\)/u);
    assert.match(editor, /onConfirm\(parsed\.value\)/u);
    assert.match(editor, /onConfirm=\{\(value\) => patchBlock\(index, \{ kind: "text", text: value \}\)\}/u);
    assert.match(editor, /disabled=\{!parsed\.ok\}/u);
    assert.match(editor, /disabled=\{isPendingBopomofo\}/u);
    assert.match(styles, /\.bopomofoReview\s*\{[^}]*background:\s*#fff/u);
    assert.match(styles, /\.bopomofoCropTrigger\s*\{[^}]*cursor:\s*zoom-in/u);
});

test("draft deletion uses an accessible confirmation dialog", async () => {
    const source = await readFile(new URL("../app/questions/new/question-import-workspace.tsx", import.meta.url), "utf8");

    assert.doesNotMatch(source, /window\.confirm/u);
    assert.match(source, /<DialogTrigger asChild>/u);
    assert.match(source, /<DialogTitle>刪除草稿<\/DialogTitle>/u);
    assert.match(source, /刪除後無法復原/u);
    assert.match(source, /<DialogClose asChild>[\s\S]*取消/u);
    assert.match(source, /busy \? "刪除中…" : "刪除草稿"/u);
});

test("an uploaded source is queued before the editor starts polling", async () => {
    const source = await readFile(new URL("../app/questions/new/question-import-workspace.tsx", import.meta.url), "utf8");
    const start = source.indexOf("async function startSourceAnalysis");
    const end = source.indexOf("async function reanalyzeDraft", start);
    const startSourceAnalysis = source.slice(start, end);
    const upload = startSourceAnalysis.indexOf("await uploadSourceFiles(pendingSources)");
    const editor = startSourceAnalysis.indexOf("router.push(getDraftPath(batchId))");

    assert.ok(start >= 0 && end > start, "找不到掃描上傳流程");
    assert.ok(upload >= 0, "掃描流程應先完成多檔上傳");
    assert.ok(editor > upload, "檔案上傳成功後應開啟草稿編輯畫面");
    assert.doesNotMatch(startSourceAnalysis, /await processSourceBatch/u);
    assert.match(startSourceAnalysis, /排入背景分析/u);
    assert.match(source, /multiple systemLabel=/u);
    assert.match(source, /form\.append\("role", source\.role\)/u);
    assert.match(source, /window\.setInterval\([\s\S]*refreshDrafts/u);
});

test("question authoring pages use distinct routes and a persistent workspace layout", async () => {
    const [workspace, layout, legacyPage, uploadPage, importPage, editPage, draftsPage, draftPage] = await Promise.all([
        readFile(new URL("../app/questions/new/question-import-workspace.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/layout.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/new/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/new/upload/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/new/import/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/new/edit/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/drafts/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/drafts/[batchId]/page.tsx", import.meta.url), "utf8"),
    ]);

    assert.match(layout, /<QuestionImportWorkspace \/>/u);
    assert.match(legacyPage, /redirect\("\/questions\/new\/upload"\)/u);
    assert.match(workspace, /upload: "\/questions\/new\/upload"/u);
    assert.match(workspace, /import: "\/questions\/new\/import"/u);
    assert.match(workspace, /edit: "\/questions\/new\/edit"/u);
    assert.match(workspace, /drafts: "\/questions\/drafts"/u);
    assert.match(workspace, /router\.push\(getDraftPath\(draft\.batchId\)\)/u);
    assert.match(workspace, /loadedRouteDraftId/u);
    for (const page of [uploadPage, importPage, editPage, draftsPage, draftPage]) assert.match(page, /return null;/u);
});

test("question source analysis uses a durable leased job", async () => {
    const [migration, route, worker, workerDatabase, store, supervisor, packageSource] = await Promise.all([
        readFile(new URL("../database/migrations/0027_question_source_analysis_jobs.up.sql", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/question-imports/[batchId]/process/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../scripts/process-question-source-analysis.ts", import.meta.url), "utf8"),
        readFile(new URL("../scripts/lib/question-source-analysis-db.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/question-import-store.ts", import.meta.url), "utf8"),
        readFile(new URL("../scripts/run-local-web.mjs", import.meta.url), "utf8"),
        readFile(new URL("../package.json", import.meta.url), "utf8"),
    ]);

    assert.match(migration, /CREATE TABLE question_source_analysis_jobs/u);
    assert.match(migration, /lease_expires_at/u);
    assert.match(migration, /WHERE status IN \('queued', 'retry', 'running'\)/u);
    assert.match(migration, /CREATE TABLE question_source_analysis_runs/u);
    assert.match(route, /queueQuestionSourceAnalysis/u);
    assert.match(route, /status: 202/u);
    assert.match(worker, /claimQuestionSourceAnalysis/u);
    assert.match(worker, /reconcileQuestionSourceAnalysisQueue/u);
    assert.match(worker, /--continuous/u);
    assert.doesNotMatch(worker, /failQuestionSourceProcessing/u);
    assert.match(workerDatabase, /SET status = \$3::varchar/u);
    assert.match(workerDatabase, /UPDATE import_batches[\s\S]*SET status = \$2::varchar/u);
    assert.match(workerDatabase, /UPDATE source_documents AS document[\s\S]*SET status = \$2::varchar/u);
    assert.match(store, /LEFT JOIN import_items AS item/u);
    assert.match(store, /SET document_role = \$3::varchar\(20\)[\s\S]*CASE WHEN \$3::varchar\(20\) = 'auto'/u);
    assert.match(supervisor, /--experimental-transform-types/u);
    assert.match(supervisor, /worker\?\.kill\(signal\)/u);
    assert.match(supervisor, /setTimeout\(startWorker, 3_000\)/u);
    assert.match(packageSource, /run-local-web\.mjs dev/u);
});

test("authoring workspace edits every rich question surface and hides internal part keys", async () => {
    const [workspace, editor, practice, store, templates, styles] = await Promise.all([
        readFile(new URL("../app/questions/new/question-import-workspace.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/new/rich-content-editor.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/components/persisted-question-fields.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/question-import-store.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/question-authoring-templates.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/questions/new/question-import.module.css", import.meta.url), "utf8"),
    ]);

    for (const label of ["題目內容", "小題內容", "作答前提示", "解答與解析"]) {
        assert.match(workspace, new RegExp(label, "u"));
    }
    assert.match(workspace, /label=\{`選項 \$\{option\.key\} 內容`\}/u);
    assert.match(editor, /文字<\/button>[\s\S]*公式<\/button>[\s\S]*表格<\/button>[\s\S]*圖片/u);
    assert.doesNotMatch(workspace, /<span>穩定鍵<\/span>|<span>題幹<\/span>/u);
    assert.match(practice, /"查看提示" : "再看一個提示"/u);
    assert.match(practice, /hasStructuredContent\(option\.contentBlocks\)/u);
    assert.match(store, /for \(const \[hintIndex, hint\] of part\.hints\.entries\(\)\)[\s\S]*"hint", hint, hintIndex/u);
    assert.match(workspace, /選擇題目範本/u);
    assert.match(workspace, /使用這個範本/u);
    assert.doesNotMatch(workspace, /<span>來源題號<\/span>|<span>來源頁碼<\/span>/u);
    assert.match(workspace, /createTemplatePreview\(templateId, "template-preview"\)/u);
    assert.match(workspace, /createTemplatePreview\(formatPreviewTemplateId, "format-preview"\)/u);
    assert.match(workspace, /className=\{styles\.answerSettings\} data-text-answer=\{part\.answerMode === "text"\}/u);
    assert.match(workspace, /import \{ AppSelect \} from "@\/app\/components\/app-select"/u);
    assert.match(workspace, /<span>作答方式<\/span><AppSelect options=\{ANSWER_OPTIONS\}/u);
    assert.doesNotMatch(workspace, /<span>作答方式<\/span><select/u);
    assert.match(workspace, /const GRADING_LABELS: Record<ImportGradingPolicy, string>/u);
    assert.match(workspace, /<span>如何批改<\/span><AppSelect options=\{GRADING_OPTIONS\}/u);
    assert.doesNotMatch(workspace, /<span>如何批改<\/span><select/u);
    assert.match(styles, /\.question select:not\(\[data-slot="native-select"\]\)/u);
    assert.match(workspace, /part\.answerMode === "text" && part\.answerFieldCount > 1 \? "manual_review" : "automatic"/u);
    assert.match(workspace, /if \(!suggestion \|\| part\.answers\.length > 0\) return null/u);
    assert.match(workspace, /AI 分析答案與解析/u);
    assert.match(workspace, /<button className=\{styles\.primary\} type="button" aria-busy=\{isRunning\}/u);
    assert.match(workspace, /aria-busy=\{isRunning\}/u);
    assert.match(workspace, /role="status" aria-live="polite"/u);
    assert.match(workspace, /LoaderCircle className=\{styles\.answerAnalysisSpinner\}/u);
    assert.match(workspace, /資訊不足，未產生答案或解析/u);
    assert.match(workspace, /\/api\/v1\/question-imports\/answer-suggestions/u);
    assert.match(workspace, />套用答案與解析</u);
    assert.match(workspace, /explanation: cleanBlocks\(part\.explanation\)\.length \? part\.explanation : \[\{ kind: "text", text: suggestion\.explanation \}\]/u);
    assert.match(styles, /\.answerAnalysisActions\s*\{[^}]*justify-content:\s*flex-end/u);
    assert.match(styles, /@keyframes answerAnalysisSpin/u);
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{ \.answerAnalysisSpinner \{ animation: none; \} \}/u);
    assert.match(workspace, /prompt: \[\], hints: \[\], explanation: \[\{ kind: "text", text: "" \}\], answerMode: "text"/u);
    assert.match(workspace, /blocks=\{part\.explanation\.length > 0 \? part\.explanation : \[\{ kind: "text", text: "" \}\]\} label="解答與解析"/u);
    assert.match(workspace, /label="解答與解析"[\s\S]*<section className=\{styles\.hints\}>/u);
    assert.match(workspace, /part\.hints\.length > 0 && <h4>作答前提示<\/h4>/u);
    assert.doesNotMatch(workspace, /作答完成並符合答案揭露規則後才會顯示/u);
    assert.doesNotMatch(workspace, /學習者自行展開後才會看到，不會影響判分/u);
    assert.match(styles, /\.answerSettings\[data-text-answer="true"\] \{ grid-template-columns: minmax\(11rem, \.8fr\) minmax\(16rem, 1\.7fr\) minmax\(6\.5rem, \.45fr\); \}/u);
    assert.match(styles, /\.question \.answerSettings input, \.answerSettings select\[data-slot="native-select"\] \{ height: 2\.65rem; min-height: 2\.65rem; border-radius: 1rem; \}/u);
    assert.match(styles, /\.part\s*\{[^}]*background:\s*#faf9fd/u);
    assert.match(styles, /\.sourceAssetItem\s*\{[^}]*background:\s*#faf9fd/u);
    assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.answerSettings\[data-text-answer="true"\][^}]*\{ grid-template-columns: 1fr; \}/u);
    assert.doesNotMatch(workspace, /useMemo\(\(\) => toEditorQuestion\(createQuestionFromTemplate/u);
    assert.match(workspace, /<Link className=\{styles\.back\} href="\/questions">/u);
    assert.match(workspace, /<LerniqaLogo className=\{styles\.brand\} \/>/u);
    assert.doesNotMatch(workspace, /<strong className=\{styles\.brand\}>Lerniqa<\/strong>/u);
    assert.doesNotMatch(workspace, /data-source-preview|原稿對照|scanViewModes/u);
    assert.match(styles, /@media \(max-width: 900px\)[\s\S]*grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*align-content: start;/u);
    assert.match(styles, /\.uploadPanel > svg \{[^}]*margin-bottom: \.75rem;/u);
    assert.match(styles, /\.uploadPanel h2 \{ margin: 0; \}/u);
    assert.match(styles, /\.uploadPanel > p \{ margin: \.45rem 0 1rem; line-height: 1\.65; \}/u);
    assert.match(styles, /\.createTabs button\[data-active="true"\] \{[^}]*background: #625ed1;/u);
    assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.createTabs \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/u);
    for (const name of ["單選題", "圖片選擇題", "複選題", "是非題", "填空題", "多格填答題", "簡答題", "題組與子題"]) {
        assert.match(templates, new RegExp(name, "u"));
    }
});
