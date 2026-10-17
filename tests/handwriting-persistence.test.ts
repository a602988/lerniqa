import assert from "node:assert/strict";
import {
    mkdtemp,
    readFile,
    readdir,
    rm,
    unlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import test from "node:test";
import ts from "typescript";

async function loadModule(moduleUrl: URL): Promise<string> {
    const source = await readFile(moduleUrl, "utf8");
    let javascript = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    for (const match of javascript.matchAll(/from "(\.\.?\/[^"\n]+)"/gu)) {
        const dependency = match[1]!.endsWith(".ts") ? match[1]! : `${match[1]}.ts`;
        javascript = javascript.replaceAll(
            `from "${match[1]}"`,
            `from "${await loadModule(new URL(dependency, moduleUrl))}"`,
        );
    }
    return `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
}

const handwritingModule = await import(await loadModule(
    new URL("../app/lib/handwriting.ts", import.meta.url),
));
const handwritingObjectStore = await import(await loadModule(
    new URL("../app/lib/handwriting-object-store.ts", import.meta.url),
));
const handwritingPng = await import(await loadModule(
    new URL("../app/lib/handwriting-png.ts", import.meta.url),
));
const {
    MINIMUM_HANDWRITING_PIXELS,
    hasVisibleHandwritingPixels,
} = handwritingModule;
const {
    deriveHandwritingObjectIdentity,
    removeHandwritingObject,
    storeHandwritingObject,
} = handwritingObjectStore;
const { validateHandwritingPngDataUrl } = handwritingPng;

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
    const typeBytes = Buffer.from(type, "ascii");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
    return Buffer.concat([header, typeBytes, data, checksum]);
}

function rgbaPngDataUrl(width: number, height: number, visiblePixels: number): string {
    const rgba = Buffer.alloc(width * height * 4);
    for (let index = 0; index < Math.min(visiblePixels, width * height); index += 1) {
        const offset = index * 4;
        rgba[offset] = 41;
        rgba[offset + 1] = 42;
        rgba[offset + 2] = 67;
        rgba[offset + 3] = 255;
    }
    const scanlines = Buffer.alloc(height * (width * 4 + 1));
    for (let row = 0; row < height; row += 1) {
        const sourceStart = row * width * 4;
        const targetStart = row * (width * 4 + 1);
        scanlines[targetStart] = 0;
        rgba.copy(scanlines, targetStart + 1, sourceStart, sourceStart + width * 4);
    }

    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    const bytes = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", deflateSync(scanlines)),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
    return `data:image/png;base64,${bytes.toString("base64")}`;
}

test("blank and fully erased canvases do not count as handwriting", () => {
    const transparent = new Uint8ClampedArray(8 * 8 * 4);
    assert.equal(hasVisibleHandwritingPixels(transparent), false);

    const erased = new Uint8ClampedArray(8 * 8 * 4);
    erased.fill(255);
    for (let alpha = 3; alpha < erased.length; alpha += 4) erased[alpha] = 0;
    assert.equal(hasVisibleHandwritingPixels(erased), false);
    assert.equal(validateHandwritingPngDataUrl(rgbaPngDataUrl(8, 8, 0)), null);
});

test("only a bounded PNG with enough visible ink is accepted", () => {
    const tooLittleInk = rgbaPngDataUrl(8, 8, MINIMUM_HANDWRITING_PIXELS - 1);
    assert.equal(validateHandwritingPngDataUrl(tooLittleInk), null);

    const dataUrl = rgbaPngDataUrl(8, 8, MINIMUM_HANDWRITING_PIXELS);
    const validated = validateHandwritingPngDataUrl(dataUrl);
    assert.ok(validated);
    assert.equal(validated.mimeType, "image/png");
    assert.equal(validated.width, 8);
    assert.equal(validated.height, 8);
    assert.match(validated.checksum, /^[0-9a-f]{64}$/u);
    assert.equal(hasVisibleHandwritingPixels(new Uint8Array([
        0, 0, 0, 9,
        0, 0, 0, 9,
        0, 0, 0, 9,
        0, 0, 0, 9,
    ])), true);

    assert.equal(validateHandwritingPngDataUrl("data:image/png;base64,not-a-png="), null);
    const tampered = `${dataUrl.slice(0, -5)}AAAAA`;
    assert.equal(validateHandwritingPngDataUrl(tampered), null);
});

test("handwriting object identity is retry-stable and includes the content checksum", () => {
    const input = {
        learnerId: "11111111-1111-4111-8111-111111111111",
        sessionItemId: "22222222-2222-4222-8222-222222222222",
        idempotencyKey: "synthetic-request-1",
        checksum: "a".repeat(64),
    };
    const first = deriveHandwritingObjectIdentity(input);
    assert.deepEqual(deriveHandwritingObjectIdentity(input), first);
    assert.match(first.assetId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    assert.match(first.storageKey, /^handwriting\/[0-9a-f]{4}\/[0-9a-f-]{36}\.png$/u);

    assert.notDeepEqual(deriveHandwritingObjectIdentity({
        ...input,
        checksum: "b".repeat(64),
    }), first);
    assert.notDeepEqual(deriveHandwritingObjectIdentity({
        ...input,
        idempotencyKey: "synthetic-request-2",
    }), first);
    assert.notDeepEqual(deriveHandwritingObjectIdentity({
        ...input,
        learnerId: "33333333-3333-4333-8333-333333333333",
    }), first);
});

test("handwriting object storage is atomic, idempotent and fail-closed", { concurrency: false }, async () => {
    const originalCwd = process.cwd();
    const sandbox = await mkdtemp(path.join(tmpdir(), "lerniqa-handwriting-store-"));
    try {
        process.chdir(sandbox);
        const handwriting = validateHandwritingPngDataUrl(
            rgbaPngDataUrl(8, 8, MINIMUM_HANDWRITING_PIXELS),
        );
        assert.ok(handwriting);
        const identity = deriveHandwritingObjectIdentity({
            learnerId: "11111111-1111-4111-8111-111111111111",
            sessionItemId: "22222222-2222-4222-8222-222222222222",
            idempotencyKey: "synthetic-object-write",
            checksum: handwriting.checksum,
        });

        const first = await storeHandwritingObject(identity, handwriting);
        assert.equal(first.created, true);
        assert.deepEqual(await readFile(first.absolutePath), handwriting.bytes);

        const replay = await storeHandwritingObject(identity, handwriting);
        assert.equal(replay.created, false);
        assert.equal(replay.absolutePath, first.absolutePath);
        assert.deepEqual(await readFile(replay.absolutePath), handwriting.bytes);

        await removeHandwritingObject(first);
        await assert.rejects(readFile(first.absolutePath), { code: "ENOENT" });

        const partial = handwriting.bytes.subarray(0, Math.max(1, Math.floor(handwriting.bytes.length / 2)));
        await writeFile(first.absolutePath, partial, { flag: "wx", mode: 0o600 });
        await assert.rejects(
            storeHandwritingObject(identity, handwriting),
            /existing handwriting object is unsafe or incomplete/u,
        );
        assert.deepEqual(await readFile(first.absolutePath), partial, "a failed retry must not replace the partial object");
        await unlink(first.absolutePath);

        const different = Buffer.from(handwriting.bytes);
        different[different.length - 1] = (different[different.length - 1]! ^ 0xff) & 0xff;
        await writeFile(first.absolutePath, different, { flag: "wx", mode: 0o600 });
        await assert.rejects(
            storeHandwritingObject(identity, handwriting),
            /existing handwriting object checksum mismatch/u,
        );
        assert.deepEqual(await readFile(first.absolutePath), different, "a checksum conflict must remain untouched");
        await unlink(first.absolutePath);

        const recovered = await storeHandwritingObject(identity, handwriting);
        assert.equal(recovered.created, true);
        assert.deepEqual(await readFile(recovered.absolutePath), handwriting.bytes);
        const entries = await readdir(path.join(sandbox, "local-data", "assets"), { recursive: true });
        assert.deepEqual(
            entries.filter((entry) => String(entry).endsWith(".tmp")),
            [],
            "atomic writes and failed retries must not leave temporary objects",
        );
    }
    finally {
        process.chdir(originalCwd);
        await rm(sandbox, { recursive: true, force: true });
    }
});

test("attempt requests accept a validated handwriting object without inventing a text answer", async () => {
    const [route, client, page] = await Promise.all([
        readFile(new URL("../app/api/v1/local-practice/attempts/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/practice-client.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    ]);
    assert.match(route, /value\.handwriting !== undefined[\s\S]*value\.handwriting\.dataUrl/u);
    assert.match(route, /validateHandwritingPngDataUrl\(input\.handwritingDataUrl\)/u);
    assert.match(route, /INVALID_HANDWRITING/u);
    assert.match(route, /answers: parsedAnswers/u);
    assert.match(route, /findLocalPracticeHandwritingPart/u);
    assert.match(route, /transcribeLocalHandwriting\(handwriting\.bytes\)/u);
    assert.match(route, /transcription\.legibility === "clear" && transcription\.transcription/u);
    assert.match(route, /attemptInput\.answers\.push/u);
    assert.match(client, /handwriting\?: LocalPracticeHandwritingInput/u);
    assert.match(page, /answers: parsePracticeAnswers\(answer\),[\s\S]*handwriting: \{ dataUrl: handwriting \}/u);
    assert.match(page, /attemptRequestRef\.current = snapshot;[\s\S]*submitPersistedPracticeAttempt\(snapshot\)/u);
});

test("required handwriting questions keep a read-only answer field before and after recognition", async () => {
    const [fields, page, store, adapter] = await Promise.all([
        readFile(new URL("../app/components/persisted-question-fields.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/practice-catalog-adapter.ts", import.meta.url), "utf8"),
    ]);
    assert.match(page, /handwritingOnly=\{needsCharacterRecognition\}/u);
    assert.match(fields, /handwritingOnly \? "col-span-full grid gap-3"/u);
    assert.match(fields, /handwritingOnly[\s\S]*label="辨識文字"[\s\S]*value=\{recognizedAnswers\?\.\[part\.id\] \?\? ""\}[\s\S]*placeholder="等待辨識手寫內容"[\s\S]*readOnly/u);
    assert.match(fields, /停筆後會自動辨識，也可以立即分析或重新分析。/u);
    assert.match(store, /inputMethod: "handwriting_recognition"/u);
    assert.match(store, /payloadRecognizedText\(part\.answer_payload\)/u);
    assert.match(adapter, /recognizedAnswers: Object\.fromEntries/u);
});

test("handwriting preview analysis is warmed, automatic, cancellable, non-persistent, and cleared by new ink", async () => {
    const [route, warmup, client, page, pad] = await Promise.all([
        readFile(new URL("../app/api/v1/local-practice/handwriting/transcription/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/local-practice/handwriting/warmup/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/practice-client.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/components/handwriting-pad.tsx", import.meta.url), "utf8"),
    ]);
    assert.match(route, /requireLocalPracticeAccount\(request\)/u);
    assert.match(route, /validateHandwritingPngDataUrl\(body\.handwriting\.dataUrl\)/u);
    assert.match(route, /transcribeLocalHandwriting\(handwriting\.bytes, \{ force: body\.force === true \}\)/u);
    assert.match(route, /HANDWRITING_AI_UNAVAILABLE[\s\S]*直接送出並等待人工批改/u);
    assert.doesNotMatch(route, /submitLocalPracticeAttempt|storeHandwritingObject/u);
    assert.match(warmup, /requireLocalPracticeAccount\(request\)[\s\S]*warmHandwritingOcr\(\)/u);
    assert.match(client, /warmPersistedHandwriting\(signal\?: AbortSignal\)[\s\S]*\/api\/v1\/local-practice\/handwriting\/warmup/u);
    assert.match(page, /if \(!canAnalyzeHandwriting\) return;[\s\S]*warmPersistedHandwriting\(controller\.signal\)[\s\S]*controller\.abort\(\)/u);
    assert.match(client, /\/api\/v1\/local-practice\/handwriting\/transcription/u);
    assert.match(pad, /LoaderCircle className="animate-spin"/u);
    assert.match(pad, /hasAnalysisResult \? "重新分析" : "立即分析"/u);
    assert.match(page, /recognizedAnswers: \{ \[handwritingPart\.id\]: result\.transcription \}/u);
    assert.match(page, /window\.setTimeout\(\(\) => void analyzeHandwriting\(source\), 1500\)/u);
    assert.match(page, /function resetHandwritingAnalysis[\s\S]*handwritingAbortRef\.current\?\.abort\(\)[\s\S]*window\.clearTimeout\(handwritingTimerRef\.current\)[\s\S]*setHandwritingAnalysis\(\{ status: "idle", message: "" \}\)/u);
    assert.match(page, /async function analyzeHandwriting[\s\S]*window\.clearTimeout\(handwritingTimerRef\.current\)[\s\S]*transcribePersistedHandwriting/u);
    assert.match(page, /function changeHandwriting[\s\S]*resetHandwritingAnalysis\(\)[\s\S]*props\.onHandwriting\(value\)/u);
    assert.match(page, /onStrokeStart=\{canAnalyzeHandwriting \? resetHandwritingAnalysis : undefined\}/u);
    assert.match(pad, /function startDrawing[\s\S]*onStrokeStart\?\.\(\)[\s\S]*setPointerCapture/u);
    assert.match(page, /analysisId !== handwritingAnalysisIdRef\.current \|\| source !== handwritingRef\.current/u);
    assert.match(client, /transcribePersistedHandwriting\(handwriting: LocalPracticeHandwritingInput, options:[\s\S]*force\?: boolean[\s\S]*force: options\.force === true[\s\S]*signal: options\.signal/u);
    assert.match(page, /onAnalyze=\{canAnalyzeHandwriting \? \(\) => void analyzeHandwriting\(handwriting, true\) : undefined\}/u);
});

test("handwriting-only completion is limited to text parts and remains pending manual review", async () => {
    const store = await readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8");
    const submission = store.slice(store.indexOf("export async function submitLocalPracticeAttempt("));
    assert.match(submission, /missingParts[\s\S]*!input\.handwriting[\s\S]*row\.answer_mode !== "text"/u);
    assert.match(
        submission,
        /const usesHandwriting = Boolean\(input\.handwriting\) && handwrittenPartIds\.has\(row\.id\)/u,
    );
    assert.match(submission, /result: "pending" as const/u);
    assert.match(submission, /gradingSource: "manual_review" as const/u);
    assert.match(submission, /feedbackCode: "manual_review" as const/u);
    assert.match(submission, /answerPayload: \{ value: null \}/u);
});

test("handwriting links to missing text answers or one canonical calculation anchor", async () => {
    const store = await readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8");
    const submission = store.slice(store.indexOf("export async function submitLocalPracticeAttempt("));
    const scoreRejection = submission.indexOf('if (input.handwriting && item.session_check_mode === "score")');
    const objectWrite = submission.indexOf("storeHandwritingObject", scoreRejection);
    const scoreReceipt = submission.indexOf("INSERT INTO practice_score_receipts", scoreRejection);
    assert.ok(scoreRejection >= 0, "score sessions must reject handwriting explicitly");
    assert.ok(objectWrite > scoreRejection, "the private object must not be written before score-mode rejection");
    assert.ok(scoreReceipt > scoreRejection, "the score receipt must not be written before score-mode rejection");
    assert.match(submission, /HANDWRITING_SCORE_MODE_UNSUPPORTED/u);
    assert.match(submission, /INSERT INTO assets[\s\S]*'handwriting', 'private', 'clean'/u);
    assert.match(submission, /ORDER BY part\.position, part\.id, answer\.position, answer\.id/u);
    assert.match(submission, /const handwrittenPartIds = new Set\(missingParts\.map\(\(\{ row \}\) => row\.id\)\)/u);
    assert.match(
        submission,
        /const calculationAnchorPartId = input\.handwriting && handwrittenPartIds\.size === 0[\s\S]*groupedParts\.keys\(\)\.next\(\)\.value/u,
        "a calculation-only canvas must anchor to the first part in the stable grading order",
    );
    assert.match(submission, /const usesHandwriting = Boolean\(input\.handwriting\) && handwrittenPartIds\.has\(row\.id\)/u);
    assert.match(submission, /attachesHandwriting: usesHandwriting \|\| usesTranscription \|\| row\.id === calculationAnchorPartId/u);
    assert.match(
        submission,
        /const grade = gradeLocalPracticePart[\s\S]*attachesHandwriting: usesHandwriting \|\| usesTranscription[\s\S]*\.\.\.\(usesHandwriting[\s\S]*result: "pending" as const[\s\S]*\.\.\.grade/u,
        "an automatic answer used as the canonical anchor must keep its normal grade",
    );
    assert.match(
        submission,
        /gradingPolicy: usesTranscription \? "automatic" : row\.grading_policy/u,
        "a clear isolated transcription must use the normal exact-answer grader instead of asking the model to judge correctness",
    );
    assert.match(
        submission,
        /for \(const graded of gradedParts\)[\s\S]*INSERT INTO answer_part_results[\s\S]*if \(handwritingAssetId && graded\.attachesHandwriting\)[\s\S]*INSERT INTO answer_part_assets[\s\S]*\[inserted\.id, handwritingAssetId\]/u,
        "the same canvas asset is linked to every missing text answer, or only the canonical anchor when none are missing",
    );
    assert.match(submission, /VALUES \(\$1, \$2, 'handwriting', 0\)/u);
    assert.doesNotMatch(submission, /HANDWRITING_PART_NOT_FOUND/u);
    assert.match(
        submission,
        /missingParts\.some\(\(\{ row \}\) => row\.answer_mode !== "text"\)/u,
        "one canvas may cover every missing text part, but never a missing choice part",
    );
});

test("idempotent retries compare answers and either handwritten parts or one canonical anchor", async () => {
    const store = await readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8");
    const replay = store.slice(
        store.indexOf("const existing = existingResult.rows[0]"),
        store.indexOf("const itemResult = await client.query", store.indexOf("const existing = existingResult.rows[0]")),
    );
    assert.match(replay, /getAttemptParts/u);
    assert.match(replay, /getAttemptHandwritingAssets/u);
    assert.match(replay, /sameAnswerPayload/u);
    assert.match(replay, /sameHandwritingPayload/u);

    const comparator = store.slice(
        store.indexOf("function sameHandwritingPayload("),
        store.indexOf("function toScoreReceipt("),
    );
    assert.match(comparator, /payloadValue\(part\.answer_payload\) === null/u);
    assert.match(comparator, /part\.current_result === "pending"/u);
    assert.match(comparator, /part\.grading_source === "manual_review"/u);
    assert.match(
        comparator,
        /const linkedParts = handwrittenParts\.length > 0 \? handwrittenParts : partRows\.slice\(0, 1\)/u,
        "only null pending/manual parts are AI-sidecar answer candidates; an automatic anchor is storage-only",
    );
    assert.match(comparator, /assetRows\.length !== linkedParts\.length/u);
    assert.match(comparator, /asset\.question_part_id === part\.question_part_id/u);
    assert.match(comparator, /matching\[0\]\?\.checksum === handwriting\.checksum/u);
    assert.match(
        comparator,
        /linkedParts\.includes\(part\)[\s\S]*!assetRows\.some\(\(asset\) => asset\.question_part_id === part\.question_part_id\)/u,
        "a calculation-only canvas must not be duplicated beyond its canonical anchor",
    );
});

test("transaction failure cleans only an uncommitted object and preserves uncertain retry state", async () => {
    const [store, objectStore] = await Promise.all([
        readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/handwriting-object-store.ts", import.meta.url), "utf8"),
    ]);
    const submission = store.slice(store.indexOf("export async function submitLocalPracticeAttempt("));
    assert.match(submission, /try \{[\s\S]*withLocalPostgresTransaction/u);
    assert.match(submission, /catch \(error\)[\s\S]*storedHandwritingObject\?\.created/u);
    assert.match(submission, /SELECT EXISTS \(SELECT 1 FROM assets WHERE id = \$1\)/u);
    assert.match(submission, /if \(!committed\.rows\[0\]\?\.exists\) await removeHandwritingObject/u);
    assert.match(submission, /If commit state cannot be confirmed, retain the deterministic private object/u);
    assert.match(objectStore, /open\(temporaryPath, "wx", 0o600\)/u);
    assert.match(objectStore, /handle\.writeFile\(handwriting\.bytes\)[\s\S]*handle\.sync\(\)/u);
    assert.match(objectStore, /link\(temporaryPath, absolutePath\)/u);
    assert.match(objectStore, /unlink\(temporaryPath\)/u);
    assert.match(objectStore, /existing handwriting object checksum mismatch/u);
    assert.match(objectStore, /if \(!object\.created\) return/u);
});

test("handwriting hydration and reads follow the learner result-access chain", async () => {
    const [store, route, types] = await Promise.all([
        readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/local-practice/assets/[assetId]/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/local-practice-types.ts", import.meta.url), "utf8"),
    ]);
    assert.match(types, /handwritingAssets: LocalPracticeHandwritingAsset\[\]/u);
    assert.match(store, /url: `\/api\/v1\/local-practice\/assets\/\$\{asset\.asset_id\}\?kind=answer`/u);
    assert.match(store, /getAttemptHandwritingAssets[\s\S]*JOIN answer_part_assets AS link[\s\S]*link\.asset_role = 'handwriting'/u);

    const reader = store.slice(store.indexOf("export async function findLocalPracticeAnswerAsset("));
    assert.match(reader, /JOIN answer_part_results AS part_result/u);
    assert.match(reader, /JOIN answer_attempts AS attempt/u);
    assert.match(reader, /JOIN practice_session_items AS item/u);
    assert.match(reader, /JOIN practice_sessions AS session/u);
    assert.match(reader, /attempt\.learner_id = \$2/u);
    assert.match(reader, /session\.learner_id = \$2/u);
    assert.match(reader, /access\.user_id = \$3/u);
    assert.match(reader, /access\.can_view_results = true/u);
    assert.match(reader, /session\.check_mode = 'instant'[\s\S]*session\.check_mode = 'complete'[\s\S]*session\.status = 'completed'/u);
    assert.match(route, /requireLocalPracticeAccount\(request\)/u);
    assert.match(route, /kind === "answer"[\s\S]*findLocalPracticeAnswerAsset/u);
    assert.match(route, /"Cache-Control": "private, no-store"/u);
});

test("the UI advances only after a confirmed save, keeps uncertain retries, and hydrates saved ink", async () => {
    const [page, adapter] = await Promise.all([
        readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/lib/practice-catalog-adapter.ts", import.meta.url), "utf8"),
    ]);
    const submit = page.slice(
        page.indexOf("async function submitAnswer()"),
        page.indexOf("function nextQuestion()", page.indexOf("async function submitAnswer()")),
    );
    assert.match(submit, /if \(!currentQuestion \|\| !session \|\| practiceRequestRef\.current\) return/u);
    assert.match(submit, /attemptRequestRef\.current\?\.questionId[\s\S]*\? attemptRequestRef\.current[\s\S]*crypto\.randomUUID\(\)/u);
    assert.match(
        page,
        /const missingServerParts = serverTargetParts\.filter[\s\S]*missingServerParts\.length > 0[\s\S]*missingServerParts\.every\(\(part\) => part\.answerMode === "text"\)/u,
    );
    assert.match(
        page,
        /const canSubmit = serverQuestion \? hasCompleteServerAnswers \|\| canUseServerHandwriting/u,
        "complete typed or selected answers remain submittable when calculation ink is present",
    );
    assert.match(
        submit,
        /if \(!targetParts\.length \|\| \(incompleteParts\.length > 0 && !handwritingCompletesMissingText\)\) return;/u,
    );
    assert.doesNotMatch(submit, /文字答案已完整；若要以手寫作答/u);
    const requestIndex = submit.indexOf("await submitPersistedPracticeAttempt(snapshot)");
    const advanceIndex = submit.indexOf("setSession((current)");
    assert.ok(requestIndex >= 0 && advanceIndex > requestIndex, "the next-item state change must follow the awaited save");
    assert.match(submit, /if \(isDeterministicPracticeApiError\(error\)\) attemptRequestRef\.current = undefined/u);
    assert.match(submit, /setPracticeServiceError[\s\S]*return;[\s\S]*finally/u);
    assert.match(
        page,
        /只顯示成績模式不保存作答內容，因此不能提交手寫板。請改用「逐題檢核」或「全部作答後檢核」保存筆跡。/u,
    );
    assert.match(
        page,
        /<HandwritingPad[\s\S]*value=\{handwriting\}[\s\S]*disabled=\{Boolean\(feedback\) \|\| props\.busy \|\| props\.answerLocked \|\| checkMode === "score"/u,
    );
    assert.match(
      adapter,
      /attempt\.parts[\s\S]*flatMap\(\(part\) => part\.handwritingAssets(?: \?\? \[\])?\)[\s\S]*\.url/u,
    );
    assert.match(adapter, /\.\.\.\(handwriting \? \{ handwriting \} : \{\}\)/u);
});
