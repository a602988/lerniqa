import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { VISUAL_REFERENCE, parseMetadataLast, parseParts, parseWrittenParts } from "../scripts/import-grade-seven-fixtures.mjs";

import {
    AUTHORIZED_HANLIN_LESSON_IMPORTS,
    HANLIN_ENGLISH_APPROVED_EMF_IMAGE_MAPPINGS,
    AUTHORIZED_FOURTH_LESSON_FILE,
    AUTHORIZED_FOURTH_LESSON_SHA256,
    approvedInlineMathImageText,
    correctVerifiedKangxuanMathFormula,
    correctedQuestionBody,
    extractImages,
    hasSuspiciousMissingMultiplicationSign,
    hasFragmentedMathScript,
    hasMalformedMathScript,
    inferVerifiedImageChoiceRepair,
    inspectVisibleImageBounds,
    isApprovedMissingMultiplicationFalsePositive,
    legacyMissingImageNames,
    normalizeLegacyWordSymbolArrows,
    normalizeLegacyWordOverstrikeSpeakers,
    removeApprovedNativeTableText,
    restoreLegacyWordDialogueSpeakers,
    recordFingerprint,
    mergeFragmentedMathScripts,
    structuredRecord,
    PARSER_VERSION,
    snapshotWordDocument,
    stripLegacyWordPromptListMarker,
    stripLegacyWordSequenceFieldPrefixes,
    stripVerifiedNumberedPartLabels,
    stripTrailingSourcePageMarker,
    trimNearWhitePng,
    validatePartImageOwnership,
} from "../scripts/lib/hanlin-chinese-import.mjs";
import { buildPartImageContentBlocks } from "../scripts/lib/hanlin-postgres-writer.mjs";

test("social fill-in records with an explicit true-false header become boolean questions", () => {
    const structured = structuredRecord({
        number: "05014059",
        type: "填充題",
        body: "• 是非題\n• 在我國，只要父或母具有我國國籍，其子女一出生便獲得我國國籍。",
        sourceAnswer: "○",
        difficulty: "易",
        explanation: "依國籍法規定判斷。",
    });

    assert.equal(structured.questionTypeCode, "single-choice");
    assert.equal(structured.originalTypeLabel, "是非題");
    assert.equal(structured.prompt, "在我國，只要父或母具有我國國籍，其子女一出生便獲得我國國籍。");
    assert.deepEqual(structured.parts, [{
        stableKey: "main",
        prompt: "",
        answerMode: "boolean",
        gradingPolicy: "automatic",
        options: [
            { key: "是", text: "是" },
            { key: "否", text: "否" },
        ],
        answer: { answerKey: "是" },
    }]);
    assert.deepEqual(structured.pendingReasons, []);
});

test("approved native table text is removed from the flattened prompt without removing surrounding text", () => {
    const body = [
        "附表為經、緯線比較，其中何者錯誤？",
        "緯線",
        "經線",
        "方向",
        "東西向",
        "南北向",
        "(A)甲 (B)乙 (C)丙 (D)丁",
    ].join("\n");
    const tables = [{
        sourceKind: "native",
        rows: [["", "緯線", "經線"], ["方向", "東西向", "南北向"]],
    }];

    assert.equal(
        removeApprovedNativeTableText(body, tables, "經緯線.doc"),
        "附表為經、緯線比較，其中何者錯誤？\n(A)甲 (B)乙 (C)丙 (D)丁",
    );
});

test("approved native table text removes only the cells present in a partial Word flattening", () => {
    assert.equal(
        removeApprovedNativeTableText("題幹\n緯線\n方向\n選項", [{
            sourceKind: "native",
            rows: [["緯線", "經線"], ["方向", "東西向"]],
        }], "經緯線.doc"),
        "題幹\n選項",
    );
});

test("legacy Word overstrike speaker fields restore only matching dialogue prefixes", () => {
    const source = normalizeLegacyWordOverstrikeSpeakers([
        "eq \\o\\ar(　　　,George): My name is George. 　(1)　",
        "eq \\o\\ar(　　　,Susan): 　(2)　 Susan.",
    ].join("\n"));

    assert.equal(source, [
        "George: My name is George. 　(1)　",
        "Susan: 　(2)　 Susan.",
    ].join("\n"));
    assert.equal(
        restoreLegacyWordDialogueSpeakers(
            ": My name is George. 　(1)\n: 　(2)　 Susan.",
            "George: My name is George. 　(1)\nSusan: 　(2)　 Susan.",
        ),
        "George: My name is George. 　(1)\nSusan: 　(2)　 Susan.",
    );
    assert.throws(
        () => restoreLegacyWordDialogueSpeakers(": Different text", "George: Source text"),
        /內容不一致/u,
    );
    assert.throws(
        () => restoreLegacyWordDialogueSpeakers(": Source  text", "George: Source text"),
        /內容不一致/u,
    );
});

test("legacy dialogue reconciliation keeps ordinal speakers and restores only blank EQ operands", () => {
    const source = [
        "George: Good morning EQ \\o(,　(1)　) Sue.",
        "Susan: Hi EQ \\o(,　　) George.",
        "May: See you.",
    ].join("\n");
    const sanitized = [
        "George: Good morning Sue.",
        ": Hi George.",
        "May: See you.",
    ].join("\n");
    const expected = [
        "George: Good morning　(1)　 Sue.",
        "Susan: Hi　　 George.",
        "May: See you.",
    ].join("\n");

    assert.equal(restoreLegacyWordDialogueSpeakers(sanitized, source), expected);
    assert.equal(restoreLegacyWordDialogueSpeakers(expected, source), expected);
    assert.ok(!expected.includes("EQ \\o"));

    const paddedSource = "George: Wait EQ \\o(, (2) )  ";
    const paddedRestored = restoreLegacyWordDialogueSpeakers(": Wait", paddedSource);
    assert.equal(paddedRestored, "George: Wait (2) ");
    assert.equal(restoreLegacyWordDialogueSpeakers(paddedRestored, paddedSource), paddedRestored);

    const trailingBlankSource = "George: Wait EQ \\o(,　　)";
    const trailingBlankRestored = restoreLegacyWordDialogueSpeakers(": Wait", trailingBlankSource);
    assert.equal(trailingBlankRestored, "George: Wait　　");
    assert.equal(restoreLegacyWordDialogueSpeakers(trailingBlankRestored, trailingBlankSource), trailingBlankRestored);

    assert.equal(
        restoreLegacyWordDialogueSpeakers(
            ": Before middle after.",
            "George: Before EQ \\o(, (1) ) middle EQ \\o(,　(2)　) after.",
        ),
        "George: Before (1)  middle　(2)　 after.",
    );
});

test("legacy dialogue reconciliation rejects changed speakers, text, turn counts, and EQ fields", () => {
    const source = "George: Hello.\nSusan: Good morning.";
    const mismatch = (sanitized, evidence = source) => assert.throws(
        () => restoreLegacyWordDialogueSpeakers(sanitized, evidence),
        { code: "LEGACY_DIALOGUE_SPEAKER_MISMATCH" },
    );

    mismatch("James: Hello.\n: Good morning.");
    mismatch("George: Hello.\n: Good  morning.");
    mismatch("George: Hello.\n: Different morning.");
    mismatch(": Hello.");
    mismatch(": Hello.\n: Good morning.\n: Another line.");
    mismatch(": Hello.", "George: Hello EQ \\o(,substantive).");
    mismatch(": Hello.", "George: Hello EQ \\o(, (1) .");
    mismatch(": Hello.", "George: Hello EQ \\o(, (1) (2)).");
    mismatch(": Hello.", "George: Hello EQ \\o(,(1)).");
    mismatch(": Hello.", "George: Hello EQ \\o(, (1)).");
    mismatch(": Hello.", "George: Hello EQ \\x(,　).");
    mismatch(": Hello  world.", "George: Hello EQ \\o(, (1) ) world.");
});

test("legacy Word list bullets are removed only from the English prompt start", () => {
    assert.equal(stripLegacyWordPromptListMarker("•\nAlan: Good morning."), "Alan: Good morning.");
    assert.equal(stripLegacyWordPromptListMarker("•"), "");
    assert.equal(stripLegacyWordPromptListMarker("  ●  \r\n正文"), "正文");
    assert.equal(stripLegacyWordPromptListMarker("• 題目內容"), "題目內容");
    assert.equal(stripLegacyWordPromptListMarker("•\t There are some bugs."), "There are some bugs.");
    assert.equal(stripLegacyWordPromptListMarker("第一行\n•\n第二行"), "第一行\n•\n第二行");
});

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("social imports combine exact embedded-table contracts with Word-PDF-verified native table contracts", async () => {
    const runner = await readFile(path.join(repositoryRoot, "scripts/import-hanlin-social-postgres.mjs"), "utf8");
    const nativeRegistry = JSON.parse(await readFile(
        path.join(repositoryRoot, "scripts/data/social-native-table-mappings.json"),
        "utf8",
    ));
    const contracts = [
        [
            "5787d12939bd17799b7c6b62a5dd94b5cee2fb0c0ad43aaf699792bd711342f2",
            "05010175",
            "oleObject1.bin",
            "f6d1de7ea75af1b40ab9fdf7a36ccb7b44be7a5e7da027d1cf99f26c0938d612",
            "（140°W，30°S）",
        ],
        [
            "f8d7460091d3a117b175f3f349abe4c46eef7d43fd78645784e77758094b72b7",
            "05011470",
            "oleObject1.bin",
            "3a42014bcd17f7a086c4a624bd13d3feb02715cceed0cf3080fe3660aa5f1779",
            "1014.6 m∕s",
        ],
        [
            "58cd99a10171f01b55e2f44389c9519ca95695df9ac44240dc7afe87b23eee6a",
            "05013597",
            "oleObject3.docx",
            "a318db985b6f5e3841086c74406db719ad151536e1163971a571168611613eda",
            "31,533 人",
        ],
    ];
    const tableContractsStart = runner.indexOf("const APPROVED_SOCIAL_QUESTION_TABLE_MAPPINGS_BY_SOURCE_SHA256");

    for (const [sourceSha256, questionNumber, objectName, objectSha256, lastCell] of contracts) {
        assert.match(sourceSha256, /^[0-9a-f]{64}$/u);
        const mappingStart = runner.indexOf(`"${sourceSha256}": Object.freeze([`, tableContractsStart);
        assert.notEqual(mappingStart, -1);
        const mappingEnd = runner.indexOf("    ]),", mappingStart);
        assert.notEqual(mappingEnd, -1);
        const mapping = runner.slice(mappingStart, mappingEnd);
        assert.ok(mapping.includes(`questionNumber: "${questionNumber}"`));
        assert.ok(mapping.includes(`embeddedObjectName: "${objectName}"`));
        assert.ok(mapping.includes(`embeddedObjectSha256: "${objectSha256}"`));
        assert.ok(mapping.includes('placement: "prompt"'));
        assert.ok(mapping.includes(`"${lastCell}"`));
    }
    assert.match(
        runner,
        /approvedQuestionTableMappings: approvedSocialQuestionTableMappings\(originalSha256\)/u,
    );
    const nativeMappings = Object.values(nativeRegistry).flat();
    assert.equal(nativeMappings.length, 164);
    assert.ok(nativeMappings.every((mapping) => (
        /^[0-9a-f]{64}$/u.test(mapping.nativeTableSha256)
        && /^[0-9a-f]{64}$/u.test(mapping.nativeTableTextSha256)
        && Number.isInteger(mapping.nativeTableIndex)
        && Number.isInteger(mapping.sourcePage)
        && mapping.evidence?.kind === "microsoft-word-pdf"
        && ["cell-order", "page-character-multiset", "manual-word-pdf-visual"]
            .includes(mapping.evidence?.verification)
        && mapping.placement === "prompt"
        && mapping.rows.length >= 2
    )));
    for (const questionNumber of [
        "05010275", "05010356", "05010715", "05011117", "05011254",
        "05011508", "05012121", "05012248", "05015630",
    ]) {
        assert.match(
            runner,
            new RegExp(`questionNumber: "${questionNumber}"[\\s\\S]{0,240}nativeTableSha256: "[0-9a-f]{64}"`, "u"),
        );
    }
    assert.match(runner, /parserVersion: "hanlin-social-v9"/u);
    assert.match(runner, /--question-number/u);
    assert.match(runner, /record\.approvedForReactivation = true/u);
    assert.match(
        runner,
        /approvedQuestionImageMappings: APPROVED_SOCIAL_QUESTION_IMAGE_MAPPINGS_BY_SOURCE_SHA256\[originalSha256\]/u,
    );
    assert.match(runner, /questionNumber: "05010633"[\s\S]*optionKey: "A"[\s\S]*optionKey: "D"/u);
    assert.match(runner, /questionNumber: "05010290"[\s\S]*imageChecksum: "ad6a9b3a2b982bb96992a16b9620ab5c0ab661dbcab7cb63cd98c3d35526659c"[\s\S]*labels: Object\.freeze\(\["A", "B", "C", "D", "E", "F"\]\)/u);
    assert.match(runner, /!name\.startsWith\("~\$"\)/u);
});

test("derived HTML keeps an approved short GIF while skipping unmapped inline formulas", async () => {
    const importLibrary = await readFile(path.join(repositoryRoot, "scripts/lib/hanlin-chinese-import.mjs"), "utf8");

    assert.match(importLibrary, /if \(isInlineFormula && !approvedMapping\) continue;/u);
    assert.doesNotMatch(importLibrary, /dimensions\.width[\s\S]{0,80}isInlineFormula/u);
});

test("approved English EMF contracts replace the malformed derived GIFs", () => {
    const legacyMappings = Object.fromEntries(Object.entries(HANLIN_ENGLISH_APPROVED_EMF_IMAGE_MAPPINGS)
        .map(([sourceChecksum, mappings]) => [sourceChecksum, mappings.filter((mapping) => !mapping.renderedChecksum)])
        .filter(([, mappings]) => mappings.length));
    assert.deepEqual(legacyMappings, {
        "10b0e26b82329f0590def4811e513ff9db7d19d3ca90803151a6c7052eff3740": [{
            rawChecksum: "36428b6e9b15c05b3c1d8f378c143fc8e75cb2dec990d86e1d23e6fb981a33dd",
            replacesDerivedChecksum: "ebdc0c8ef212fc09de70a4b1eeb1b6acbed62aff59f5d276b1bc2445a17f5ffc",
            questionNumber: "05010883",
            altText: "Tom、Ann、Ken 與 Sue 的資料表",
        }],
        "4506bf8eb30de242755f814a3734238f266746226f12d8711cc3d274fa7b58a9": [{
            rawChecksum: "89b1e710e0caf77701490b3c6406e4892b18e952d1d22b07ed6f0a21a49cb982",
            replacesDerivedChecksum: "b9ab11cb44a79c3c45c6840f35a2b6023066a8d25be22da9079d65543899f6f1",
            questionNumber: "05010768",
            altText: "給 Linda 的留言",
        }],
        "38288e2bec85304c669dce072738d57fe9610445f2a40da3ba3f7f829a9a4ecf": [
            {
                rawChecksum: "3a9a2b7a80dbe2a0a1af5520f83912ec04cc3bd8108ce1b7edf8b03c246c551d",
                replacesDerivedChecksum: "1df353253e0949de639c6a4feae5d6a10a5c7bde81fe2ace5dd12e4502b8cf87",
                questionNumber: "05012275",
                altText: "才藝表 A",
            },
            {
                rawChecksum: "787e5e03f90f603d63e401ec67ecb3e4efe0b5497624140896b5bf43414acee8",
                replacesDerivedChecksum: "2b6fc11129c97a279534f3c6d255e3f1eb48169c89dcc8f7e49cf12c0d0f4f5e",
                questionNumber: "05012275",
                altText: "才藝表 B",
            },
            {
                rawChecksum: "533baf00b0ead7ccb31130c63ebfeb282f6dd3cec3437532279c3b4fc7fc9e86",
                replacesDerivedChecksum: "7639352cbb8fbb3192fdbd60de8cd6f38538a94738f150fd33b301319756ad12",
                questionNumber: "05012275",
                altText: "才藝表 C",
            },
            {
                rawChecksum: "c1a2abe5ad7935488a9162a8d01117ac81cca91cafce6571c17b02bdf89ea70d",
                replacesDerivedChecksum: "7639352cbb8fbb3192fdbd60de8cd6f38538a94738f150fd33b301319756ad12",
                questionNumber: "05012275",
                altText: "才藝表 D",
            },
            {
                rawChecksum: "70c180298b2eb1d07d5b717c3cbc0f269c392b2f01a1e670160b89226b12e5ca",
                replacesDerivedChecksum: "24e9d0989408c845d5acde5d8c9740184f03840aafa45f6bcfe243bba8ad6490",
                questionNumber: "05012278",
                altText: "規則 A 至 D",
            },
        ],
        "d0027ec148dfa6e31b5fee856975d4f42e79e9fecf1206ce54eac06d76ade3ec": [{
            rawChecksum: "20b42cffaffa167b04b98177d62e9c9d457856051879e4d5521561121dfd3731",
            replacesDerivedChecksum: "3a3fb3a313bf6891d21ff10a285d0a399401234f43c527cc593c8cd9fc276239",
            questionNumber: "05012300",
            altText: "John 的行程表",
        }],
        "19d8a15aaf285ce063b20dc9a81689038068bd9b662da41b5e10a0b5e22e26c8": [{
            rawChecksum: "9400c59b4259461c77bdf3c0d99fcb3bc12b094e22d54e969823a612b6f07c15",
            replacesDerivedChecksum: "f2fb0ea63e2af9ef06462316a32d9a2dd2c2c5444a6f5e09e6e1802c0314b63e",
            questionNumber: "05011443",
            altText: "醫師看診時間表",
        }],
        "54f7eab7ca49d8599d7b57cbc6adf0e5c6d7ddc72cb69388c90cd87477e3d6aa": [{
            rawChecksum: "ea0783896fabf350525df41362f4f3ae093a2a4de8af701b6d252b6ac19b5833",
            replacesDerivedChecksum: "a1091ebb1600c85a06c4b25fd78a9d9569d9778a6b6491e546911a46b42e3507",
            questionNumber: "05011780",
            altText: "May 的行程月曆",
        }],
        "2661ca1f729c4a5718123103c1949ff1fe45d6e33a1762d9adc71396bc15b683": [
            {
                rawChecksum: "f92da96a72ebf8298f4587d00c44cb8deefeb44b52c4f612348d0419296f879c",
                replacesDerivedChecksum: "2ddd601e64a11677a85e7e9f69f8c57a61444762f8d6be501a0d1618c900776e",
                questionNumber: "05012344",
                altText: "Cute Zoo 動物之家海報",
            },
            {
                rawChecksum: "a7722370082646086c3f8b73bcc0575aa32e23641ca651fee4673cf84ced02ac",
                replacesDerivedChecksum: "634f7818d2cc8808571fa59fb0b3566613d93db79dfd3e6fcc48c0f4baab0210",
                questionNumber: "05012346",
                altText: "動物比較表",
            },
        ],
        e04e5b593258d20cdf1c3e75c5fcaed33cb62040744874571bf621d1095ec20e: [{
            rawChecksum: "b2c740e5e21d9f9e06e47f82387af15c72c5e49b7ef1440016ddf88b6f8e0ee8",
            replacesDerivedChecksum: "329fac189db610e34cb7f76a41aaf5a148c372f35c644ca2dec750424837d06f",
            questionNumber: "05010871",
            altText: "Ian 與父母、姊妹和祖父的全家福",
        }],
        "5aa2daa2318772841c53b40b6623b794c53ad98a7192fa819c78b18dc1f4061a": [{
            rawChecksum: "ec71b2a079e454daa51f06c25bf7a6c01f111a7e249ddd77328441d77a31b72d",
            replacesDerivedChecksum: "9e96290198180fe28772aef9048eda034d5c4ca25aeb75fb8df484eaf7edb0dd",
            questionNumber: "05012548",
            altText: "Judy 手持 Emma、Peter 與 Lucy 的合照",
        }],
    });
    const qualityMappings = Object.values(HANLIN_ENGLISH_APPROVED_EMF_IMAGE_MAPPINGS)
        .flat()
        .filter((mapping) => mapping.renderedChecksum);
    assert.equal(qualityMappings.length, 20);
    assert.deepEqual([...new Set(qualityMappings.map(({ questionNumber }) => questionNumber))].sort(), [
        "05010327", "05010328", "05010329", "05010335", "05010687", "05010692",
        "05011087", "05011090", "05011091", "05011441", "05011451", "05011453",
        "05012114", "05012176", "05012279", "05012297", "05012322",
    ]);
    assert.ok(qualityMappings.every((mapping) =>
        /^[0-9a-f]{64}$/u.test(mapping.rawChecksum)
        && /^[0-9a-f]{64}$/u.test(mapping.replacesDerivedChecksum)
        && /^[0-9a-f]{64}$/u.test(mapping.renderedChecksum)));
    assert.equal(new Set(qualityMappings.map((mapping) => mapping.rawChecksum)).size, 20);
    assert.equal(new Set(qualityMappings.map((mapping) => mapping.replacesDerivedChecksum)).size, 20);
    assert.equal(new Set(qualityMappings.map((mapping) => mapping.renderedChecksum)).size, 20);
    for (const [sourceChecksum, mappings] of Object.entries(HANLIN_ENGLISH_APPROVED_EMF_IMAGE_MAPPINGS)) {
        const entry = AUTHORIZED_HANLIN_LESSON_IMPORTS.find((candidate) => candidate.originalSha256 === sourceChecksum);
        assert.deepEqual(entry?.approvedEmfImageMappings, mappings);
    }
});

test("starter workbook image mappings assign each numbered image to its exact question part", () => {
    const lesson = AUTHORIZED_HANLIN_LESSON_IMPORTS.find((entry) =>
        entry.originalSha256 === "747f21406e0d7c811bc3aba37fe66d3d274839fc23793d3d321e525ab4180e14");

    assert.deepEqual(lesson?.approvedQuestionImageMappings.filter(({ questionNumber }) => questionNumber === "05012407"), [
        {
            checksum: "7f9a4961a314a957313991dbbe4a4305d5a885c668884d10a7c1dbeee49fc139",
            questionNumber: "05012407",
            altText: "Amy、Patty、Kevin、John 與 Doggy 的姓名圖卡",
        },
        {
            checksum: "ad8891b99563ae83e25287b4dcf7f92db0f1c256b2c847d42023c08b1801a1fc",
            questionNumber: "05012407",
            partStableKey: "1",
            altText: "第 1 小題姓名問答圖",
        },
        {
            checksum: "5f27c44a9530b06699cab24ddba75f010396d20137045bdc73711104e5c59609",
            questionNumber: "05012407",
            partStableKey: "2",
            altText: "第 2 小題姓名問答圖",
        },
        {
            checksum: "e89a5fdb421640a242cb051f8e4641f327d8319b1bac8999c3f7065b58800d7d",
            questionNumber: "05012407",
            partStableKey: "3",
            altText: "第 3 小題姓名問答圖",
        },
        {
            checksum: "75fe13684a1a45c250a8fd7a34c961749602e2e8bf81871fd6db5cc609efc8d3",
            questionNumber: "05012407",
            partStableKey: "4",
            altText: "第 4 小題姓名問答圖",
        },
    ]);
    assert.deepEqual(lesson?.requiredPartImageQuestionNumbers, [
        "05012406",
        "05012407",
        "05012408",
        "05012409",
        "05012410",
    ]);
    const expectedParts = new Map([
        ["05012406", [
            "5c0ad56569c9d252363254d9574206beacf92c8e2104970b122ed2b71b7e94e9",
            "98c9ac468913e810d9c54de8c2676eba1de50fb1ffa3fd2022e92119819c907b",
            "50c194550521f85eec3fbaa0e198b00dcd1388dfcb469bdcfef5adcdc053f259",
            "784fb31a228790d5e34b6eb00e204e5fc5c65c0e2256a556a9a62307d706934a",
        ]],
        ["05012408", [
            "5e398f8fa31c3418ed3e0732ec7d4ea814756c5f2ddd00cf77b762a8044e26e3",
            "499d7c27c56e6adc8fa88c95a949107667271299211e084380ac186b0c4fb0fe",
            "f70f4732c5d495799e217423a1668a074a9c3818f43284702d40db124bc2eeff",
            "4353974406998c824c794ce651560dbec56194f6025b317eedad14c6c2d8b25e",
            "5125df68b30fcb685e1ecccb1a4642cf7388260513e05b7990c00fed8cb210d5",
            "a67f30845dbe61f58842c925f4289344fd6361b68e0fe78142a8146b81054b07",
        ]],
        ["05012409", [
            "537be899eef56852851a9313559ca5e3f7e87d12828ca872b8c04b2ca5ac36aa",
            "ad08bf69823c2165013715af046dd4cdb6148d3553bcde59471c0eebeba13127",
            "d98f4cd1aa965f76dd9424f714a1cd508ede9167e58f197403512bfbaf6517a4",
            "48b1d8703bfa9ff2774b0e4e4a34daae221eae56f1a2c14df26a934c6b81010a",
        ]],
    ]);
    for (const [questionNumber, checksums] of expectedParts) {
        assert.deepEqual(
            lesson?.approvedQuestionImageMappings
                .filter((mapping) => mapping.questionNumber === questionNumber)
                .map(({ checksum, partStableKey }) => ({ checksum, partStableKey })),
            checksums.map((checksum, index) => ({ checksum, partStableKey: String(index + 1) })),
        );
    }
    assert.deepEqual(
        lesson?.approvedQuestionImageMappings
            .filter(({ questionNumber }) => questionNumber === "05012410")
            .map(({ checksum, sourceOccurrence, partStableKey }) => ({ checksum, sourceOccurrence, partStableKey })),
        [
            {
                checksum: "b423cefdb63f1e1d767fa7120bc8a9fc407141c4563062dc1866445012d801e6",
                sourceOccurrence: undefined,
                partStableKey: undefined,
            },
            {
                checksum: "51f6060096f1c8a99a5720bc5edf47fd0ed746c559457651c34399c99fbfb572",
                sourceOccurrence: 1,
                partStableKey: "1",
            },
            {
                checksum: "51f6060096f1c8a99a5720bc5edf47fd0ed746c559457651c34399c99fbfb572",
                sourceOccurrence: 2,
                partStableKey: "2",
            },
        ],
    );
});

test("duplicate approved image bytes map by source occurrence and remain idempotent", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanlin-part-occurrence-"));
    try {
        const buffer = await sharp({
            create: { width: 10, height: 10, channels: 3, background: "#406080" },
        }).png().toBuffer();
        const checksum = createHash("sha256").update(buffer).digest("hex");
        await writeFile(path.join(temporaryRoot, "same.png"), buffer);
        const input = {
            html: '<p>題號：05012410</p><img src="same.png"><img src="same.png">',
            htmlPath: path.join(temporaryRoot, "source.html"),
            pdfImageRows: [],
            stableImages: { images: [], ambiguous: false },
            records: [{ number: "05012410", body: "" }],
            recordPages: [[]],
            ignoredImageChecksums: new Set(),
            preferPrecedingAssociation: true,
            allowDerivedHtmlImages: true,
            approvedQuestionImageMappings: [
                { checksum, questionNumber: "05012410", sourceOccurrence: 2, partStableKey: "2" },
                { checksum, questionNumber: "05012410", sourceOccurrence: 1, partStableKey: "1" },
            ],
        };
        const summarize = (result) => result.imagesByRecord.get(0).map((image) => ({
            assetId: image.assetId,
            checksum: image.checksum,
            partStableKey: image.partStableKey,
        }));

        const first = summarize(await extractImages(input));
        const second = summarize(await extractImages(input));
        assert.deepEqual(first.map(({ partStableKey }) => partStableKey), ["1", "2"]);
        assert.equal(first[0].assetId, first[1].assetId);
        assert.deepEqual(second, first);
        const blocks = first.flatMap((image, index) => buildPartImageContentBlocks({
            record: { images: [image] },
            revisionId: "22222222-2222-4222-8222-222222222222",
            part: { stableKey: String(index + 1) },
            partId: `${index + 3}3333333-3333-4333-8333-333333333333`,
            startPosition: 0,
            fallbackAltText: "小題附圖",
        }));
        assert.deepEqual(blocks.map(({ question_part_id, asset_id }) => ({ question_part_id, asset_id })), [
            { question_part_id: "33333333-3333-4333-8333-333333333333", asset_id: first[0].assetId },
            { question_part_id: "43333333-3333-4333-8333-333333333333", asset_id: first[0].assetId },
        ]);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("legacy singleton image mappings remain compatible", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanlin-part-singleton-"));
    try {
        const buffer = await sharp({
            create: { width: 10, height: 10, channels: 3, background: "#204060" },
        }).png().toBuffer();
        const checksum = createHash("sha256").update(buffer).digest("hex");
        await writeFile(path.join(temporaryRoot, "one.png"), buffer);
        const result = await extractImages({
            html: '<p>題號：05012407</p><img src="one.png">',
            htmlPath: path.join(temporaryRoot, "source.html"),
            pdfImageRows: [],
            stableImages: { images: [], ambiguous: false },
            records: [{ number: "05012407", body: "" }],
            recordPages: [[]],
            ignoredImageChecksums: new Set(),
            preferPrecedingAssociation: true,
            allowDerivedHtmlImages: true,
            approvedQuestionImageMappings: [
                { checksum, questionNumber: "05012407", partStableKey: "1" },
            ],
        });

        assert.equal(result.imagesByRecord.get(0)[0].partStableKey, "1");
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("occurrence-aware image mappings reject invalid registries and source count drift", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanlin-part-occurrence-errors-"));
    try {
        const buffer = await sharp({
            create: { width: 10, height: 10, channels: 3, background: "#6080a0" },
        }).png().toBuffer();
        const checksum = createHash("sha256").update(buffer).digest("hex");
        await writeFile(path.join(temporaryRoot, "same.png"), buffer);
        const run = (html, mappings) => extractImages({
            html,
            htmlPath: path.join(temporaryRoot, "source.html"),
            pdfImageRows: [],
            stableImages: { images: [], ambiguous: false },
            records: [{ number: "05012410", body: "" }],
            recordPages: [[]],
            ignoredImageChecksums: new Set(),
            preferPrecedingAssociation: true,
            allowDerivedHtmlImages: true,
            approvedQuestionImageMappings: mappings,
        });
        const validMappings = [
            { checksum, questionNumber: "05012410", sourceOccurrence: 1, partStableKey: "1" },
            { checksum, questionNumber: "05012410", sourceOccurrence: 2, partStableKey: "2" },
        ];

        await assert.rejects(
            run('<p>題號：05012410</p><img src="same.png">', validMappings),
            /來源出現 1 次，核准映射需要 2 次/u,
        );
        await assert.rejects(
            run('<p>題號：05012410</p><img src="same.png"><img src="same.png"><img src="same.png">', validMappings),
            /來源出現次數超過核准映射/u,
        );
        await assert.rejects(
            run('<p>題號：05012410</p><img src="same.png">', [
                { checksum: "f".repeat(64), questionNumber: "05012410", sourceOccurrence: 1, partStableKey: "1" },
            ]),
            /來源出現 0 次，核准映射需要 1 次/u,
        );
        await assert.rejects(
            run('<p>題號：05012410</p><img src="same.png"><img src="same.png">', [
                { checksum, questionNumber: "05012410", sourceOccurrence: 1, partStableKey: "1" },
                { checksum, questionNumber: "05012410", sourceOccurrence: 3, partStableKey: "2" },
            ]),
            /sourceOccurrence 必須是連續且不重複/u,
        );
        await assert.rejects(
            run('<p>題號：05012410</p><img src="same.png"><img src="same.png">', [
                { checksum, questionNumber: "05012410", partStableKey: "1" },
                { checksum, questionNumber: "05012410", partStableKey: "2" },
            ]),
            /sourceOccurrence 必須是連續且不重複/u,
        );
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("part image ownership rejects incomplete, unknown, duplicate, or checksum-mismatched mappings", () => {
    const structured = { parts: ["1", "2", "3", "4"].map((stableKey) => ({ stableKey })) };
    const approvedMappings = ["1", "2", "3", "4"].map((partStableKey, index) => ({
        checksum: String(index + 1).repeat(64),
        questionNumber: "05012407",
        partStableKey,
    }));
    const images = approvedMappings.map(({ checksum, partStableKey }) => ({ checksum, partStableKey }));
    const validate = (mappings = approvedMappings, candidates = images) => validatePartImageOwnership({
        structured,
        images: candidates,
        approvedMappings: mappings,
        questionNumber: "05012407",
        fileName: "01_Starter Unit.doc",
    });

    assert.equal(validate(), true);
    assert.throws(() => validate(approvedMappings.slice(0, 3)), /缺少對應/u);
    assert.throws(() => validatePartImageOwnership({
        structured,
        images,
        approvedMappings: approvedMappings.map(({ partStableKey: _partStableKey, ...mapping }) => mapping),
        questionNumber: "05012407",
        fileName: "01_Starter Unit.doc",
        required: true,
    }), /缺少 partStableKey/u);
    assert.throws(() => validate(approvedMappings.map((mapping, index) =>
        index === 3 ? { ...mapping, partStableKey: "unknown" } : mapping)), /不存在的小題/u);
    assert.throws(() => validate(approvedMappings.map((mapping, index) =>
        index === 3 ? { ...mapping, partStableKey: "3" } : mapping)), /partStableKey 重複/u);
    assert.throws(() => validate(approvedMappings, images.map((image, index) =>
        index === 3 ? { ...image, checksum: "f".repeat(64) } : image)), /checksum 不符合/u);
});

test("part image ownership changes the fingerprint and produces part-local content blocks", () => {
    assert.equal(
        stripVerifiedNumberedPartLabels("看圖回答問題。\n\n(１)　\n(２)　\n(３)　\n(４)"),
        "看圖回答問題。",
    );
    const baseRecord = {
        originalType: "看圖回答問題",
        originalDifficulty: "中",
        originalCognitive: "",
        originalKnowledge: "",
        originalSource: "習作",
        structured: { prompt: "看圖回答問題。", parts: [], explanation: "" },
        tables: [],
        images: [{ checksum: "a".repeat(64), partStableKey: null }],
    };
    assert.notEqual(
        recordFingerprint(baseRecord),
        recordFingerprint({ ...baseRecord, images: [{ checksum: "a".repeat(64), partStableKey: "1" }] }),
    );

    const part = { stableKey: "1" };
    const blocks = buildPartImageContentBlocks({
        record: {
            images: [{
                checksum: "a".repeat(64),
                partStableKey: "1",
                assetId: "11111111-1111-4111-8111-111111111111",
                altText: "第 1 小題圖片",
            }],
        },
        revisionId: "22222222-2222-4222-8222-222222222222",
        part,
        partId: "33333333-3333-4333-8333-333333333333",
        startPosition: 2,
        fallbackAltText: "小題附圖",
    });
    assert.deepEqual(blocks.map((block) => ({
        question_part_id: block.question_part_id,
        placement: block.placement,
        content_type: block.content_type,
        position: block.position,
        asset_id: block.asset_id,
    })), [{
        question_part_id: "33333333-3333-4333-8333-333333333333",
        placement: "prompt",
        content_type: "image",
        position: 2,
        asset_id: "11111111-1111-4111-8111-111111111111",
    }]);
});

test("approved EMFs for one question keep mapping order without overwriting", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanlin-emf-order-"));
    try {
        const duplicatedDerivedBuffer = await sharp({
            create: { width: 12, height: 12, channels: 3, background: "#804020" },
        }).png().toBuffer();
        const duplicatedDerivedChecksum = createHash("sha256").update(duplicatedDerivedBuffer).digest("hex");
        await writeFile(path.join(temporaryRoot, "duplicate.png"), duplicatedDerivedBuffer);
        const approvedEmfImages = HANLIN_ENGLISH_APPROVED_EMF_IMAGE_MAPPINGS[
            "38288e2bec85304c669dce072738d57fe9610445f2a40da3ba3f7f829a9a4ecf"
        ].slice(0, 4).map((mapping, index) => ({
            ...mapping,
            replacesDerivedChecksum: index >= 2 ? duplicatedDerivedChecksum : mapping.replacesDerivedChecksum,
            buffer: Buffer.from(`image-${index}`),
            checksum: `rendered-${index}`,
            dimensions: { width: 10, height: 10 },
            extension: ".png",
            mimeType: "image/png",
            temporaryPath: path.join(temporaryRoot, `rendered-${index}.png`),
        }));

        const result = await extractImages({
            html: '<p>題號：05012275</p><img src="duplicate.png"><img src="duplicate.png">',
            htmlPath: path.join(temporaryRoot, "source.html"),
            pdfImageRows: [],
            stableImages: { images: [], ambiguous: false },
            records: [{ number: "05012275", body: "" }],
            recordPages: [[]],
            ignoredImageChecksums: new Set(),
            preferPrecedingAssociation: true,
            allowDerivedHtmlImages: true,
            approvedEmfImages,
        });

        assert.deepEqual(
            result.imagesByRecord.get(0).map(({ checksum, altText }) => ({ checksum, altText })),
            [
                { checksum: "rendered-0", altText: "才藝表 A" },
                { checksum: "rendered-1", altText: "才藝表 B" },
                { checksum: "rendered-2", altText: "才藝表 C" },
                { checksum: "rendered-3", altText: "才藝表 D" },
            ],
        );
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("approved EMF replacement removes the exact derived image even when HTML association drifts", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hanlin-emf-replacement-"));
    try {
        const replacedBuffer = await sharp({
            create: { width: 12, height: 12, channels: 3, background: "#202020" },
        }).png().toBuffer();
        const siblingBuffer = await sharp({
            create: { width: 14, height: 10, channels: 3, background: "#4080c0" },
        }).png().toBuffer();
        const replacedChecksum = createHash("sha256").update(replacedBuffer).digest("hex");
        const siblingChecksum = createHash("sha256").update(siblingBuffer).digest("hex");
        await writeFile(path.join(temporaryRoot, "replaced.png"), replacedBuffer);
        await writeFile(path.join(temporaryRoot, "sibling.png"), siblingBuffer);
        const approvedEmfImage = {
            ...HANLIN_ENGLISH_APPROVED_EMF_IMAGE_MAPPINGS[
                "38288e2bec85304c669dce072738d57fe9610445f2a40da3ba3f7f829a9a4ecf"
            ][0],
            replacesDerivedChecksum: replacedChecksum,
            buffer: Buffer.from("approved-emf"),
            checksum: "approved-render",
            dimensions: { width: 10, height: 10 },
            extension: ".png",
            mimeType: "image/png",
            temporaryPath: path.join(temporaryRoot, "approved.png"),
        };

        const result = await extractImages({
            html: '<img src="replaced.png"><p>題號：05012275</p><img src="sibling.png">',
            htmlPath: path.join(temporaryRoot, "source.html"),
            pdfImageRows: [],
            stableImages: { images: [], ambiguous: false },
            records: [{ number: "05012275", body: "" }],
            recordPages: [[]],
            ignoredImageChecksums: new Set(),
            preferPrecedingAssociation: true,
            allowDerivedHtmlImages: true,
            approvedEmfImages: [approvedEmfImage],
        });

        assert.deepEqual(
            result.imagesByRecord.get(0).map(({ checksum }) => checksum),
            ["approved-render", siblingChecksum],
        );
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("approved EMF raster output drops only the near-white outer canvas", async () => {
    const source = await sharp({
        create: { width: 12, height: 10, channels: 3, background: "#ffffff" },
    })
        .composite([{ input: { create: { width: 5, height: 4, channels: 3, background: "#303030" } }, left: 4, top: 3 }])
        .png()
        .toBuffer();

    const trimmed = await trimNearWhitePng(source);

    assert.equal(trimmed.width, 5);
    assert.equal(trimmed.height, 4);
    assert.deepEqual(await sharp(trimmed.buffer).metadata().then(({ format, width, height }) => ({ format, width, height })), {
        format: "png",
        width: 5,
        height: 4,
    });
});

test("visible image bounds flag a displaced drawing clipped by its canvas", async () => {
    const source = await sharp({
        create: { width: 40, height: 30, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } },
    })
        .composite([{ input: { create: { width: 10, height: 12, channels: 4, background: "#303030" } }, left: 30, top: 18 }])
        .png()
        .toBuffer();

    assert.deepEqual(await inspectVisibleImageBounds(source), {
        bounds: { left: 30, top: 18, right: 40, bottom: 30 },
        width: 40,
        height: 30,
        likelyOffsetClipped: true,
    });
});

test("social matching questions accept Chinese-labeled common options", () => {
    const parsed = parseParts([
        "請將文化與石器製作方法配對。",
        "(甲)打製石器　(乙)磨製石器",
        "(１)舊石器時代：【　　　　】。",
        "(２)新石器時代：【　　　　】。",
    ].join("\n"), "(１)(甲)；(２)(乙)");

    assert.deepEqual(parsed?.parts.map((part) => part.answer), ["(甲)打製石器", "(乙)磨製石器"]);
    assert.equal(parsed?.parts[0].options.length, 2);
});

test("verified visual matching labels can supply shared options without guessing from answers", () => {
    const parsed = parseParts([
        "附圖為地球上重要的地理經緯線位置，請填入正確的答案及代號。",
        "（　）(１)經過臺灣的重要緯線。",
        "（　）(２)國際標準時間的經線。",
        "（　）(３)南北半球分界線。",
        "（　）(４)經過時，日期需調整的界線。",
        "（　）(５)臺灣地方時區的中央經線。",
    ].join("\n"), "(１)(Ｂ)；(２)(Ｄ)；(３)(Ｃ)；(４)(Ｆ)；(５)(Ｅ)", {
        commonOptions: ["A", "B", "C", "D", "E", "F"].map((label) => ({ label, value: `(${label})` })),
    });

    assert.equal(parsed?.parts.length, 5);
    assert.deepEqual(parsed?.parts.map((part) => part.answer), ["(B)", "(D)", "(C)", "(F)", "(E)"]);
    assert.deepEqual(parsed?.parts[0].options, ["(A)", "(B)", "(C)", "(D)", "(E)", "(F)"]);
});

test("verified Word image choices require an exact sequential option-to-image mapping", () => {
    const record = {
        number: "05014000",
        type: "單題",
        body: "何人擁有參政權？\n(Ａ) (Ｂ) (Ｃ) (Ｄ)",
        sourceAnswer: "(D)",
    };
    const images = ["A", "B", "C", "D"].map((key) => ({
        checksum: key.repeat(64).toLowerCase(),
        placement: "prompt",
        detectedOptionKey: key,
    }));
    const repair = inferVerifiedImageChoiceRepair(record, images, true);
    assert.equal(repair?.answerKey, "D");
    assert.deepEqual(repair?.options.map((option) => option.key), ["A", "B", "C", "D"]);
    assert.deepEqual(repair?.options.map((option) => option.imageChecksum), images.map((image) => image.checksum));
    assert.equal(inferVerifiedImageChoiceRepair(record, images, false), null);
    assert.equal(inferVerifiedImageChoiceRepair(record, [...images, images[0]], true), null);
});

test("science anatomy terms do not trigger the missing-table guardrail", () => {
    assert.equal(VISUAL_REFERENCE.test("葉片的下表皮氣孔較多"), false);
    assert.equal(VISUAL_REFERENCE.test("請依下表回答問題"), true);
});

test("the approved math source correction preserves multiplication signs", () => {
    assert.equal(
        correctedQuestionBody({ number: "1501003429", body: "原始轉換文字" }),
        "小強將 a 做質因數分解，計算過程如下，則下列敘述何者正確？\n(A)d＝5＋7\n(B)c＝3×5\n(C)b＝2×3×5×7\n(D)a＝2×3×5×7",
    );
    assert.equal(correctedQuestionBody({ number: "other", body: " 保留文字 " }), "保留文字");
});

test("math formula gaps are held for source review instead of guessed as multiplication", () => {
    assert.equal(hasSuspiciousMissingMultiplicationSign("a＝2^(n) 3 5"), true);
    assert.equal(hasSuspiciousMissingMultiplicationSign("(B)10＝2 5"), true);
    assert.equal(hasSuspiciousMissingMultiplicationSign("可折抵650 10%＝65元"), true);
    assert.equal(hasSuspiciousMissingMultiplicationSign("(1) 3× 7＝21"), false);
    assert.equal(hasSuspiciousMissingMultiplicationSign("（2）31÷7＝4…2"), false);
    assert.equal(hasSuspiciousMissingMultiplicationSign("(3) 43 7＝301"), true);
    assert.equal(hasSuspiciousMissingMultiplicationSign("4 月 10 日下午 6 點"), false);
    assert.equal(hasSuspiciousMissingMultiplicationSign("5 1/5 與－5.2"), false);
    assert.equal(hasSuspiciousMissingMultiplicationSign("a＝11、b＝7"), false);
    assert.equal(hasSuspiciousMissingMultiplicationSign("2×3×5×7"), false);
});

test("a separated source page footer is removed without deleting legitimate numeric content", () => {
    assert.equal(
        stripTrailingSourcePageMarker("(3) 43×7＝301\n故最少需要301瓶\n\n1", 1),
        "(3) 43×7＝301\n故最少需要301瓶",
    );
    assert.equal(stripTrailingSourcePageMarker("最後答案是1", 1), "最後答案是1");
    assert.equal(stripTrailingSourcePageMarker("第一行\n1", 1), "第一行\n1");
    assert.equal(stripTrailingSourcePageMarker("解析\n\n2", 1), "解析\n\n2");
    assert.equal(stripTrailingSourcePageMarker("解析\n\n1", 28), "解析\n\n1");
    assert.equal(
        stripTrailingSourcePageMarker("解析\n\n1", 28, { isLastRecord: true }),
        "解析",
    );
});

test("fragmented Word superscripts are merged only when no baseline operand separates them", () => {
    assert.equal(mergeFragmentedMathScripts("7^(2)^(＋3)＝7^(5)"), "7^(2＋3)＝7^(5)");
    assert.equal(mergeFragmentedMathScripts("10^(3)× ^(5)＝10^(15)"), "10^(3×5)＝10^(15)");
    assert.equal(
        mergeFragmentedMathScripts("(－1)^(n)^(＋)^(n)^(＋1)＋1"),
        "(－1)^(n＋n＋1)＋1",
    );
    assert.equal(mergeFragmentedMathScripts("(2^(3))^(2)"), "(2^(3))^(2)");
    assert.equal(mergeFragmentedMathScripts("2^(3)× 5^(5)"), "2^(3)× 5^(5)");
    assert.equal(hasFragmentedMathScript("7^(2)^(＋3)"), true);
    assert.equal(hasFragmentedMathScript("10^(3)× ^(5)"), true);
    assert.equal(hasFragmentedMathScript("7^(2＋3)"), false);
    assert.equal(hasFragmentedMathScript("(2^(3))^(2)"), false);
});

test("empty, bare, and unclosed math scripts remain pending instead of publishing damaged formulas", () => {
    assert.equal(hasMalformedMathScript("( )÷^()"), true);
    assert.equal(hasMalformedMathScript("(-1)^n"), true);
    assert.equal(hasMalformedMathScript("2^(3"), true);
    assert.equal(hasMalformedMathScript("2^(3＋2)"), false);
    assert.equal(hasMalformedMathScript("a_(n＋1)"), false);
});

test("written-part parsing never treats parenthesized exponents as question numbers", () => {
    assert.deepEqual(
        parseWrittenParts(
            "(1)比較2^(12)與3^(8)。(2)比較4^(4)與8^(3)。",
            "(1)3^(8)較大。(2)8^(3)較大。",
        ),
        [
            { id: "1", prompt: "比較2^(12)與3^(8)。", answer: "3^(8)較大。" },
            { id: "2", prompt: "比較4^(4)與8^(3)。", answer: "8^(3)較大。" },
        ],
    );
});

test("only individually source-verified math spacing false positives bypass the formula guardrail", () => {
    assert.equal(isApprovedMissingMultiplicationFalsePositive("1501000032"), true);
    assert.equal(isApprovedMissingMultiplicationFalsePositive("1501005654"), true);
    assert.equal(isApprovedMissingMultiplicationFalsePositive("1501004386"), false);
    assert.equal(isApprovedMissingMultiplicationFalsePositive("1501005035"), false);
    assert.equal(isApprovedMissingMultiplicationFalsePositive("unknown"), false);
});

test("the verified legacy math glyph checksum restores only the multiplication sign", () => {
    assert.equal(
        approvedInlineMathImageText("03ba98dde16628b75c1caa26b510fb8195dd2ba44492dec8820fff01573e71c8"),
        "×",
    );
    assert.equal(approvedInlineMathImageText("0".repeat(64)), null);
});

function verifiedFormulaSourceFixture() {
    // Captured from the approved document through prepareHanlinChineseImport.
    const checksums = [
        "1bd94b90f73806974b5f8c4ecc658e5e435d4798c0f6b118687079b921413690",
        "747e89852f61ec65edf509f6820757d1479395ba781f2fcc4effe52c56556914",
        "c15d88598d5d77b9ee95b0c80352f39826bddebf05953198e411df16cabf97ec",
        "125cb5cc4948b05f1ad53bfc4b87f6463e5f710ead091e09d49969b59b9207d9",
        "ce6623edc2e66ef0cd3d713992bee94c4d0a2b120540d988c31f134fe064a1f6",
        "59282f0183a5f930d3adb7c26f7a07d20af31914408cb5d13265d47f5c618946",
        "dd405866ce21d7dcd8a820c6f79697fd5338abd69c67605cc2c4c9b2563f1b6a",
        "4e25c3b43fa4f8367451d040e4b4aaef8f3a5c52d39ee96e3d08bc0b568ac82f",
        "1d1f0282284dfdae92734229416bb42ad5c0c363486682e2d647358da3a3c1a8",
        "8f32bf856a3fc9a1feef630a7ae5f373f2614bedf3e7728b6d4158e3c4cb741f",
        "35639d634a66af784494d0dc642ade91c626975a44f019f7ff04365cf7a32839",
        "8e2a7cc5fb2bec2455a120de2ec80207bd7dfb20c044e82160c93a2a0df3d958",
    ];
    const formula = (index) => `－⟦未解析公式圖:${checksums[index]}⟧`;
    return {
        record: {
            number: "1501005679",
            body: `計算${[0, 1, 2, 3].map(formula).join(" ")} 的值。`,
            sourceAnswer: formula(11),
            explanation: [
                `原式＝${[0, 4, 5, 6].map(formula).join(" ")}`,
                `＝${[7, 8, 9, 6].map(formula).join(" ")}`,
                `＝${formula(10)}`,
                `＝${formula(11)}`,
                "",
                "1",
            ].join("\n"),
        },
        context: {
            sourceSha256: "50b1f60f5a722042dea5429edfac8f694d273ac7160f74f3ea4a9229e2b916f0",
            sourcePage: 16,
            inlineImageChecksums: new Set(checksums),
        },
    };
}

test("1501005679 restores every verified formula while preserving the source record", () => {
    const { record, context } = verifiedFormulaSourceFixture();
    const original = structuredClone(record);
    const corrected = correctVerifiedKangxuanMathFormula(record, context);
    assert.equal(corrected.body, "計算－\\frac{1}{2} －\\frac{1}{2²} －\\frac{1}{2³} －\\frac{1}{2⁴} 的值。");
    assert.equal(corrected.sourceAnswer, "－\\frac{15}{16}");
    assert.equal(corrected.explanation, [
        "原式＝－\\frac{1}{2} －\\frac{1}{4} －\\frac{1}{8} －\\frac{1}{16}",
        "＝－\\frac{8}{16} －\\frac{4}{16} －\\frac{2}{16} －\\frac{1}{16}",
        "＝－\\frac{8＋4＋2＋1}{16}",
        "＝－\\frac{15}{16}",
        "",
        "1",
    ].join("\n"));
    assert.deepEqual(record, original);
    assert.equal(approvedInlineMathImageText([...context.inlineImageChecksums].at(-1)), null);
    const unrelated = { ...record, number: "1501005678" };
    assert.equal(correctVerifiedKangxuanMathFormula(unrelated, context), unrelated);
});

test("1501005679 refuses a different source SHA, ambiguous page, changed raw preimage or missing answer checksum", () => {
    const { record, context } = verifiedFormulaSourceFixture();
    const reject = (candidate = record, candidateContext = context) => assert.throws(
        () => correctVerifiedKangxuanMathFormula(candidate, candidateContext),
        (error) => error.code === "APPROVED_FORMULA_SOURCE_MISMATCH",
    );
    reject(record, { ...context, sourceSha256: "0".repeat(64) });
    reject(record, { ...context, sourcePage: 15 });
    reject(record, { ...context, sourcePage: null });
    reject({ ...record, body: `${record.body} ` });
    reject({ ...record, explanation: record.explanation.replace(/\n\n1$/u, "") });
    reject({ ...record, sourceAnswer: record.sourceAnswer.replace(/[a-f0-9]{64}/u, "0".repeat(64)) });
    reject(record, { ...context, inlineImageChecksums: new Set() });
});

async function readRepositoryFile(relativePath) {
    return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("a formal import refuses any source other than an authorized lesson file before file I/O", () => {
    const result = spawnSync(process.execPath, [
        path.join(repositoryRoot, "scripts", "import-hanlin-chinese-postgres.mjs"),
        path.join(os.tmpdir(), "not-an-authorized-lesson.doc"),
    ], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: process.env,
    });

    assert.equal(result.status, 1);
    const summary = JSON.parse(result.stdout.trim());
    assert.equal(summary.failed, 1);
    assert.equal(summary.failedFiles[0].code, "WRITE_SCOPE_REQUIRES_APPROVED_LESSON_FILE");
    assert.match(summary.failedFiles[0].message, new RegExp(AUTHORIZED_FOURTH_LESSON_FILE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("a formal import refuses different content renamed to an authorized lesson file", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "lerniqa-import-scope-"));
    const lookalikePath = path.join(temporaryDirectory, AUTHORIZED_FOURTH_LESSON_FILE);
    try {
        await writeFile(lookalikePath, "synthetic non-approved Word content", "utf8");
        const result = spawnSync(process.execPath, [
            path.join(repositoryRoot, "scripts", "import-hanlin-chinese-postgres.mjs"),
            lookalikePath,
        ], {
            cwd: repositoryRoot,
            encoding: "utf8",
            env: process.env,
        });

        assert.equal(result.status, 1);
        const summary = JSON.parse(result.stdout.trim());
        assert.equal(summary.failed, 1);
        assert.equal(summary.failedFiles[0].code, "WRITE_SCOPE_REQUIRES_APPROVED_LESSON_CONTENT");
        assert.match(AUTHORIZED_FOURTH_LESSON_SHA256, /^[0-9a-f]{64}$/u);
    }
    finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

test("the approved lesson manifest keeps separate targets, counts, checksums, and a narrowly scoped decorative image exception", () => {
    assert.deepEqual(
        AUTHORIZED_HANLIN_LESSON_IMPORTS.filter((entry) =>
            entry.target.publisherCode === "hanlin" && entry.target.subjectCode === "chinese").map((entry) => ({
            unit: entry.target.unitCode,
            position: entry.target.unitPosition,
            count: entry.expectedQuestionCount,
        })),
        [
            { unit: "lesson-4", position: 4, count: 279 },
            { unit: "lesson-5", position: 5, count: 280 },
            { unit: "lesson-6", position: 6, count: 258 },
            { unit: "language-knowledge-2", position: 7, count: 76 },
            { unit: "lesson-4", position: 4, count: 24 },
            { unit: "lesson-5", position: 5, count: 14 },
            { unit: "lesson-6", position: 6, count: 17 },
            { unit: "language-knowledge-2", position: 7, count: 7 },
            { unit: "lesson-4", position: 4, count: 8 },
            { unit: "lesson-6", position: 6, count: 9 },
            { unit: "language-knowledge-2", position: 7, count: 7 },
            { unit: "lesson-4", position: 4, count: 11 },
            { unit: "lesson-5", position: 5, count: 2 },
            { unit: "lesson-6", position: 6, count: 10 },
            { unit: "language-knowledge-2", position: 7, count: 13 },
            { unit: "lesson-4", position: 4, count: 11 },
            { unit: "lesson-5", position: 5, count: 11 },
            { unit: "lesson-6", position: 6, count: 11 },
            { unit: "language-knowledge-2", position: 7, count: 8 },
            { unit: "language-knowledge-2", position: 7, count: 40 },
        ],
    );
    for (const entry of AUTHORIZED_HANLIN_LESSON_IMPORTS) {
        assert.match(entry.originalSha256, /^[0-9a-f]{64}$/u);
    }
    const mathEntries = AUTHORIZED_HANLIN_LESSON_IMPORTS.filter((entry) =>
        entry.target.publisherCode === "kangxuan" && entry.target.subjectCode === "math");
    assert.ok(mathEntries
        .filter((entry) => entry.target.key.startsWith("jh1-math-kangxuan-v1-u2-"))
        .every((entry) => entry.parserVersion === "kangxuan-math-doc-v9"));
    assert.equal(mathEntries.length, 11);
    assert.equal(mathEntries.reduce((total, entry) => total + entry.expectedQuestionCount, 0), 1020);
    const scienceEntries = AUTHORIZED_HANLIN_LESSON_IMPORTS.filter((entry) =>
        entry.target.publisherCode === "kangxuan" && entry.target.subjectCode === "biology");
    assert.equal(scienceEntries.length, 40);
    assert.equal(scienceEntries.reduce((total, entry) => total + entry.expectedQuestionCount, 0), 777);
    assert.equal(scienceEntries.reduce((total, entry) => total + entry.expectedPublishedCount, 0), 759);
    assert.equal(scienceEntries.reduce((total, entry) => total + entry.expectedPendingReviewCount, 0), 18);
    assert.ok(scienceEntries.every((entry) => entry.parserVersion === "kangxuan-science-doc-v2"));
    const scienceSyncThreeTwo = scienceEntries.find((entry) =>
        entry.target.sourceCategoryCode === "synchronized-practice"
        && entry.target.unitCode === "chapter-3-2");
    assert.equal(scienceSyncThreeTwo?.approvedChoiceRepairs[0]?.questionNumber, "1501001293");
    assert.equal(scienceSyncThreeTwo?.approvedChoiceRepairs[0]?.answerKey, "D");
    const englishEntries = AUTHORIZED_HANLIN_LESSON_IMPORTS.filter((entry) =>
        entry.target.publisherCode === "hanlin" && entry.target.subjectCode === "english");
    assert.equal(englishEntries.length, 43);
    assert.equal(englishEntries.reduce((total, entry) => total + entry.expectedQuestionCount, 0), 2643);
    assert.equal(englishEntries.reduce((total, entry) => total + entry.expectedPublishedCount, 0), 2643);
    assert.ok(englishEntries.every((entry) => ["hanlin-en-v5", "hanlin-en-v9", "hanlin-en-v10", "hanlin-en-v12", "hanlin-en-v13"].includes(entry.parserVersion)
        && entry.expectedPendingReviewCount === 0));
    assert.equal(englishEntries.filter((entry) => entry.parserVersion === "hanlin-en-v9").length, 4);
    assert.equal(englishEntries.filter((entry) => entry.parserVersion === "hanlin-en-v10").length, 1);
    assert.equal(englishEntries.filter((entry) => entry.parserVersion === "hanlin-en-v12").length, 1);
    assert.equal(englishEntries.filter((entry) => entry.parserVersion === "hanlin-en-v13").length, 8);
    const starterTestEntry = englishEntries.find((entry) =>
        entry.originalSha256 === "f95c59ad0917520d063363cfefbcd5dc04d94b70ebb7cd126a032d683a140ec0");
    assert.deepEqual(starterTestEntry?.approvedQuestionImageMappings.map(({ checksum, questionNumber }) => ({
        checksum,
        questionNumber,
    })), [
        { checksum: "e93ef9e874ec182d721cf94a1d2b1aa07f5d0baceba4ceeacfc02b3c232b42aa", questionNumber: "05010088" },
        { checksum: "41f8787933737b1b4716880c0eba5d3e3f03dc28f48303eb01e40796fe426896", questionNumber: "05010089" },
        { checksum: "e79eef08b41b567201d59d4d2c41d34374a391e83f9ada3318db6a1a5cca923b", questionNumber: "05010090" },
    ]);
    const englishImageEntry = englishEntries.find((entry) =>
        entry.originalSha256 === "e04e5b593258d20cdf1c3e75c5fcaed33cb62040744874571bf621d1095ec20e");
    assert.equal(englishImageEntry?.approvedQuestionImageMappings.length, 4);
    assert.equal(englishImageEntry?.approvedChoiceRepairs[0]?.answerKey, "B");
    assert.ok(mathEntries.every((entry) => entry.target.subjectCode === "math"
        && entry.parserStyle === "metadata-first"));
    const factorsEntry = mathEntries.find((entry) =>
        entry.originalSha256 === "ffb7d287b28b4eb6b3bd1fdd7b266e11a7b2f10c55a249e77c41074b04b8d5dc");
    assert.deepEqual(factorsEntry?.approvedQuestionImageMappings, [
        { checksum: "28cfed3d74f8f7334440b0a88b86c3e86f3cf7ca77fd8c9a99474d9751cf4b8f", questionNumber: "1501003429" },
    ]);
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[0].approvedDecorativeImageSha256s, []);
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[1].approvedDecorativeImageSha256s, []);
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[2].approvedDecorativeImageSha256s, [
        "cf335ba0de1c4025f416ca1932e9b2de5a815a72e98c87ac9f0d7be2d283ded8",
    ]);
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[3].approvedDecorativeImageSha256s, []);
    assert.equal(AUTHORIZED_HANLIN_LESSON_IMPORTS[3].expectedPublishedCount, 75);
    assert.equal(AUTHORIZED_HANLIN_LESSON_IMPORTS[3].expectedPendingReviewCount, 1);
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[3].approvedQuestionImageMappings, [
        { checksum: "7feccd462d1aab57c8b8df78caa19c8fcd71852ae1bdc473652076a67118e71c", questionNumber: "05011868" },
        { checksum: "eb4a540dc515923087e6e0f41b86265f09e3f2a95a26a2125ac1cb4aa37320a2", questionNumber: "05011869" },
    ]);
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[3].unresolvedImageQuestionNumbers, ["05011838"]);
    for (const entry of AUTHORIZED_HANLIN_LESSON_IMPORTS.slice(4, 8)) {
        assert.equal(entry.target.sourceCategoryCode, "literacy-question");
        assert.equal(entry.target.sourceCategoryName, "素養題");
        assert.ok(entry.approvedQuestionImageMappings.length > 0);
    }
    assert.equal(AUTHORIZED_HANLIN_LESSON_IMPORTS[4].expectedPublishedCount, 24);
    assert.equal(AUTHORIZED_HANLIN_LESSON_IMPORTS[4].expectedPendingReviewCount, 0);
    assert.deepEqual(
        AUTHORIZED_HANLIN_LESSON_IMPORTS[4].approvedQuestionImageMappings
            .filter((mapping) => mapping.questionNumber === "05013285")
            .map((mapping) => mapping.optionKey),
        ["A", "B", "C", "D"],
    );
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[4].approvedChoiceRepairs, [{
        questionNumber: "05013285",
        answerKey: "B",
        options: [
            { key: "A", text: "圖表 A", imageChecksum: "9981dd9151c4097c6a47c0db44a84e1ad632cee6c37330cc765231134e730d81" },
            { key: "B", text: "圖表 B", imageChecksum: "a7d1bbfa1b98adcaf02c6e42c07a44b78ccc15c52c75eb251f7cf263bb1ea6dc" },
            { key: "C", text: "圖表 C", imageChecksum: "b9a8f883214587ed5654803c9fd099f360b5f6505d02d3a75d9572ca4746bd00" },
            { key: "D", text: "圖表 D", imageChecksum: "5afa3ffbf561463af9c4fe2cd9125ff897082160595b03926b7637052337c9d7" },
        ],
    }]);
    for (const entry of AUTHORIZED_HANLIN_LESSON_IMPORTS.slice(8, 11)) {
        assert.equal(entry.target.sourceCategoryCode, "basic-competency-test");
        assert.equal(entry.target.sourceCategoryName, "基測");
    }
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[10].approvedQuestionImageMappings, [
        { checksum: "8f497c1c45aaf297558eef7c8030f8b2a2e58c5752ed8495970073aeb867119e", questionNumber: "05013137" },
    ]);
    for (const entry of AUTHORIZED_HANLIN_LESSON_IMPORTS.slice(11, 15)) {
        assert.equal(entry.target.sourceCategoryCode, "comprehensive-assessment");
        assert.equal(entry.target.sourceCategoryName, "會考");
    }
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[14].approvedQuestionImageMappings, [
        { checksum: "9714f98a8427c6f33d6797fd48da5aef8821daf8f026b9a0e6fb20cb43c72b2f", questionNumber: "05013175" },
        { checksum: "16f5f00fb5cf0886286e8ac494a6a241410c9fd7ea9d1d58e2a7d3862b3adf2c", questionNumber: "05013176" },
    ]);
    for (const entry of AUTHORIZED_HANLIN_LESSON_IMPORTS.slice(15, 19)) {
        assert.equal(entry.target.sourceCategoryCode, "textbook-classroom");
        assert.equal(entry.target.sourceCategoryName, "課本隨堂");
    }
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[18].approvedQuestionImageMappings, [
        { checksum: "ee52a468557fb02c5cf26cdd585c663e029b0d0bb3fff3d4096ff841ba88a8ff", questionNumber: "05013570" },
    ]);
    assert.equal(AUTHORIZED_HANLIN_LESSON_IMPORTS[19].target.sourceCategoryCode, "publisher-test-bank");
    assert.equal(AUTHORIZED_HANLIN_LESSON_IMPORTS[19].expectedPublishedCount, 40);
    assert.equal(AUTHORIZED_HANLIN_LESSON_IMPORTS[19].expectedPendingReviewCount, 0);
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[19].approvedQuestionImageMappings, [
        { checksum: "4ec38651486731332a6bf527f52a0ebef0379abea2b57de0212d5262c09e737a", questionNumber: "05013843", optionKey: "A", altText: "對話 A：弟子祝夫子生日快樂，夫子道謝" },
        { checksum: "3369396cb51b4451c7273736ba0e7c010d8bab9e15d297e2eb177b7c079ed3e6", questionNumber: "05013843", optionKey: "B", altText: "對話 B：他人稱讚高足的表現，對方回答過譽了" },
        { checksum: "d916500d2862bd8afde2fab0ba52af5b8c9654a6d2c1216158cc82e706cddf58", questionNumber: "05013843", optionKey: "C", altText: "對話 C：受業想再多多請教，夫子回答沒問題" },
        { checksum: "5f51d55bc0184e1f440c4df152439ae7536c50ddba32e3fcf5cdab782c3bf9f9", questionNumber: "05013843", optionKey: "D", altText: "對話 D：弟子感謝講述並表示受益匪淺" },
    ]);
    assert.deepEqual(
        AUTHORIZED_HANLIN_LESSON_IMPORTS[19].approvedChoiceRepairs.map((repair) => [repair.questionNumber, repair.answerKey]),
        [["05013836", "D"], ["05013843", "B"]],
    );
});

test("the importer snapshots one stable byte sequence before conversion and quarantine", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "lerniqa-import-snapshot-"));
    const sourcePath = path.join(temporaryDirectory, "source.doc");
    const snapshotPath = path.join(temporaryDirectory, "snapshot.doc");
    try {
        await writeFile(sourcePath, "first stable byte sequence", "utf8");
        const snapshot = await snapshotWordDocument(sourcePath, snapshotPath, "source.doc");
        await writeFile(sourcePath, "replacement source content", "utf8");

        assert.equal(await readFile(snapshot.snapshotPath, "utf8"), "first stable byte sequence");
        assert.equal(snapshot.byteSize, Buffer.byteLength("first stable byte sequence"));
        assert.match(snapshot.sha256, /^[0-9a-f]{64}$/u);
    }
    finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

test("the parser removes known legacy Word sequence fields but preserves ordinary leading numbers", () => {
    assert.equal(PARSER_VERSION, "hanlin-zh-doc-v7");
    assert.equal(
        stripLegacyWordSequenceFieldPrefixes("\\S\\do 9(１)１\\S\\do 9(１))\\S\\do 9(１)子曰：學而時習之。"),
        "子曰：學而時習之。",
    );
    assert.equal(
        stripLegacyWordSequenceFieldPrefixes("\\S\\do 0(６６\\S\\do 0(６\\S\\do 0(６休養性情最好的方式之一便是讀書。"),
        "休養性情最好的方式之一便是讀書。",
    );
    assert.equal(stripLegacyWordSequenceFieldPrefixes("2026 年的題目內容"), "2026 年的題目內容");
});

test("legacy Word drawings without an embedded image relationship are treated as placeholders", () => {
    const xml = [
        '<wp:inline><wp:docPr id="1" name="Image7"></wp:docPr><a:blip></a:blip></wp:inline>',
        '<wp:inline><wp:docPr id="2" name="Image8"/><a:blip r:embed="rId8"/></wp:inline>',
        '<wp:anchor><wp:docPr id="3" name="Image9"/><a:blip/></wp:anchor>',
    ].join("");

    assert.deepEqual([...legacyMissingImageNames(xml)], ["Image7", "Image9"]);
});

test("the parser retains cognitive and knowledge dimensions as separate source fields", () => {
    const records = parseMetadataLast([
        "單一選擇題",
        "下列何者正確？",
        "答案：A",
        "編號：05010001",
        "難易度：易",
        "出處：試題",
        "認知向度：基本語文知識",
        "知識向度：正確用字",
        "課名：第一課",
    ].join("\n"), ["單一選擇題"], "source.doc");

    assert.equal(records.length, 1);
    assert.equal(records[0].cognitive, "基本語文知識");
    assert.equal(records[0].knowledge, "正確用字");
});

test("the parser converts legacy Wingdings arrows without changing genuine Latin text", () => {
    assert.equal(normalizeLegacyWordSymbolArrows("(Ａ)蘊\uf0e0慍(Ｃ)譯\uf0e0繹"), "(Ａ)蘊→慍(Ｃ)譯→繹");
    assert.equal(normalizeLegacyWordSymbolArrows("(Ａ)塭à溫(Ｃ)祟à崇"), "(Ａ)塭→溫(Ｃ)祟→崇");
    assert.equal(normalizeLegacyWordSymbolArrows("(Ａ)ㄅㄧㄣˋàㄅㄧㄣ"), "(Ａ)ㄅㄧㄣˋ→ㄅㄧㄣ");
    assert.equal(normalizeLegacyWordSymbolArrows("Voilà, à la carte"), "Voilà, à la carte");
});

test("the PostgreSQL writer keeps the repaired parameter casts and parser-versioned classification identities", async () => {
    const writer = await readRepositoryFile("scripts/lib/hanlin-postgres-writer.mjs");

    assert.match(writer, /SET status = \$2::varchar\(20\)/);
    assert.match(writer, /CASE WHEN \$2::varchar\(20\) = 'confirmed'/);
    assert.ok(writer.includes("classification-candidate:${document.sourceDocumentId}:${plan.parserVersion}:unit:${document.originalTitle}"));
    assert.ok(writer.includes("classification-candidate:${document.sourceDocumentId}:${plan.parserVersion}:${dimension}:approved:${targetId}"));
    assert.ok(writer.includes("withdrawPublishedQuestionForPendingGroup"));
    assert.ok(writer.includes("batch.created_at = $3"));
    assert.ok(writer.includes("SET status = 'archived'"));
    assert.ok(writer.includes("plan.correction.expectedCurrentRevisionId"));
    assert.ok(writer.includes("question.current_revision_id !== plan.correction.expectedCurrentRevisionId"));
    assert.ok(writer.includes("未覆寫較新的修訂"));
    assert.match(writer, /review_status = 'approved'[\s\S]*AND id <> \$4/);
    assert.match(writer, /review_status = 'pending'[\s\S]*question_revision_id IS NULL/);
    assert.match(writer, /existing\?\.status === "confirmed"/);
    assert.match(writer, /key: "cognitive_dimension", name: "認知向度"/);
    assert.match(writer, /key: "knowledge_dimension", name: "知識向度"/);
    assert.match(writer, /question_revision_filter_values/);
    assert.match(writer, /record\.approvedForReactivation === true/);
    assert.match(writer, /isApprovedMissingMultiplicationFalsePositive\(record\.sourceQuestionNumber\)/);
    assert.match(writer, /SET status = 'draft', archived_at = NULL/);
    assert.match(writer, /SET current_revision_id = \$2, status = 'published', archived_at = NULL/);
});

test("database and writer contracts retain answer integrity, rollback, source snapshots, and original classification evidence", async () => {
    const [importLibrary, writer, migration, migrationTest, verifier] = await Promise.all([
        readRepositoryFile("scripts/lib/hanlin-chinese-import.mjs"),
        readRepositoryFile("scripts/lib/hanlin-postgres-writer.mjs"),
        readRepositoryFile("database/migrations/0007_practice_answer_integrity.up.sql"),
        readRepositoryFile("database/tests/0007_practice_answer_integrity.sql"),
        readRepositoryFile("scripts/verify-local-practice.mjs"),
    ]);

    assert.match(migration, /question_answers_choice_option_check/);
    assert.match(migration, /option\.option_key = answer\.answer_key/);
    assert.match(migrationTest, /SET answer_key = 'UNKNOWN'/);
    assert.match(migrationTest, /WHEN check_violation THEN/);

    assert.match(writer, /await client\.query\("BEGIN"\)/);
    assert.match(writer, /await client\.query\("ROLLBACK"\)/);
    assert.match(importLibrary, /const sourceSnapshot = await snapshotWordDocument\(/);
    assert.match(importLibrary, /sourcePath = sourceSnapshot\.snapshotPath/);
    assert.match(importLibrary, /copyVerified\(document\.sourcePath, quarantineDestination, document\.originalSha256\)/);
    assert.match(importLibrary, /if \(tag\.missingImagePlaceholder\) continue;/);
    assert.match(importLibrary, /if \(!inspection\) \{[\s\S]*candidateIndexes\.forEach\(\(index\) => pendingIndexes\.add\(index\)\);[\s\S]*continue;/);
    assert.match(writer, /originalUnit: record\.originalUnit/);
    assert.match(writer, /raw_value: document\.originalTitle/);
    assert.match(verifier, /ORIGINAL_UNIT_METADATA_MISSING/);
    assert.match(verifier, /IMPORT_SOURCE_SCOPE_MISMATCH/);
    assert.match(verifier, /IMPORT_SOURCE_CHECKSUM_MISMATCH/);
    assert.match(verifier, /QUARANTINE_SOURCE_CHECKSUM_MISMATCH/);
});
