import { createHash } from "node:crypto";
import { copyFile, link, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import {
    VISUAL_REFERENCE,
    cleanText,
    parseAnswerLetters,
    parseMetadataFirst,
    parseMetadataLast,
    parseOptions,
    parseParts,
    parseWrittenParts,
} from "../import-grade-seven-fixtures.mjs";

export const PARSER_VERSION = "hanlin-zh-doc-v6";
export const SANITIZER_VERSION = "libreoffice-macro-disabled-docx-v1";
export const AUTHORIZED_FOURTH_LESSON_FILE = "05_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc";
export const AUTHORIZED_FOURTH_LESSON_SHA256 = "c2b09d04ef9e0a32a2fbe71a8f8e930d2061fb87e78bb6bc60f694df6be8cfb2";
export const AUTHORIZED_FIFTH_LESSON_FILE = "06_第五課_背影.doc";
export const AUTHORIZED_FIFTH_LESSON_SHA256 = "0b03109efbcb0b5d540dad97fb0865c560970c0d239df94ad0b9b894c9c6122c";
export const AUTHORIZED_SIXTH_LESSON_FILE = "07_第六課_心囚.doc";
export const AUTHORIZED_SIXTH_LESSON_SHA256 = "0ef11f041367d443b2507c6878d576aadf0e783cf0471c9ff78c021497090c2c";
export const AUTHORIZED_LANGUAGE_KNOWLEDGE_TWO_FILE = "08_語文常識（二）閱讀導航－－策略運用與資訊檢索.doc";
export const AUTHORIZED_LANGUAGE_KNOWLEDGE_TWO_SHA256 = "bb39eab9e7c2d37c97dcc81f8703922fe377032d1d64e246c8c4d22318ac0cbd";
export const AUTHORIZED_LITERACY_FOURTH_LESSON_FILE = "04_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc";
export const AUTHORIZED_LITERACY_FOURTH_LESSON_SHA256 = "8ef8951a7995b7252cd8de151495f12fd4e4c72f3e26a17d27b9b57b94004a77";
export const AUTHORIZED_LITERACY_FIFTH_LESSON_FILE = "05_第五課_背影.doc";
export const AUTHORIZED_LITERACY_FIFTH_LESSON_SHA256 = "afb54454f45058dc3f2657c49895cf64b79b9d7e1e7d28916f51a96839a8a4d5";
export const AUTHORIZED_LITERACY_SIXTH_LESSON_FILE = "06_第六課_心囚.doc";
export const AUTHORIZED_LITERACY_SIXTH_LESSON_SHA256 = "6b0a869e7bb9d46fd7cc220432111a941427b5d7337c258c0d3baa5856fb0233";
export const AUTHORIZED_LITERACY_LANGUAGE_KNOWLEDGE_TWO_FILE = "07_語文常識（二）閱讀導航－－策略運用與資訊檢索.doc";
export const AUTHORIZED_LITERACY_LANGUAGE_KNOWLEDGE_TWO_SHA256 = "06e0bc07ad575899b0ab3d2a127b6fc2f9d4b0634e76544d609116f30f58d279";
export const AUTHORIZED_BCT_FOURTH_LESSON_FILE = "04_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc";
export const AUTHORIZED_BCT_FOURTH_LESSON_SHA256 = "dee4ad3f2843fbdd49380ce4c37c5d1f952556442d6b66fe0387e7d8730803e6";
export const AUTHORIZED_BCT_SIXTH_LESSON_FILE = "05_第六課_心囚.doc";
export const AUTHORIZED_BCT_SIXTH_LESSON_SHA256 = "eb70667300a02d69acf459c2dda3cd6e1e549368a67098cc5b4ef003803a85d6";
export const AUTHORIZED_BCT_LANGUAGE_KNOWLEDGE_TWO_FILE = "06_語文常識（二）閱讀導航－－策略運用與資訊檢索.doc";
export const AUTHORIZED_BCT_LANGUAGE_KNOWLEDGE_TWO_SHA256 = "6e9d050cb27023eafdbecd3809b0ecc74559e7d1cc5b05ddf4a0301cbb6e0676";
export const AUTHORIZED_CAP_FOURTH_LESSON_FILE = "05_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc";
export const AUTHORIZED_CAP_FOURTH_LESSON_SHA256 = "d14c8c6d2bfe119e524fe75eb66d60d32f9efff39dd81ad6a97e385e7b4a1df8";
export const AUTHORIZED_CAP_FIFTH_LESSON_FILE = "06_第五課_背影.doc";
export const AUTHORIZED_CAP_FIFTH_LESSON_SHA256 = "538d552ff977e2ecfa408208455896e8929ccc68c4e41b7d8623dbf8464c24c4";
export const AUTHORIZED_CAP_SIXTH_LESSON_FILE = "07_第六課_心囚.doc";
export const AUTHORIZED_CAP_SIXTH_LESSON_SHA256 = "1d78d1907993fdd09181a0c4996a80e007c5df7f30e4971f4856757b61263a92";
export const AUTHORIZED_CAP_LANGUAGE_KNOWLEDGE_TWO_FILE = "08_語文常識（二）閱讀導航－－策略運用與資訊檢索.doc";
export const AUTHORIZED_CAP_LANGUAGE_KNOWLEDGE_TWO_SHA256 = "e1211e0b7055e6df1141ee879113edba5b52f406842e0e526bf429bf01e8b551";
export const AUTHORIZED_CLASSROOM_FOURTH_LESSON_FILE = "05_第四課_論語選（一）子游問孝（二）譬如為山（三）三省吾身.doc";
export const AUTHORIZED_CLASSROOM_FOURTH_LESSON_SHA256 = "42fe3e93376a878ebdba25c850c1f72f2000d65564aaffb74e9a1a1b6e625668";
export const AUTHORIZED_CLASSROOM_FIFTH_LESSON_FILE = "06_第五課_背影.doc";
export const AUTHORIZED_CLASSROOM_FIFTH_LESSON_SHA256 = "f2139fbb7de74a244913fb46726d86799c054dc7caab9da502d4e666b141da68";
export const AUTHORIZED_CLASSROOM_SIXTH_LESSON_FILE = "07_第六課_心囚.doc";
export const AUTHORIZED_CLASSROOM_SIXTH_LESSON_SHA256 = "2c24d90503e0e5deaaf1ba996cc6d4b0500ba4bd9d6fbbbda7293a4cabd2f5f3";
export const AUTHORIZED_CLASSROOM_LANGUAGE_KNOWLEDGE_TWO_FILE = "08_語文常識（二）閱讀導航－－策略運用與資訊檢索.doc";
export const AUTHORIZED_CLASSROOM_LANGUAGE_KNOWLEDGE_TWO_SHA256 = "a2e7f63cb2dfb4f30be9845263b35eb1d816bf50ed5f80206d9ff86897140209";
export const AUTHORIZED_LANGUAGE_FOUNDATION_EXAM_FILE = "02_語文常識（二）閱讀導航－－策略運用與資訊檢索.doc";
export const AUTHORIZED_LANGUAGE_FOUNDATION_EXAM_SHA256 = "8d0789f35174cda2124609f08909bc79d1a79a7d62c64d405db6b056309c3ec8";
export const HANLIN_CHINESE_TYPES = [
    "寫出國字、注音",
    "注釋",
    "改錯題",
    "填充題",
    "配合題",
    "單一選擇題",
    "選詞測驗",
    "題組",
];
export const KANGXUAN_MATH_TYPES = ["選擇", "填充", "計算"];
export const KANGXUAN_MATH_WRITTEN_TYPES = ["會考非選擇題"];

export const TARGET_CLASSIFICATION = Object.freeze({
    key: "jh1-zh-hanlin-v1-l4",
    gradeCode: "junior-high-1",
    gradeName: "國一",
    semesterCode: "semester-1",
    semesterName: "上學期",
    subjectCode: "chinese",
    subjectName: "國語",
    subjectAlias: "國文",
    publisherCode: "hanlin",
    publisherName: "翰林",
    bookName: "第一冊",
    volumeCode: "volume-1",
    volumeName: "第一冊",
    unitCode: "lesson-4",
    unitName: "第四課",
    sourceCategoryCode: "publisher-test-bank",
    sourceCategoryName: "出版社題庫",
});

function lessonTarget(lessonNumber, unitName) {
    return Object.freeze({
        ...TARGET_CLASSIFICATION,
        key: `jh1-zh-hanlin-v1-l${lessonNumber}`,
        unitCode: `lesson-${lessonNumber}`,
        unitName,
        unitPosition: lessonNumber,
    });
}

function unitTarget(unitCode, unitName, unitPosition) {
    return Object.freeze({
        ...TARGET_CLASSIFICATION,
        key: `jh1-zh-hanlin-v1-${unitCode}`,
        unitCode,
        unitName,
        unitPosition,
    });
}

function literacyTarget(target) {
    return Object.freeze({
        ...target,
        key: `jh1-zh-hanlin-v1-${target.unitCode === "language-knowledge-2" ? "lk2" : `l${target.unitPosition}`}-lit`,
        sourceCategoryCode: "literacy-question",
        sourceCategoryName: "素養題",
    });
}

function basicCompetencyTarget(target) {
    return Object.freeze({
        ...target,
        key: `jh1-zh-hanlin-v1-${target.unitCode === "language-knowledge-2" ? "lk2" : `l${target.unitPosition}`}-bct`,
        sourceCategoryCode: "basic-competency-test",
        sourceCategoryName: "基測",
    });
}

function comprehensiveAssessmentTarget(target) {
    return Object.freeze({
        ...target,
        key: `jh1-zh-hanlin-v1-${target.unitCode === "language-knowledge-2" ? "lk2" : `l${target.unitPosition}`}-cap`,
        sourceCategoryCode: "comprehensive-assessment",
        sourceCategoryName: "會考",
    });
}

function classroomPracticeTarget(target) {
    return Object.freeze({
        ...target,
        key: `jh1-zh-hanlin-v1-${target.unitCode === "language-knowledge-2" ? "lk2" : `l${target.unitPosition}`}-classroom`,
        sourceCategoryCode: "textbook-classroom",
        sourceCategoryName: "課本隨堂",
    });
}

const UUID_NAMESPACE = "a14dc152-b0c8-4c88-93e6-17c4e5171cc9";

function namespaceBytes(namespace) {
    return Buffer.from(namespace.replaceAll("-", ""), "hex");
}

/** 產生 RFC 4122 UUID v5，讓同一來源重跑時使用完全相同的識別碼。 */
export function deterministicUuid(name) {
    const hash = createHash("sha1")
        .update(namespaceBytes(UUID_NAMESPACE))
        .update(String(name), "utf8")
        .digest()
        .subarray(0, 16);
    hash[6] = (hash[6] & 0x0f) | 0x50;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const value = hash.toString("hex");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export const LOCAL_CATALOG_IDS = Object.freeze({
    gradeId: deterministicUuid("catalog:grade:junior-high-1"),
    semesterId: deterministicUuid("catalog:semester:semester-1"),
    publisherId: deterministicUuid("catalog:publisher:hanlin"),
    subjectId: deterministicUuid("catalog:subject:chinese"),
    subjectAliasId: deterministicUuid("catalog:subject-alias:chinese:國文"),
    bookVersionId: deterministicUuid("catalog:book:chinese:junior-high-1:hanlin:volume-1"),
    volumeUnitId: deterministicUuid("catalog:unit:hanlin:chinese:volume-1"),
    targetUnitId: deterministicUuid("catalog:unit:hanlin:chinese:volume-1:lesson-4"),
    questionBankId: deterministicUuid("local-practice:question-bank:default"),
    sourceCategoryId: deterministicUuid("catalog:source-category:publisher-test-bank"),
    questionTypeChoiceId: deterministicUuid("catalog:question-type:single-choice"),
    questionTypeMultiId: deterministicUuid("catalog:question-type:multi-choice"),
    questionTypeWrittenId: deterministicUuid("catalog:question-type:written"),
    difficultyBasicId: deterministicUuid("catalog:difficulty:basic"),
    difficultyIntermediateId: deterministicUuid("catalog:difficulty:intermediate"),
    difficultyAdvancedId: deterministicUuid("catalog:difficulty:advanced"),
});

export function catalogIdsForTarget(target) {
    return Object.freeze({
        ...LOCAL_CATALOG_IDS,
        publisherId: deterministicUuid(`catalog:publisher:${target.publisherCode}`),
        subjectId: deterministicUuid(`catalog:subject:${target.subjectCode}`),
        subjectAliasId: deterministicUuid(`catalog:subject-alias:${target.subjectCode}:${target.subjectAlias}`),
        bookVersionId: deterministicUuid(`catalog:book:${target.subjectCode}:${target.gradeCode}:${target.publisherCode}:${target.volumeCode}`),
        volumeUnitId: deterministicUuid(`catalog:unit:${target.publisherCode}:${target.subjectCode}:${target.volumeCode}`),
        targetUnitId: deterministicUuid(`catalog:unit:${target.publisherCode}:${target.subjectCode}:${target.volumeCode}:${target.unitCode}`),
        sourceCategoryId: deterministicUuid(`catalog:source-category:${target.sourceCategoryCode}`),
    });
}

const KANGXUAN_MATH_BASE_TARGET = Object.freeze({
    gradeCode: "junior-high-1",
    gradeName: "國一",
    semesterCode: "semester-1",
    semesterName: "上學期",
    subjectCode: "math",
    subjectName: "數學",
    subjectAlias: "數學",
    publisherCode: "kangxuan",
    publisherName: "康軒",
    bookName: "第一冊",
    volumeCode: "volume-1",
    volumeName: "第一冊",
});

const KANGXUAN_MATH_21_BANK_IMAGE_MAPPINGS = Object.freeze([
    Object.freeze({
        checksum: "28cfed3d74f8f7334440b0a88b86c3e86f3cf7ca77fd8c9a99474d9751cf4b8f",
        questionNumber: "1501003429",
    }),
]);

function kangxuanMathTarget(unitNumber, unitName, sourceCategoryCode, sourceCategoryName, suffix) {
    return Object.freeze({
        ...KANGXUAN_MATH_BASE_TARGET,
        key: `jh1-math-kangxuan-v1-u2-${unitNumber}-${suffix}`,
        unitCode: `chapter-2-${unitNumber}`,
        unitName: `2-${unitNumber} ${unitName}`,
        unitPosition: 20 + unitNumber,
        sourceCategoryCode,
        sourceCategoryName,
    });
}

const KANGXUAN_MATH_DOCUMENTS = Object.freeze([
    ["2-1　因數與倍數.doc", "ffb7d287b28b4eb6b3bd1fdd7b266e11a7b2f10c55a249e77c41074b04b8d5dc", 279, 1, "因數與倍數", "publisher-test-bank", "出版社題庫", "bank", KANGXUAN_MATH_21_BANK_IMAGE_MAPPINGS],
    ["2-2　最大公因數與最小公倍數.doc", "dcd9300bdcf16c516bee272f789267ebdb11d59eb14c92092293baed9d3486d9", 244, 2, "最大公因數與最小公倍數"],
    ["2-3　分數的四則運算.doc", "372f14612c6c4d0a12a2c55e04dea006da2f558f4e80eb5c082e7da2b9c91989", 340, 3, "分數的四則運算"],
    ["2-4　指數律.doc", "50b1f60f5a722042dea5429edfac8f694d273ac7160f74f3ea4a9229e2b916f0", 134, 4, "指數律"],
    ["2-1　因數與倍數.doc", "cfab24dd33aad60ae456e88b072b89ba854e1551f3e38f451e8bf08899bb4ed8", 2, 1, "因數與倍數", "literacy-question", "素養題", "literacy"],
    ["2-2　最大公因數與最小公倍數.doc", "09483494fbc26339109b9c0fcc93606e11345d786bebaaaa9b0d4eae5c0dd1c9", 2, 2, "最大公因數與最小公倍數", "literacy-question", "素養題", "literacy"],
    ["2-3　分數的四則運算.doc", "d1bbce4ddc479be19a76439fafee89e4ecbb70c22c821e753a6996beb6c92fd5", 6, 3, "分數的四則運算", "literacy-question", "素養題", "literacy"],
    ["2-1　因數與倍數.doc", "05af8ac3292610edfc99a9fc9216b80f4f5ed6bcf8de6564d8bd75ba9db0dcab", 8, 1, "因數與倍數", "mock-comprehensive-written", "仿會考非選題", "mock-cap"],
    ["2-2　最大公因數與最小公倍數.doc", "dcd3fd60affea85d45e8014866f9ee8ffa95f638dca4b5ccc71c5f6f35736742", 1, 2, "最大公因數與最小公倍數", "mock-comprehensive-written", "仿會考非選題", "mock-cap"],
    ["2-3　分數的四則運算.doc", "8580c6aab7daa197f801b706cc3ec642f22b1c9451baa80048b3a2fd45c43399", 3, 3, "分數的四則運算", "mock-comprehensive-written", "仿會考非選題", "mock-cap"],
    ["2-4　指數律.doc", "c42e74824672f630256c159d54021f90ccd554b8447e6871905208c69d32bbfb", 1, 4, "指數律", "mock-comprehensive-written", "仿會考非選題", "mock-cap"],
]);

const SIXTH_LESSON_DECORATIVE_BORDER_SHA256 = "cf335ba0de1c4025f416ca1932e9b2de5a815a72e98c87ac9f0d7be2d283ded8";
const LANGUAGE_KNOWLEDGE_TWO_TARGET = unitTarget("language-knowledge-2", "語文常識（二）", 7);
const LANGUAGE_KNOWLEDGE_TWO_IMAGE_MAPPINGS = Object.freeze([
    Object.freeze({ checksum: "7feccd462d1aab57c8b8df78caa19c8fcd71852ae1bdc473652076a67118e71c", questionNumber: "05011868" }),
    Object.freeze({ checksum: "eb4a540dc515923087e6e0f41b86265f09e3f2a95a26a2125ac1cb4aa37320a2", questionNumber: "05011869" }),
]);
const LITERACY_FOURTH_LESSON_TARGET = literacyTarget(Object.freeze({ ...TARGET_CLASSIFICATION, unitPosition: 4 }));
const LITERACY_FIFTH_LESSON_TARGET = literacyTarget(lessonTarget(5, "第五課"));
const LITERACY_SIXTH_LESSON_TARGET = literacyTarget(lessonTarget(6, "第六課"));
const LITERACY_LANGUAGE_KNOWLEDGE_TWO_TARGET = literacyTarget(LANGUAGE_KNOWLEDGE_TWO_TARGET);
const LITERACY_FOURTH_LESSON_IMAGE_MAPPINGS = Object.freeze([
    Object.freeze({ checksum: "c78be3ce81ac5f6880d79cd1239b74cc77c29a22db28061ddab758e9912ede97", questionNumber: "05013283" }),
    Object.freeze({ checksum: "f55151335dcec97bf720382ff0448f4ce0d8e734a9551816c5b198e354b98269", questionNumber: "05013284" }),
    Object.freeze({ checksum: "9981dd9151c4097c6a47c0db44a84e1ad632cee6c37330cc765231134e730d81", questionNumber: "05013285", optionKey: "A", altText: "圖表 A：稻穗的結實程度與稻子垂下後的高度呈正比" }),
    Object.freeze({ checksum: "a7d1bbfa1b98adcaf02c6e42c07a44b78ccc15c52c75eb251f7cf263bb1ea6dc", questionNumber: "05013285", optionKey: "B", altText: "圖表 B：人的內涵程度與人的身段高度呈反比" }),
    Object.freeze({ checksum: "b9a8f883214587ed5654803c9fd099f360b5f6505d02d3a75d9572ca4746bd00", questionNumber: "05013285", optionKey: "C", altText: "圖表 C：人的內涵程度與人的身段高度呈正比" }),
    Object.freeze({ checksum: "5afa3ffbf561463af9c4fe2cd9125ff897082160595b03926b7637052337c9d7", questionNumber: "05013285", optionKey: "D", altText: "圖表 D：人的身段高度與稻子垂下後的高度呈反比" }),
]);
const LITERACY_FOURTH_LESSON_CHOICE_REPAIRS = Object.freeze([
    Object.freeze({
        questionNumber: "05013285",
        answerKey: "B",
        options: Object.freeze([
            Object.freeze({ key: "A", text: "圖表 A", imageChecksum: "9981dd9151c4097c6a47c0db44a84e1ad632cee6c37330cc765231134e730d81" }),
            Object.freeze({ key: "B", text: "圖表 B", imageChecksum: "a7d1bbfa1b98adcaf02c6e42c07a44b78ccc15c52c75eb251f7cf263bb1ea6dc" }),
            Object.freeze({ key: "C", text: "圖表 C", imageChecksum: "b9a8f883214587ed5654803c9fd099f360b5f6505d02d3a75d9572ca4746bd00" }),
            Object.freeze({ key: "D", text: "圖表 D", imageChecksum: "5afa3ffbf561463af9c4fe2cd9125ff897082160595b03926b7637052337c9d7" }),
        ]),
    }),
]);
const LITERACY_FIFTH_LESSON_IMAGE_MAPPINGS = Object.freeze([
    Object.freeze({ checksum: "ee95e83484f2cbca1937e6648a5cc92d87fb13bcdaa8e60a998a71e8f2d8e3a2", questionNumber: "05013292" }),
    Object.freeze({ checksum: "34cb35c7a71b327ef9a49fed1101121a11714d5ce746d773ac07c37394306b90", questionNumber: "05013293" }),
    Object.freeze({ checksum: "c5c1296048dd775b8bccbef6d5af336d7d9db46bc7eb2d960a5a20e05807e48a", questionNumber: "05013295" }),
    Object.freeze({ checksum: "60641f1e193d8d2a1001f968fc6fd0ac1ce21f034e1a72ee6c432f9bb3a8d1b1", questionNumber: "05013297" }),
    Object.freeze({ checksum: "52348f820d72db4083b5000e93f74bc9c6abe251a57bd8d579922a0aa1c910e2", questionNumber: "05013298" }),
    Object.freeze({ checksum: "8f4a661f1320887deb52c7531b7f53591b190c815296129d5f752492ec16c6e8", questionNumber: "05013298" }),
]);
const LITERACY_SIXTH_LESSON_IMAGE_MAPPINGS = Object.freeze([
    Object.freeze({ checksum: "f6e85ac0dda3d116e24b0e2f206c1ef235c9823a3475dc869c5a714b75537cf4", questionNumber: "05013305" }),
    Object.freeze({ checksum: "190436fb46abefb68635af1135372b8748919bd945e409e09773dfd6b1dc63cb", questionNumber: "05013308" }),
    Object.freeze({ checksum: "c5a550a342b82d0b5c0b96d47e2635ccf3d1a89d71a7c85116004327defa9268", questionNumber: "05013316" }),
    Object.freeze({ checksum: "2c7e57a87871a1b09506f74daf920e74d60205f515f4ae076cd5d249b0a7289e", questionNumber: "05013317" }),
]);
const LITERACY_LANGUAGE_KNOWLEDGE_TWO_IMAGE_MAPPINGS = Object.freeze([
    Object.freeze({ checksum: "bdf7d59a1a58f8eee0f34dc42b1b2f302b1c91370c125c759c21de701522fe18", questionNumber: "05013320" }),
    Object.freeze({ checksum: "a58f8ab28c2f70a3e8ec0d53fbcc1f4014bbf27ac422385695d0242d5a014fa5", questionNumber: "05013321" }),
    Object.freeze({ checksum: "a5f58fd3bf7eb9161e47da7fc1781d990b6894123cbae012b457f61d0fc47bf2", questionNumber: "05013323" }),
    Object.freeze({ checksum: "09e553a7aafd79199b309a26e83ac0656e4457911f712461c35fe0890f91a925", questionNumber: "05013325" }),
    Object.freeze({ checksum: "39a59cfc16d5bb500bb59ef84583f1fe30db83e05a524b8fd6d300a6ff213f6f", questionNumber: "05013326" }),
]);
const BCT_FOURTH_LESSON_TARGET = basicCompetencyTarget(Object.freeze({ ...TARGET_CLASSIFICATION, unitPosition: 4 }));
const BCT_SIXTH_LESSON_TARGET = basicCompetencyTarget(lessonTarget(6, "第六課"));
const BCT_LANGUAGE_KNOWLEDGE_TWO_TARGET = basicCompetencyTarget(LANGUAGE_KNOWLEDGE_TWO_TARGET);
const BCT_LANGUAGE_KNOWLEDGE_TWO_IMAGE_MAPPINGS = Object.freeze([
    Object.freeze({ checksum: "8f497c1c45aaf297558eef7c8030f8b2a2e58c5752ed8495970073aeb867119e", questionNumber: "05013137" }),
]);
const CAP_FOURTH_LESSON_TARGET = comprehensiveAssessmentTarget(Object.freeze({ ...TARGET_CLASSIFICATION, unitPosition: 4 }));
const CAP_FIFTH_LESSON_TARGET = comprehensiveAssessmentTarget(lessonTarget(5, "第五課"));
const CAP_SIXTH_LESSON_TARGET = comprehensiveAssessmentTarget(lessonTarget(6, "第六課"));
const CAP_LANGUAGE_KNOWLEDGE_TWO_TARGET = comprehensiveAssessmentTarget(LANGUAGE_KNOWLEDGE_TWO_TARGET);
const CAP_LANGUAGE_KNOWLEDGE_TWO_IMAGE_MAPPINGS = Object.freeze([
    Object.freeze({ checksum: "9714f98a8427c6f33d6797fd48da5aef8821daf8f026b9a0e6fb20cb43c72b2f", questionNumber: "05013175" }),
    Object.freeze({ checksum: "16f5f00fb5cf0886286e8ac494a6a241410c9fd7ea9d1d58e2a7d3862b3adf2c", questionNumber: "05013176" }),
]);
const CLASSROOM_FOURTH_LESSON_TARGET = classroomPracticeTarget(Object.freeze({ ...TARGET_CLASSIFICATION, unitPosition: 4 }));
const CLASSROOM_FIFTH_LESSON_TARGET = classroomPracticeTarget(lessonTarget(5, "第五課"));
const CLASSROOM_SIXTH_LESSON_TARGET = classroomPracticeTarget(lessonTarget(6, "第六課"));
const CLASSROOM_LANGUAGE_KNOWLEDGE_TWO_TARGET = classroomPracticeTarget(LANGUAGE_KNOWLEDGE_TWO_TARGET);
const CLASSROOM_LANGUAGE_KNOWLEDGE_TWO_IMAGE_MAPPINGS = Object.freeze([
    Object.freeze({ checksum: "ee52a468557fb02c5cf26cdd585c663e029b0d0bb3fff3d4096ff841ba88a8ff", questionNumber: "05013570" }),
]);
const LANGUAGE_FOUNDATION_EXAM_TARGET = Object.freeze({
    ...LANGUAGE_KNOWLEDGE_TWO_TARGET,
    key: "jh1-zh-hanlin-v1-lk2-lang-exam",
});
const LANGUAGE_FOUNDATION_EXAM_IMAGE_MAPPINGS = Object.freeze([
    Object.freeze({ checksum: "4ec38651486731332a6bf527f52a0ebef0379abea2b57de0212d5262c09e737a", questionNumber: "05013843", optionKey: "A", altText: "對話 A：弟子祝夫子生日快樂，夫子道謝" }),
    Object.freeze({ checksum: "3369396cb51b4451c7273736ba0e7c010d8bab9e15d297e2eb177b7c079ed3e6", questionNumber: "05013843", optionKey: "B", altText: "對話 B：他人稱讚高足的表現，對方回答過譽了" }),
    Object.freeze({ checksum: "d916500d2862bd8afde2fab0ba52af5b8c9654a6d2c1216158cc82e706cddf58", questionNumber: "05013843", optionKey: "C", altText: "對話 C：受業想再多多請教，夫子回答沒問題" }),
    Object.freeze({ checksum: "5f51d55bc0184e1f440c4df152439ae7536c50ddba32e3fcf5cdab782c3bf9f9", questionNumber: "05013843", optionKey: "D", altText: "對話 D：弟子感謝講述並表示受益匪淺" }),
]);
const LANGUAGE_FOUNDATION_EXAM_CHOICE_REPAIRS = Object.freeze([
    Object.freeze({
        questionNumber: "05013836",
        answerKey: "D",
        options: Object.freeze([
            Object.freeze({ key: "A", text: "鞠躬盡瘁／殫精竭慮：╳" }),
            Object.freeze({ key: "B", text: "披荊斬棘／裹足不前：○" }),
            Object.freeze({ key: "C", text: "半途而廢／鍥而不捨：○" }),
            Object.freeze({ key: "D", text: "左支右絀／綽綽有餘：╳" }),
        ]),
    }),
    Object.freeze({
        questionNumber: "05013843",
        answerKey: "B",
        options: Object.freeze([
            Object.freeze({ key: "A", text: "對話 A", imageChecksum: "4ec38651486731332a6bf527f52a0ebef0379abea2b57de0212d5262c09e737a" }),
            Object.freeze({ key: "B", text: "對話 B", imageChecksum: "3369396cb51b4451c7273736ba0e7c010d8bab9e15d297e2eb177b7c079ed3e6" }),
            Object.freeze({ key: "C", text: "對話 C", imageChecksum: "d916500d2862bd8afde2fab0ba52af5b8c9654a6d2c1216158cc82e706cddf58" }),
            Object.freeze({ key: "D", text: "對話 D", imageChecksum: "5f51d55bc0184e1f440c4df152439ae7536c50ddba32e3fcf5cdab782c3bf9f9" }),
        ]),
    }),
]);

export const AUTHORIZED_HANLIN_LESSON_IMPORTS = Object.freeze([
    Object.freeze({
        fileName: AUTHORIZED_FOURTH_LESSON_FILE,
        originalSha256: AUTHORIZED_FOURTH_LESSON_SHA256,
        expectedQuestionCount: 279,
        target: Object.freeze({ ...TARGET_CLASSIFICATION, unitPosition: 4 }),
        ids: LOCAL_CATALOG_IDS,
        approvedDecorativeImageSha256s: Object.freeze([]),
    }),
    Object.freeze({
        fileName: AUTHORIZED_FIFTH_LESSON_FILE,
        originalSha256: AUTHORIZED_FIFTH_LESSON_SHA256,
        expectedQuestionCount: 280,
        target: lessonTarget(5, "第五課"),
        ids: catalogIdsForTarget(lessonTarget(5, "第五課")),
        approvedDecorativeImageSha256s: Object.freeze([]),
    }),
    Object.freeze({
        fileName: AUTHORIZED_SIXTH_LESSON_FILE,
        originalSha256: AUTHORIZED_SIXTH_LESSON_SHA256,
        expectedQuestionCount: 258,
        target: lessonTarget(6, "第六課"),
        ids: catalogIdsForTarget(lessonTarget(6, "第六課")),
        approvedDecorativeImageSha256s: Object.freeze([SIXTH_LESSON_DECORATIVE_BORDER_SHA256]),
    }),
    Object.freeze({
        fileName: AUTHORIZED_LANGUAGE_KNOWLEDGE_TWO_FILE,
        originalSha256: AUTHORIZED_LANGUAGE_KNOWLEDGE_TWO_SHA256,
        expectedQuestionCount: 76,
        expectedPublishedCount: 75,
        expectedPendingReviewCount: 1,
        target: LANGUAGE_KNOWLEDGE_TWO_TARGET,
        ids: catalogIdsForTarget(LANGUAGE_KNOWLEDGE_TWO_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
        approvedQuestionImageMappings: LANGUAGE_KNOWLEDGE_TWO_IMAGE_MAPPINGS,
        unresolvedImageQuestionNumbers: Object.freeze(["05011838"]),
    }),
    Object.freeze({
        fileName: AUTHORIZED_LITERACY_FOURTH_LESSON_FILE,
        originalSha256: AUTHORIZED_LITERACY_FOURTH_LESSON_SHA256,
        expectedQuestionCount: 24,
        expectedPublishedCount: 24,
        expectedPendingReviewCount: 0,
        target: LITERACY_FOURTH_LESSON_TARGET,
        ids: catalogIdsForTarget(LITERACY_FOURTH_LESSON_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
        approvedQuestionImageMappings: LITERACY_FOURTH_LESSON_IMAGE_MAPPINGS,
        approvedChoiceRepairs: LITERACY_FOURTH_LESSON_CHOICE_REPAIRS,
    }),
    Object.freeze({
        fileName: AUTHORIZED_LITERACY_FIFTH_LESSON_FILE,
        originalSha256: AUTHORIZED_LITERACY_FIFTH_LESSON_SHA256,
        expectedQuestionCount: 14,
        target: LITERACY_FIFTH_LESSON_TARGET,
        ids: catalogIdsForTarget(LITERACY_FIFTH_LESSON_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
        approvedQuestionImageMappings: LITERACY_FIFTH_LESSON_IMAGE_MAPPINGS,
    }),
    Object.freeze({
        fileName: AUTHORIZED_LITERACY_SIXTH_LESSON_FILE,
        originalSha256: AUTHORIZED_LITERACY_SIXTH_LESSON_SHA256,
        expectedQuestionCount: 17,
        target: LITERACY_SIXTH_LESSON_TARGET,
        ids: catalogIdsForTarget(LITERACY_SIXTH_LESSON_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
        approvedQuestionImageMappings: LITERACY_SIXTH_LESSON_IMAGE_MAPPINGS,
    }),
    Object.freeze({
        fileName: AUTHORIZED_LITERACY_LANGUAGE_KNOWLEDGE_TWO_FILE,
        originalSha256: AUTHORIZED_LITERACY_LANGUAGE_KNOWLEDGE_TWO_SHA256,
        expectedQuestionCount: 7,
        target: LITERACY_LANGUAGE_KNOWLEDGE_TWO_TARGET,
        ids: catalogIdsForTarget(LITERACY_LANGUAGE_KNOWLEDGE_TWO_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
        approvedQuestionImageMappings: LITERACY_LANGUAGE_KNOWLEDGE_TWO_IMAGE_MAPPINGS,
    }),
    Object.freeze({
        fileName: AUTHORIZED_BCT_FOURTH_LESSON_FILE,
        originalSha256: AUTHORIZED_BCT_FOURTH_LESSON_SHA256,
        expectedQuestionCount: 8,
        target: BCT_FOURTH_LESSON_TARGET,
        ids: catalogIdsForTarget(BCT_FOURTH_LESSON_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
    }),
    Object.freeze({
        fileName: AUTHORIZED_BCT_SIXTH_LESSON_FILE,
        originalSha256: AUTHORIZED_BCT_SIXTH_LESSON_SHA256,
        expectedQuestionCount: 9,
        target: BCT_SIXTH_LESSON_TARGET,
        ids: catalogIdsForTarget(BCT_SIXTH_LESSON_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
    }),
    Object.freeze({
        fileName: AUTHORIZED_BCT_LANGUAGE_KNOWLEDGE_TWO_FILE,
        originalSha256: AUTHORIZED_BCT_LANGUAGE_KNOWLEDGE_TWO_SHA256,
        expectedQuestionCount: 7,
        target: BCT_LANGUAGE_KNOWLEDGE_TWO_TARGET,
        ids: catalogIdsForTarget(BCT_LANGUAGE_KNOWLEDGE_TWO_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
        approvedQuestionImageMappings: BCT_LANGUAGE_KNOWLEDGE_TWO_IMAGE_MAPPINGS,
    }),
    Object.freeze({
        fileName: AUTHORIZED_CAP_FOURTH_LESSON_FILE,
        originalSha256: AUTHORIZED_CAP_FOURTH_LESSON_SHA256,
        expectedQuestionCount: 11,
        target: CAP_FOURTH_LESSON_TARGET,
        ids: catalogIdsForTarget(CAP_FOURTH_LESSON_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
    }),
    Object.freeze({
        fileName: AUTHORIZED_CAP_FIFTH_LESSON_FILE,
        originalSha256: AUTHORIZED_CAP_FIFTH_LESSON_SHA256,
        expectedQuestionCount: 2,
        target: CAP_FIFTH_LESSON_TARGET,
        ids: catalogIdsForTarget(CAP_FIFTH_LESSON_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
    }),
    Object.freeze({
        fileName: AUTHORIZED_CAP_SIXTH_LESSON_FILE,
        originalSha256: AUTHORIZED_CAP_SIXTH_LESSON_SHA256,
        expectedQuestionCount: 10,
        target: CAP_SIXTH_LESSON_TARGET,
        ids: catalogIdsForTarget(CAP_SIXTH_LESSON_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
    }),
    Object.freeze({
        fileName: AUTHORIZED_CAP_LANGUAGE_KNOWLEDGE_TWO_FILE,
        originalSha256: AUTHORIZED_CAP_LANGUAGE_KNOWLEDGE_TWO_SHA256,
        expectedQuestionCount: 13,
        target: CAP_LANGUAGE_KNOWLEDGE_TWO_TARGET,
        ids: catalogIdsForTarget(CAP_LANGUAGE_KNOWLEDGE_TWO_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
        approvedQuestionImageMappings: CAP_LANGUAGE_KNOWLEDGE_TWO_IMAGE_MAPPINGS,
    }),
    Object.freeze({
        fileName: AUTHORIZED_CLASSROOM_FOURTH_LESSON_FILE,
        originalSha256: AUTHORIZED_CLASSROOM_FOURTH_LESSON_SHA256,
        expectedQuestionCount: 11,
        target: CLASSROOM_FOURTH_LESSON_TARGET,
        ids: catalogIdsForTarget(CLASSROOM_FOURTH_LESSON_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
    }),
    Object.freeze({
        fileName: AUTHORIZED_CLASSROOM_FIFTH_LESSON_FILE,
        originalSha256: AUTHORIZED_CLASSROOM_FIFTH_LESSON_SHA256,
        expectedQuestionCount: 11,
        target: CLASSROOM_FIFTH_LESSON_TARGET,
        ids: catalogIdsForTarget(CLASSROOM_FIFTH_LESSON_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
    }),
    Object.freeze({
        fileName: AUTHORIZED_CLASSROOM_SIXTH_LESSON_FILE,
        originalSha256: AUTHORIZED_CLASSROOM_SIXTH_LESSON_SHA256,
        expectedQuestionCount: 11,
        target: CLASSROOM_SIXTH_LESSON_TARGET,
        ids: catalogIdsForTarget(CLASSROOM_SIXTH_LESSON_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
    }),
    Object.freeze({
        fileName: AUTHORIZED_CLASSROOM_LANGUAGE_KNOWLEDGE_TWO_FILE,
        originalSha256: AUTHORIZED_CLASSROOM_LANGUAGE_KNOWLEDGE_TWO_SHA256,
        expectedQuestionCount: 8,
        target: CLASSROOM_LANGUAGE_KNOWLEDGE_TWO_TARGET,
        ids: catalogIdsForTarget(CLASSROOM_LANGUAGE_KNOWLEDGE_TWO_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
        approvedQuestionImageMappings: CLASSROOM_LANGUAGE_KNOWLEDGE_TWO_IMAGE_MAPPINGS,
    }),
    Object.freeze({
        fileName: AUTHORIZED_LANGUAGE_FOUNDATION_EXAM_FILE,
        originalSha256: AUTHORIZED_LANGUAGE_FOUNDATION_EXAM_SHA256,
        expectedQuestionCount: 40,
        expectedPublishedCount: 40,
        expectedPendingReviewCount: 0,
        target: LANGUAGE_FOUNDATION_EXAM_TARGET,
        ids: catalogIdsForTarget(LANGUAGE_FOUNDATION_EXAM_TARGET),
        approvedDecorativeImageSha256s: Object.freeze([]),
        approvedQuestionImageMappings: LANGUAGE_FOUNDATION_EXAM_IMAGE_MAPPINGS,
        approvedChoiceRepairs: LANGUAGE_FOUNDATION_EXAM_CHOICE_REPAIRS,
    }),
    ...KANGXUAN_MATH_DOCUMENTS.map(([
        fileName,
        originalSha256,
        expectedQuestionCount,
        unitNumber,
        unitName,
        sourceCategoryCode = "publisher-test-bank",
        sourceCategoryName = "出版社題庫",
        suffix = "bank",
        approvedQuestionImageMappings = [],
    ]) => {
        const target = kangxuanMathTarget(
            unitNumber,
            unitName,
            sourceCategoryCode,
            sourceCategoryName,
            suffix,
        );
        return Object.freeze({
            fileName,
            originalSha256,
            expectedQuestionCount,
            target,
            ids: catalogIdsForTarget(target),
            parserStyle: "metadata-first",
            parserVersion: "kangxuan-math-doc-v1",
            questionTypes: suffix === "mock-cap" ? KANGXUAN_MATH_WRITTEN_TYPES : KANGXUAN_MATH_TYPES,
            approvedDecorativeImageSha256s: Object.freeze([]),
            approvedQuestionImageMappings,
        });
    }),
]);

export function authorizedHanlinLessonByFileName(fileName) {
    const normalized = String(fileName ?? "").normalize("NFC");
    return AUTHORIZED_HANLIN_LESSON_IMPORTS.find((entry) => entry.fileName.normalize("NFC") === normalized) ?? null;
}

export function authorizedHanlinImportByFileAndHash(fileName, originalSha256) {
    const normalized = String(fileName ?? "").normalize("NFC");
    return AUTHORIZED_HANLIN_LESSON_IMPORTS.find((entry) =>
        entry.fileName.normalize("NFC") === normalized && entry.originalSha256 === originalSha256) ?? null;
}

export class HanlinImportError extends Error {
    constructor(code, message, fileName = null) {
        super(message);
        this.name = "HanlinImportError";
        this.code = code;
        this.fileName = fileName;
    }
}

function runTool(command, args, fileName, options = {}) {
    const result = spawnSync(command, args, {
        encoding: options.encoding ?? "utf8",
        maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
        timeout: options.timeout ?? 120_000,
        env: options.env ?? process.env,
        cwd: options.cwd,
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0) {
        throw new HanlinImportError(
            "LOCAL_TOOL_FAILED",
            `${path.basename(command)} 無法處理 ${fileName}（exit ${result.status ?? "unavailable"}）。`,
            fileName,
        );
    }
    return result.stdout;
}

function findTool(preferredPath, fallback) {
    return existsSync(preferredPath) ? preferredPath : fallback;
}

const TOOLS = Object.freeze({
    file: "/usr/bin/file",
    textutil: "/usr/bin/textutil",
    soffice: findTool("/opt/homebrew/bin/soffice", "soffice"),
    pdfinfo: findTool("/opt/homebrew/bin/pdfinfo", "pdfinfo"),
    pdftotext: findTool("/opt/homebrew/bin/pdftotext", "pdftotext"),
    pdfimages: findTool("/opt/homebrew/bin/pdfimages", "pdfimages"),
    pdfdetach: findTool("/opt/homebrew/bin/pdfdetach", "pdfdetach"),
    unzip: findTool("/usr/bin/unzip", "unzip"),
    zip: findTool("/usr/bin/zip", "zip"),
    sevenZip: findTool("/opt/homebrew/bin/7z", "7z"),
});
const PDF_INSPECTOR = fileURLToPath(new URL("./inspect-pdf.mjs", import.meta.url));

const STORAGE_KEY_SEGMENT = /^(?!\.{1,2}$)[^/\\]+$/;

/** DB storage_key 是相對 local-data/assets 根目錄的 POSIX 路徑。 */
export function assertAssetStorageKey(storageKey) {
    if (typeof storageKey !== "string"
        || !storageKey
        || path.posix.isAbsolute(storageKey)
        || storageKey.includes("\\")
        || storageKey.startsWith("local-data/assets/")
        || !storageKey.split("/").every((segment) => STORAGE_KEY_SEGMENT.test(segment))) {
        throw new HanlinImportError("INVALID_STORAGE_KEY", "產生了不合法的本機資產 storage_key。");
    }
    return storageKey;
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function stableJson(value) {
    return JSON.stringify(stableValue(value));
}

function sha256Buffer(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
}

function sha256Text(value) {
    return sha256Buffer(Buffer.from(value, "utf8"));
}

function normalizeQuestionNumber(value) {
    return String(value ?? "").normalize("NFKC").trim().toLowerCase();
}

function normalizeSanitizedSectionHeaders(value) {
    const escapedTypes = HANLIN_CHINESE_TYPES.map((type) => escapeRegex(type)).join("|");
    return String(value).replace(
        new RegExp(`^[\\t 　]*(?:[•●▪◦][\\t 　]*)?(${escapedTypes})[\\t 　]*$`, "gm"),
        "$1",
    );
}

/**
 * LibreOffice preserves some legacy Word sequence fields as strings such as
 * `\\S\\do 4(１)１...` at the beginning of a question line. They are layout
 * instructions for the source question number, not question content.
 */
export function stripLegacyWordSequenceFieldPrefixes(value) {
    return String(value).replace(
        /^[\t 　]*(?=\\S\\do)(?:\\S\\do\s+\d+\([0-9０-９]\)?|[0-9０-９()（）])+/gm,
        "",
    );
}

/**
 * LibreOffice preserves the Wingdings right-arrow glyph from legacy Word files
 * as either U+F0E0 or `à`. Convert only the known private-use glyph globally;
 * the Latin fallback is converted only when it appears between Han/Bopomofo
 * characters so legitimate Latin text remains unchanged.
 */
export function normalizeLegacyWordSymbolArrows(value) {
    const chineseOrBopomofo = "\\u02c7\\u02ca-\\u02cb\\u02d9\\u3105-\\u312f\\u3400-\\u9fff\\uf900-\\ufaff";
    return String(value)
        .replaceAll("\uf0e0", "→")
        .replace(new RegExp(`(?<=[${chineseOrBopomofo}）])à(?=[${chineseOrBopomofo}（])`, "g"), "→");
}

function normalizeStableKey(value, fallback) {
    const normalized = String(value ?? "")
        .normalize("NFKC")
        .trim()
        .replace(/[^0-9A-Za-z_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized || fallback;
}

function strictDifficulty(value) {
    const normalized = String(value ?? "").normalize("NFKC").trim();
    if (normalized === "易") return "basic";
    if (normalized === "中") return "intermediate";
    if (normalized === "難") return "advanced";
    return null;
}

function imageDimensions(buffer, mimeType) {
    if (mimeType === "image/gif" && buffer.length >= 10) {
        return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (mimeType === "image/png" && buffer.length >= 24) {
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mimeType === "image/jpeg") {
        let offset = 2;
        while (offset + 9 < buffer.length) {
            if (buffer[offset] !== 0xff) {
                offset += 1;
                continue;
            }
            const marker = buffer[offset + 1];
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
                return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
            }
            const length = buffer.readUInt16BE(offset + 2);
            if (length < 2) break;
            offset += length + 2;
        }
    }
    return { width: null, height: null };
}

function macroHeuristic(buffer) {
    const latin = buffer.toString("latin1").toLowerCase();
    const utf16 = buffer.toString("utf16le").toLowerCase();
    const markers = [
        "_vba_project",
        "vbaproject",
        "wordbasic",
        "autoopen",
        "autoexec",
        "document_open",
        "thisdocument",
        "macros",
    ];
    return markers.filter((marker) => latin.includes(marker) || utf16.includes(marker));
}

async function validateWordDocument(sourcePath, fileName) {
    const metadata = await stat(sourcePath);
    if (!metadata.isFile()) throw new HanlinImportError("NOT_A_FILE", `${fileName} 不是一般檔案。`, fileName);
    const mimeType = runTool(TOOLS.file, ["--brief", "--mime-type", sourcePath], fileName).trim();
    const description = runTool(TOOLS.file, ["--brief", sourcePath], fileName).trim();
    const buffer = await readFile(sourcePath);
    const isOleWord = mimeType === "application/msword" && description.includes("Composite Document File V2 Document");
    const isOpenXmlWord = [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/zip",
    ].includes(mimeType) && buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    if (!isOleWord && !isOpenXmlWord) {
        throw new HanlinImportError("UNSUPPORTED_DOCUMENT", `${fileName} 不是可支援的 Word 文件。`, fileName);
    }
    const zipMacroMarkers = isOpenXmlWord
        ? runTool(TOOLS.unzip, ["-Z1", sourcePath], fileName)
            .split("\n")
            .map((entry) => entry.trim().toLowerCase())
            .filter((entry) => entry.includes("vbaproject") || entry.startsWith("word/activex/"))
        : [];
    const macroMarkers = [...new Set([...macroHeuristic(buffer), ...zipMacroMarkers])];
    return {
        byteSize: metadata.size,
        sha256: sha256Buffer(buffer),
        mimeType: isOpenXmlWord
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : mimeType,
        macroMarkers,
    };
}

/**
 * Read one stable source descriptor and keep those exact bytes in the private
 * import workspace. Conversion and quarantine must both use this snapshot so
 * a source replacement cannot split checksum evidence from parsed content.
 */
export async function snapshotWordDocument(sourcePath, snapshotPath, fileName = path.basename(sourcePath)) {
    let sourceHandle;
    try {
        sourceHandle = await open(sourcePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const metadata = await sourceHandle.stat();
        if (!metadata.isFile()) throw new HanlinImportError("NOT_A_FILE", `${fileName} 不是一般檔案。`, fileName);
        const sourceBytes = await sourceHandle.readFile();
        await writeFile(snapshotPath, sourceBytes, { flag: "wx", mode: 0o400 });
        return {
            snapshotPath,
            byteSize: sourceBytes.length,
            sha256: sha256Buffer(sourceBytes),
        };
    }
    catch (error) {
        if (error instanceof HanlinImportError) throw error;
        throw new HanlinImportError("SOURCE_FILE_READ_FAILED", `無法安全讀取 ${fileName}。`, fileName);
    }
    finally {
        await sourceHandle?.close().catch(() => undefined);
    }
}

async function configureLockedLibreOfficeProfile(profilePath, fileName) {
    const profileUrl = pathToFileURL(profilePath).href;
    runTool(TOOLS.soffice, [
        `-env:UserInstallation=${profileUrl}`,
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--norestore",
        "--terminate_after_init",
    ], fileName);
    const registryPath = path.join(profilePath, "user", "registrymodifications.xcu");
    const currentSettings = await readFile(registryPath, "utf8");
    const lockedSetting = `  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>
  </item>
`;
    if (!currentSettings.includes("</oor:items>")) {
        throw new HanlinImportError("LIBREOFFICE_PROFILE_INVALID", `${fileName} 的隔離轉檔 profile 無法鎖定巨集安全層級。`, fileName);
    }
    const settings = currentSettings.replace("</oor:items>", `${lockedSetting}</oor:items>`);
    await writeFile(registryPath, settings, "utf8");
}

async function validateSanitizedPdf(pdfPath, fileName) {
    const mimeType = runTool(TOOLS.file, ["--brief", "--mime-type", pdfPath], fileName).trim();
    if (mimeType !== "application/pdf") {
        throw new HanlinImportError("SANITIZED_TYPE_MISMATCH", `${fileName} 未產生預期的無巨集 PDF。`, fileName);
    }
    const buffer = await readFile(pdfPath);
    const pdfText = buffer.toString("latin1");
    let inspection;
    try {
        inspection = JSON.parse(runTool(process.execPath, [PDF_INSPECTOR, pdfPath], fileName));
    }
    catch (error) {
        if (error instanceof HanlinImportError) throw error;
        throw new HanlinImportError("PDF_INSPECTION_FAILED", `${fileName} 的衍生 PDF 無法安全檢查。`, fileName);
    }
    const dangerousDictionary = /\/(?:Launch|RichMedia)\b/.test(pdfText);
    if (inspection.hasJavaScript || inspection.attachmentCount > 0 || dangerousDictionary) {
        throw new HanlinImportError(
            "SANITIZED_ACTIVE_CONTENT",
            `${fileName} 的衍生 PDF 仍含主動內容，拒絕匯入。`,
            fileName,
        );
    }
    return {
        mimeType,
        byteSize: buffer.length,
        sha256: sha256Buffer(buffer),
        inspection,
    };
}

async function validateSanitizedDocx(docxPath, fileName) {
    const mimeType = runTool(TOOLS.file, ["--brief", "--mime-type", docxPath], fileName).trim();
    const acceptedMimeTypes = new Set([
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/zip",
        "application/octet-stream",
    ]);
    if (!acceptedMimeTypes.has(mimeType)) {
        throw new HanlinImportError("SANITIZED_TYPE_MISMATCH", `${fileName} 未產生預期的無巨集 DOCX。`, fileName);
    }
    const entries = runTool(TOOLS.unzip, ["-Z1", docxPath], fileName)
        .split("\n")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
    if (!entries.includes("[content_types].xml") || !entries.includes("word/document.xml")) {
        throw new HanlinImportError("SANITIZED_TYPE_MISMATCH", `${fileName} 未產生有效的無巨集 DOCX。`, fileName);
    }
    if (entries.some((entry) => entry.includes("vbaproject") || entry.startsWith("macros/") || entry.startsWith("word/activex/"))) {
        throw new HanlinImportError("SANITIZED_MACRO_RETAINED", `${fileName} 的衍生 DOCX 仍含巨集或 ActiveX 內容。`, fileName);
    }
    const buffer = await readFile(docxPath);
    return {
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byteSize: buffer.length,
        sha256: sha256Buffer(buffer),
    };
}

async function listRelativeFiles(root, current = "") {
    const directory = path.join(root, current);
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name, "en"))) {
        const relative = current ? path.posix.join(current, entry.name) : entry.name;
        if (entry.isDirectory()) files.push(...await listRelativeFiles(root, relative));
        else if (entry.isFile()) files.push(relative);
    }
    return files;
}

async function normalizeUnpackedDocx(unpacked, scratchRoot, fileName, depth = 0) {
    if (depth > 3) {
        throw new HanlinImportError("SANITIZED_NESTING_TOO_DEEP", `${fileName} 的內嵌 DOCX 層數異常。`, fileName);
    }
    const corePath = path.join(unpacked, "docProps", "core.xml");
    const core = await readFile(corePath, "utf8").catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
    });
    if (core !== null) {
        const scrubbed = core
            .replace(/(<dc:creator\b[^>]*>)[\s\S]*?(<\/dc:creator>)/gi, "$1$2")
            .replace(/(<cp:lastModifiedBy\b[^>]*>)[\s\S]*?(<\/cp:lastModifiedBy>)/gi, "$1$2")
            .replace(
                /(<dcterms:(?:created|modified)\b[^>]*>)[\s\S]*?(<\/dcterms:(?:created|modified)>)/gi,
                (_match, opening, closing) => `${opening}2000-01-01T00:00:00Z${closing}`,
            )
            .replace(
                /(<cp:revision\b[^>]*>)[\s\S]*?(<\/cp:revision>)/gi,
                (_match, opening, closing) => `${opening}1${closing}`,
            );
        await writeFile(corePath, scrubbed, "utf8");
    }

    const initialFiles = await listRelativeFiles(unpacked);
    const nestedDocxFiles = initialFiles.filter((entry) => entry.toLowerCase().endsWith(".docx"));
    for (const [index, relative] of nestedDocxFiles.entries()) {
        const nestedPath = path.join(unpacked, ...relative.split("/"));
        const nestedRoot = path.join(scratchRoot, `nested-${depth}-${index}`);
        await mkdir(nestedRoot, { recursive: true });
        runTool(TOOLS.unzip, ["-q", nestedPath, "-d", nestedRoot], fileName);
        await normalizeUnpackedDocx(nestedRoot, scratchRoot, fileName, depth + 1);
        const nestedFiles = await listRelativeFiles(nestedRoot);
        const fixedTimestamp = new Date("2000-01-01T00:00:00.000Z");
        for (const nestedRelative of nestedFiles) {
            await utimes(path.join(nestedRoot, ...nestedRelative.split("/")), fixedTimestamp, fixedTimestamp);
        }
        await unlink(nestedPath);
        runTool(TOOLS.zip, ["-X", "-q", nestedPath, ...nestedFiles], fileName, { cwd: nestedRoot });
        await rm(nestedRoot, { recursive: true, force: true });
    }

    const files = await listRelativeFiles(unpacked);
    for (const relative of files.filter((entry) => entry.toLowerCase().endsWith(".xml"))) {
        const xmlPath = path.join(unpacked, ...relative.split("/"));
        const xml = await readFile(xmlPath, "utf8");
        let objectIndex = 0;
        let layerIndex = 0;
        const normalized = xml
            // LibreOffice allocates these opaque identifiers from process state.
            .replace(/ObjectID="_\d+"/g, () => `ObjectID="_${++objectIndex}"`)
            // Preserve drawing order while removing the process-specific z-order seed.
            .replace(/relativeHeight="\d+"/g, () => `relativeHeight="${++layerIndex}"`)
            // Cached dynamic field values (notably PAGE) vary with the conversion session.
            .replace(
                /(<w:fldChar\b[^>]*w:fldCharType="separate"[^>]*\/>)([\s\S]*?)(<w:fldChar\b[^>]*w:fldCharType="end"[^>]*\/>)/g,
                (_match, opening, body, closing) => `${opening}${body.replace(/(<w:t\b[^>]*>)\d+(<\/w:t>)/g, "$11$2")}${closing}`,
            );
        if (normalized !== xml) await writeFile(xmlPath, normalized, "utf8");
    }
}

async function normalizeSanitizedDocx(docxPath, documentWork, fileName) {
    const unpacked = path.join(documentWork, "normalized-docx");
    const normalizedPath = path.join(documentWork, "sanitized.docx");
    const nestedScratch = path.join(documentWork, "normalized-nested-docx");
    await mkdir(unpacked, { recursive: true });
    await mkdir(nestedScratch, { recursive: true });
    runTool(TOOLS.unzip, ["-q", docxPath, "-d", unpacked], fileName);
    await normalizeUnpackedDocx(unpacked, nestedScratch, fileName);

    const files = await listRelativeFiles(unpacked);
    const fixedTimestamp = new Date("2000-01-01T00:00:00.000Z");
    for (const relative of files) {
        await utimes(path.join(unpacked, ...relative.split("/")), fixedTimestamp, fixedTimestamp);
    }
    runTool(TOOLS.zip, ["-X", "-q", normalizedPath, ...files], fileName, { cwd: unpacked });
    return normalizedPath;
}

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let value = 0; value < table.length; value += 1) {
        let crc = value;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        table[value] = crc >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const value of buffer) crc = CRC32_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function extractPngPayloads(buffer, { requireWholeBuffer = false } = {}) {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const payloads = [];
    let searchOffset = 0;
    while (searchOffset < buffer.length) {
        const start = buffer.indexOf(signature, searchOffset);
        if (start < 0) break;
        let offset = start + signature.length;
        let valid = false;
        let chunkIndex = 0;
        let sawImageData = false;
        while (offset + 12 <= buffer.length) {
            const length = buffer.readUInt32BE(offset);
            const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
            const end = offset + 12 + length;
            if (!/^[A-Za-z]{4}$/.test(type) || end > buffer.length) break;
            const data = buffer.subarray(offset + 8, offset + 8 + length);
            const declaredCrc = buffer.readUInt32BE(offset + 8 + length);
            const computedCrc = crc32(buffer.subarray(offset + 4, offset + 8 + length));
            if (declaredCrc !== computedCrc) break;
            if (chunkIndex === 0) {
                if (type !== "IHDR" || length !== 13) break;
                const width = data.readUInt32BE(0);
                const height = data.readUInt32BE(4);
                const bitDepth = data[8];
                const colorType = data[9];
                const validDepths = {
                    0: [1, 2, 4, 8, 16],
                    2: [8, 16],
                    3: [1, 2, 4, 8],
                    4: [8, 16],
                    6: [8, 16],
                };
                if (!width || !height || width > 20_000 || height > 20_000
                    || !validDepths[colorType]?.includes(bitDepth)
                    || data[10] !== 0 || data[11] !== 0 || ![0, 1].includes(data[12])) break;
            }
            if (type === "IDAT") sawImageData = true;
            offset = end;
            if (type === "IEND") {
                const payload = buffer.subarray(start, end);
                if (length === 0 && sawImageData && (!requireWholeBuffer || (start === 0 && end === buffer.length))) {
                    payloads.push({ buffer: payload, mimeType: "image/png", extension: ".png" });
                    valid = true;
                }
                break;
            }
            chunkIndex += 1;
        }
        searchOffset = valid ? offset : start + signature.length;
    }
    return payloads;
}

function xmlAttribute(fragment, name) {
    return fragment.match(new RegExp(`\\b${escapeRegex(name)}="([^"]+)"`))?.[1] ?? null;
}

function parseDocumentRelationships(xml) {
    const relationships = new Map();
    for (const match of xml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
        const fragment = match[0];
        const id = xmlAttribute(fragment, "Id");
        const target = xmlAttribute(fragment, "Target");
        const type = xmlAttribute(fragment, "Type");
        if (id && target && type) relationships.set(id, { target, type });
    }
    return relationships;
}

function resolveDocxRelationship(unpackedDocx, target) {
    if (!target || target.includes("\\") || path.posix.isAbsolute(target)) return null;
    const segments = path.posix.normalize(path.posix.join("word", target)).split("/");
    if (segments.some((segment) => segment === ".." || !segment)) return null;
    const resolved = path.resolve(unpackedDocx, ...segments);
    return resolved.startsWith(`${path.resolve(unpackedDocx)}${path.sep}`) ? resolved : null;
}

function safeSevenZipEntries(archivePath, fileName) {
    const listing = runTool(TOOLS.sevenZip, ["l", "-ba", archivePath], fileName);
    return listing.split("\n").map((line) => line.trim().split(/\s{2,}/).at(-1)).filter(Boolean);
}

function assertSafeEmbeddedArchive(archivePath, fileName) {
    const dangerous = /(?:^|[/\\])(?:vba|_vba_project|projectwm|ole10native|activex)(?:$|[/\\])/i;
    const entries = safeSevenZipEntries(archivePath, fileName);
    if (entries.some((entry) => dangerous.test(entry))) {
        throw new HanlinImportError("SANITIZED_EMBEDDED_ACTIVE_CONTENT", `${fileName} 的衍生 DOCX 仍含不安全內嵌內容。`, fileName);
    }
    return entries;
}

async function extractOlePng(objectPath, extractionRoot, fileName, approvedDecorativeChecksums) {
    const objectBuffer = await readFile(objectPath);
    const activeContentMarkers = [
        ...macroHeuristic(objectBuffer),
        ...["ole10native", "activex"].filter((marker) => (
            objectBuffer.toString("latin1").toLowerCase().includes(marker)
            || objectBuffer.toString("utf16le").toLowerCase().includes(marker)
        )),
    ];
    if (activeContentMarkers.length) {
        throw new HanlinImportError("SANITIZED_EMBEDDED_ACTIVE_CONTENT", `${fileName} 的衍生 DOCX 仍含不安全內嵌內容。`, fileName);
    }
    const embeddedPayloads = extractPngPayloads(objectBuffer);
    if (embeddedPayloads.length === 1
        && approvedDecorativeChecksums.has(sha256Buffer(embeddedPayloads[0].buffer))) {
        return embeddedPayloads[0];
    }
    let entries;
    try {
        entries = assertSafeEmbeddedArchive(objectPath, fileName);
    }
    catch (error) {
        if (!(error instanceof HanlinImportError) || error.code !== "LOCAL_TOOL_FAILED") throw error;
        return null;
    }
    if (entries.filter((entry) => entry === "Data").length !== 1) return null;
    await mkdir(extractionRoot, { recursive: true });
    try {
        runTool(TOOLS.sevenZip, ["e", "-y", `-o${extractionRoot}`, objectPath, "Data"], fileName);
    }
    catch (error) {
        if (!(error instanceof HanlinImportError) || error.code !== "LOCAL_TOOL_FAILED") throw error;
        return null;
    }
    const data = await readFile(path.join(extractionRoot, "Data")).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
    });
    if (!data || data.length > 64 * 1024 * 1024) return null;
    const payloads = extractPngPayloads(data).filter(({ buffer }) => data.indexOf(buffer) + buffer.length === data.length);
    return payloads.length === 1 ? payloads[0] : null;
}

async function staticDocxImagePayload(unpackedDocx, relationships, relationshipId, approvedImageChecksums) {
    const relationship = relationshipId ? relationships.get(relationshipId) : null;
    const mediaPath = relationship?.type.endsWith("/image")
        ? resolveDocxRelationship(unpackedDocx, relationship.target)
        : null;
    if (!mediaPath) return null;
    const media = await readFile(mediaPath);
    const payloads = extractPngPayloads(media, { requireWholeBuffer: true });
    if (payloads.length === 1) return { ...payloads[0], provenance: "docx-media" };
    const jpegEnd = media.lastIndexOf(Buffer.from([0xff, 0xd9]));
    const jpegPadding = jpegEnd === -1 ? null : media.subarray(jpegEnd + 2);
    const approvedImage = approvedImageChecksums.has(sha256Buffer(media));
    if (media.length >= 4
        && media[0] === 0xff && media[1] === 0xd8
        && jpegEnd >= 2
        && jpegPadding.length <= 64
        && (jpegPadding.every((byte) => byte === 0) || approvedImage)) {
        const dimensions = imageDimensions(media, "image/jpeg");
        if (dimensions.width && dimensions.height
            && dimensions.width <= 20_000 && dimensions.height <= 20_000) {
            return { buffer: media, mimeType: "image/jpeg", extension: ".jpg", provenance: "docx-media" };
        }
    }
    return null;
}

async function extractStableEmbeddedImages(
    unpackedDocx,
    documentWork,
    fileName,
    approvedDecorativeChecksums,
    approvedQuestionChecksums,
) {
    const documentXml = await readFile(path.join(unpackedDocx, "word", "document.xml"), "utf8");
    const relationshipsXml = await readFile(path.join(unpackedDocx, "word", "_rels", "document.xml.rels"), "utf8");
    const relationships = parseDocumentRelationships(relationshipsXml);
    const tokens = [...documentXml.matchAll(/<w:object\b[\s\S]*?<\/w:object>|<a:blip\b[^>]*\br:embed="[^"]+"[^>]*\/?\s*>|<v:imagedata\b[^>]*\br:id="[^"]+"[^>]*\/?\s*>/g)];
    const outputRoot = path.join(documentWork, "stable-question-images");
    await mkdir(outputRoot, { recursive: true });
    const images = [];
    let ambiguous = false;

    for (const [objectIndex, match] of tokens.entries()) {
        const fragment = match[0];
        let payload = null;
        if (fragment.startsWith("<w:object")) {
            const oleFragment = fragment.match(/<o:OLEObject\b[^>]*\br:id="[^"]+"[^>]*\/?\s*>/)?.[0];
            const relationshipId = oleFragment ? xmlAttribute(oleFragment, "r:id") : null;
            const relationship = relationshipId ? relationships.get(relationshipId) : null;
            const objectPath = relationship?.type.endsWith("/oleObject")
                ? resolveDocxRelationship(unpackedDocx, relationship.target)
                : null;
            if (objectPath) {
                payload = await extractOlePng(
                    objectPath,
                    path.join(documentWork, `embedded-${String(objectIndex).padStart(3, "0")}`),
                    fileName,
                    approvedDecorativeChecksums,
                );
                if (payload) payload = { ...payload, provenance: "ole-data" };
            }
            if (!payload) {
                const previewFragment = fragment.match(/<v:imagedata\b[^>]*\br:id="[^"]+"[^>]*\/?\s*>/)?.[0];
                payload = await staticDocxImagePayload(
                    unpackedDocx,
                    relationships,
                    previewFragment ? xmlAttribute(previewFragment, "r:id") : null,
                    approvedQuestionChecksums,
                );
            }
        }
        else {
            const relationshipId = xmlAttribute(fragment, fragment.startsWith("<a:blip") ? "r:embed" : "r:id");
            payload = await staticDocxImagePayload(
                unpackedDocx,
                relationships,
                relationshipId,
                approvedQuestionChecksums,
            );
        }
        if (!payload) {
            ambiguous = true;
            continue;
        }
        const checksum = sha256Buffer(payload.buffer);
        const temporaryPath = path.join(outputRoot, `${String(objectIndex).padStart(3, "0")}-${checksum}${payload.extension}`);
        await writeFile(temporaryPath, payload.buffer);
        images.push({
            ...payload,
            checksum,
            temporaryPath,
            dimensions: imageDimensions(payload.buffer, payload.mimeType),
        });
    }
    return { images, ambiguous };
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mapQuestionPages(records, pages) {
    return records.map((record) => {
        const number = normalizeQuestionNumber(record.number);
        if (!number) return [];
        const escaped = escapeRegex(number);
        const numeric = /^[0-9]+$/.test(number);
        const labeledMatcher = new RegExp(`編\\s*號\\s*[:：]\\s*${escaped}(?:\\s|$)`, "i");
        const fallbackMatcher = new RegExp(numeric ? `(^|[^0-9])${escaped}([^0-9]|$)` : escaped, "i");
        const labeledPages = pages.flatMap((pageText, index) =>
            labeledMatcher.test(pageText.normalize("NFKC").toLowerCase()) ? [index + 1] : []);
        if (labeledPages.length) return labeledPages;
        return pages.flatMap((pageText, index) => fallbackMatcher.test(pageText.normalize("NFKC").toLowerCase()) ? [index + 1] : []);
    });
}

function parsePdfImageRows(value) {
    return value.split("\n").flatMap((line) => {
        const columns = line.trim().split(/\s+/);
        if (!/^\d+$/.test(columns[0] ?? "") || columns[2] !== "image") return [];
        return [{ page: Number(columns[0]), width: Number(columns[3]), height: Number(columns[4]) }];
    });
}

function parseHtmlNumberMatches(html) {
    return [...html.matchAll(/(?:編號|題號)：(?:\s|<[^>]*>)*([0-9]+)/g)].map((match) => ({
        index: match.index ?? 0,
        number: normalizeQuestionNumber(match[1]),
    }));
}

function questionImageAsset(stableImage, pdfImage = null, mapping = null) {
    const { buffer, checksum, mimeType, extension, dimensions, temporaryPath } = stableImage;
    return {
        assetId: deterministicUuid(`asset:question-content:${checksum}`),
        checksum,
        storageKey: assertAssetStorageKey(`questions/${checksum}${extension}`),
        mimeType,
        byteSize: buffer.length,
        width: dimensions.width ?? pdfImage?.width ?? null,
        height: dimensions.height ?? pdfImage?.height ?? null,
        temporaryPath,
        optionKey: mapping?.optionKey ?? null,
        altText: mapping?.altText ?? null,
    };
}

async function extractImages({
    html,
    htmlPath,
    pdfImageRows,
    stableImages,
    records,
    recordPages,
    ignoredImageChecksums,
    approvedQuestionImageMappings = [],
    unresolvedImageQuestionNumbers = [],
    preferPrecedingAssociation = false,
    allowDocxMedia = false,
}) {
    const imageTags = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)].map((match) => ({
        index: match.index ?? 0,
        source: decodeURIComponent(match[1]),
    }));
    const numberMatches = parseHtmlNumberMatches(html);
    const recordIndexesByNumber = new Map();
    records.forEach((record, index) => {
        const key = normalizeQuestionNumber(record.number);
        recordIndexesByNumber.set(key, [...(recordIndexesByNumber.get(key) ?? []), index]);
    });
    const pendingIndexes = new Set();
    const imagesByRecord = new Map();
    const approvedRecordIndexes = new Set();
    if (approvedQuestionImageMappings.length) {
        const stableByChecksum = new Map(stableImages.images.map((image) => [image.checksum, image]));
        for (const mapping of approvedQuestionImageMappings) {
            const stableImage = stableByChecksum.get(mapping.checksum);
            const candidateIndexes = recordIndexesByNumber.get(mapping.questionNumber) ?? [];
            if (!stableImage || candidateIndexes.length !== 1) {
                candidateIndexes.forEach((index) => pendingIndexes.add(index));
                continue;
            }
            const recordIndex = candidateIndexes[0];
            const image = questionImageAsset(stableImage, null, mapping);
            imagesByRecord.set(recordIndex, [...(imagesByRecord.get(recordIndex) ?? []), image]);
            approvedRecordIndexes.add(recordIndex);
        }
        for (const questionNumber of unresolvedImageQuestionNumbers) {
            (recordIndexesByNumber.get(questionNumber) ?? []).forEach((index) => pendingIndexes.add(index));
        }
        const approvedChecksums = new Set(approvedQuestionImageMappings.map((mapping) => mapping.checksum));
        const mappingsCoverStableImages = stableImages.images.length === approvedChecksums.size
            && stableImages.images.every((image) => approvedChecksums.has(image.checksum));
        if (mappingsCoverStableImages) {
            return { imagesByRecord, pendingIndexes, imageTags: imageTags.length, pdfImages: pdfImageRows.length };
        }
    }
    const everyStableImageIsApprovedDecoration = stableImages.images.length > 0
        && pdfImageRows.length === stableImages.images.length
        && stableImages.images.every((image) => ignoredImageChecksums.has(image.checksum));
    if (everyStableImageIsApprovedDecoration) {
        return { imagesByRecord, pendingIndexes, imageTags: imageTags.length, pdfImages: pdfImageRows.length };
    }
    const acceptedProvenance = allowDocxMedia ? new Set(["ole-data", "docx-media"]) : new Set(["ole-data"]);
    const countMismatch = imageTags.length !== pdfImageRows.length || imageTags.length !== stableImages.images.length
        || stableImages.ambiguous || stableImages.images.some((image) => !acceptedProvenance.has(image.provenance));

    if (countMismatch) {
        for (const tag of imageTags) {
            const following = numberMatches.find((entry) => entry.index > tag.index);
            const preceding = numberMatches.filter((entry) => entry.index < tag.index).at(-1);
            const match = preferPrecedingAssociation ? preceding : following;
            const candidateIndexes = match ? recordIndexesByNumber.get(match.number) ?? [] : [];
            if (candidateIndexes.length === 1) pendingIndexes.add(candidateIndexes[0]);
        }
        records.forEach((record, index) => {
            if (VISUAL_REFERENCE.test(record.body)) pendingIndexes.add(index);
        });
        approvedRecordIndexes.forEach((index) => pendingIndexes.delete(index));
        return { imagesByRecord, pendingIndexes, imageTags: imageTags.length, pdfImages: pdfImageRows.length };
    }

    for (let imageIndex = 0; imageIndex < imageTags.length; imageIndex += 1) {
        const tag = imageTags[imageIndex];
        const pdfImage = pdfImageRows[imageIndex];
        const stableImage = stableImages.images[imageIndex];
        if (stableImage && ignoredImageChecksums.has(stableImage.checksum)) continue;
        const associatedNumber = tag
            ? (preferPrecedingAssociation
                ? numberMatches.filter((entry) => entry.index < tag.index).at(-1)
                : numberMatches.find((entry) => entry.index > tag.index))
            : null;
        const candidateIndexes = associatedNumber ? recordIndexesByNumber.get(associatedNumber.number) ?? [] : [];
        const pageIndexes = pdfImage
            ? records.flatMap((_, recordIndex) => recordPages[recordIndex].includes(pdfImage.page) ? [recordIndex] : [])
            : [];
        const candidateIndex = candidateIndexes.length === 1 ? candidateIndexes[0] : null;
        const pageMatches = candidateIndex !== null && pdfImage
            ? recordPages[candidateIndex].length === 1 && recordPages[candidateIndex][0] === pdfImage.page
            : false;

        if (!tag || !pdfImage || !stableImage || candidateIndex === null || !pageMatches) {
            const affected = new Set([...candidateIndexes, ...pageIndexes]);
            if (!affected.size) {
                records.forEach((record, index) => {
                    if (VISUAL_REFERENCE.test(record.body)) affected.add(index);
                });
            }
            affected.forEach((index) => pendingIndexes.add(index));
            continue;
        }

        const imagePath = path.resolve(path.dirname(htmlPath), tag.source);
        const htmlRoot = `${path.resolve(path.dirname(htmlPath))}${path.sep}`;
        if (!imagePath.startsWith(htmlRoot)) {
            pendingIndexes.add(candidateIndex);
            continue;
        }
        const image = questionImageAsset(stableImage, pdfImage);
        imagesByRecord.set(candidateIndex, [...(imagesByRecord.get(candidateIndex) ?? []), image]);
    }

    approvedRecordIndexes.forEach((index) => pendingIndexes.delete(index));

    return { imagesByRecord, pendingIndexes, imageTags: imageTags.length, pdfImages: pdfImageRows.length };
}

const EXPLANATION_CORRECTIONS = new Map([
    [
        "05011100",
        "題幹中的「養」與（B）奉「養」皆讀作 ㄧㄤˋ；（A）「養」育、（C）教「養」、（D）「養」分中的「養」皆讀作 ㄧㄤˇ。",
    ],
    [
        "1501003429",
        "d＝5×7\nc＝3×5×7\nb＝2×3×5×7\na＝2×2×3×5×7\n故選(C)",
    ],
]);

const QUESTION_BODY_CORRECTIONS = new Map([
    [
        "1501003429",
        "小強將 a 做質因數分解，計算過程如下，則下列敘述何者正確？\n(A)d＝5＋7\n(B)c＝3×5\n(C)b＝2×3×5×7\n(D)a＝2×3×5×7",
    ],
]);

export function correctedQuestionBody(record) {
    const sourceQuestionNumber = String(record.number ?? "").trim();
    return QUESTION_BODY_CORRECTIONS.get(sourceQuestionNumber)
        ?? String(record.body ?? "").trim();
}

function correctedExplanation(record) {
    const sourceQuestionNumber = String(record.number ?? "").trim();
    return EXPLANATION_CORRECTIONS.get(sourceQuestionNumber)
        ?? String(record.explanation ?? "").trim();
}

function structuredRecord(record, approvedChoiceRepair = null) {
    const pendingReasons = [];
    const body = correctedQuestionBody(record);
    const sourceAnswer = String(record.sourceAnswer ?? "").trim();
    const difficultyCode = strictDifficulty(record.difficulty);
    if (!body) pendingReasons.push("missing-prompt");
    if (!sourceAnswer) pendingReasons.push("missing-answer");
    if (!difficultyCode) pendingReasons.push("unknown-difficulty");

    if (["單一選擇題", "選擇"].includes(record.type)) {
        if (approvedChoiceRepair) {
            const sourceAnswerKey = parseAnswerLetters(sourceAnswer)[0];
            const options = approvedChoiceRepair.options.map((option) => ({
                key: option.key,
                text: option.text,
            }));
            const optionKeys = new Set(options.map((option) => option.key));
            if (sourceAnswerKey !== approvedChoiceRepair.answerKey
                || !optionKeys.has(approvedChoiceRepair.answerKey)
                || optionKeys.size !== options.length
                || options.length < 2) {
                pendingReasons.push("choice-repair-invalid");
            }
            return {
                kind: "choice",
                questionTypeCode: "single-choice",
                difficultyCode,
                prompt: body.replace(/(?:\s*\([A-H]\)\s*)+$/u, "").trim(),
                parts: pendingReasons.length ? [] : [{
                    stableKey: "main",
                    prompt: "",
                    answerMode: "single_choice",
                    gradingPolicy: "automatic",
                    options,
                    answer: { answerKey: approvedChoiceRepair.answerKey },
                }],
                explanation: correctedExplanation(record),
                pendingReasons,
            };
        }
        const parsed = parseOptions(body);
        const answerKey = parseAnswerLetters(sourceAnswer)[0];
        const matchingAnswer = parsed?.options.find((option) => option.label === answerKey);
        const optionKeysUnique = parsed
            ? new Set(parsed.options.map((option) => option.label)).size === parsed.options.length
            : false;
        const choiceValid = Boolean(parsed && parsed.options.length >= 2 && answerKey && matchingAnswer
            && optionKeysUnique
            && !parsed.options.some((option) => !option.value.replace(/^\([A-H]\)/, "").trim()));
        if (!choiceValid) {
            pendingReasons.push("choice-parse-failed");
        }
        return {
            kind: "choice",
            questionTypeCode: "single-choice",
            difficultyCode,
            prompt: parsed?.prompt ?? body,
            parts: choiceValid ? [{
                stableKey: "main",
                prompt: "",
                answerMode: "single_choice",
                gradingPolicy: "automatic",
                options: parsed.options.map((option) => ({ key: option.label, text: option.value })),
                answer: matchingAnswer ? { answerKey } : null,
            }] : [],
            explanation: correctedExplanation(record),
            pendingReasons,
        };
    }

    if (["配合題", "選詞測驗", "題組"].includes(record.type)) {
        const parsed = parseParts(body, sourceAnswer);
        if (!parsed) pendingReasons.push("multi-part-parse-failed");
        const stableKeys = new Set();
        const parts = (parsed?.parts ?? []).map((part, index) => {
            const stableKey = normalizeStableKey(part.id, `part-${index + 1}`);
            if (stableKeys.has(stableKey)) pendingReasons.push("duplicate-part-key");
            stableKeys.add(stableKey);
            const options = part.options.map((text, optionIndex) => ({
                key: String.fromCharCode(65 + optionIndex),
                text,
            }));
            const matchingOptions = options.filter((option) => option.text === part.answer);
            const answer = matchingOptions.length === 1 ? { answerKey: matchingOptions[0].key } : null;
            if (options.length && matchingOptions.length !== 1) {
                pendingReasons.push("multi-part-answer-option-mismatch");
            }
            if (!part.prompt || options.length < 2 || !part.answer) pendingReasons.push("multi-part-incomplete");
            return {
                stableKey,
                prompt: part.prompt,
                answerMode: "single_choice",
                gradingPolicy: "automatic",
                options,
                answer,
            };
        });
        return {
            kind: "multi-choice",
            questionTypeCode: "multi-choice",
            difficultyCode,
            prompt: parsed?.prompt ?? body,
            parts,
            explanation: correctedExplanation(record),
            pendingReasons,
        };
    }

    if (!["寫出國字、注音", "注釋", "改錯題", "填充題", "填充", "計算", "會考非選擇題"].includes(record.type)) {
        pendingReasons.push("unsupported-question-type");
    }
    const parsedParts = body && sourceAnswer ? parseWrittenParts(body, sourceAnswer) : null;
    const writtenStableKeys = new Set();
    const parts = parsedParts?.length
        ? parsedParts.map((part, index) => {
            let stableKey = normalizeStableKey(part.id, `part-${index + 1}`);
            if (writtenStableKeys.has(stableKey)) {
                pendingReasons.push("duplicate-part-key");
                stableKey = `${stableKey}-${index + 1}`;
            }
            writtenStableKeys.add(stableKey);
            return {
            stableKey,
            prompt: part.prompt,
            answerMode: "text",
            gradingPolicy: "manual_review",
            options: [],
            answer: part.answer ? { acceptedValue: part.answer } : null,
        }})
        : [{
            stableKey: "main",
            prompt: "",
            answerMode: "text",
            gradingPolicy: "manual_review",
            options: [],
            answer: sourceAnswer ? { acceptedValue: sourceAnswer } : null,
        }];
    if (parts.some((part) => !part.answer)) pendingReasons.push("written-answer-incomplete");
    return {
        kind: "written",
        questionTypeCode: "written",
        difficultyCode,
        prompt: body,
        parts,
        explanation: correctedExplanation(record),
        pendingReasons,
    };
}

function recordFingerprint(record) {
    return sha256Text(stableJson({
        type: record.originalType,
        difficulty: record.originalDifficulty,
        cognitive: record.originalCognitive,
        knowledge: record.originalKnowledge,
        sourceOrigin: record.originalSource,
        prompt: record.structured.prompt,
        parts: record.structured.parts,
        explanation: record.structured.explanation,
        images: record.images.map((image) => image.checksum),
    }));
}

function preserveMathScriptMarkup(html) {
    const plainInline = (value) => value.replace(/<[^>]+>/g, "").trim();
    return html
        .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, (_, value) => `^(${plainInline(value)})`)
        .replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, (_, value) => `_(${plainInline(value)})`);
}

async function convertAndParseDocument(sourceDir, fileName, documentIndex, temporaryRoot, authorizedLesson = null) {
    const selectedSourcePath = path.join(sourceDir, fileName);
    const documentWork = await mkdtemp(path.join(temporaryRoot, `document-${String(documentIndex).padStart(2, "0")}-`));
    const sourceSnapshot = await snapshotWordDocument(
        selectedSourcePath,
        path.join(documentWork, "source-input.doc"),
        fileName,
    );
    const sourcePath = sourceSnapshot.snapshotPath;
    const validation = await validateWordDocument(sourcePath, fileName);
    if (validation.sha256 !== sourceSnapshot.sha256 || validation.byteSize !== sourceSnapshot.byteSize) {
        throw new HanlinImportError("SOURCE_SNAPSHOT_MISMATCH", `${fileName} 的私有快照與已讀取來源不一致。`, fileName);
    }
    const profile = path.join(documentWork, "profile");
    await configureLockedLibreOfficeProfile(profile, fileName);
    const profileUrl = pathToFileURL(profile).href;
    const commandPrefix = [
        `-env:UserInstallation=${profileUrl}`,
        "--safe-mode",
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--norestore",
    ];
    runTool(TOOLS.soffice, [
        ...commandPrefix,
        "--convert-to",
        "docx:Office Open XML Text",
        "--outdir",
        documentWork,
        sourcePath,
    ], fileName);
    const initialOutputs = await readdir(documentWork);
    const docxName = initialOutputs.find((name) => name.toLowerCase().endsWith(".docx"));
    if (!docxName) {
        throw new HanlinImportError("CONVERSION_OUTPUT_MISSING", `${fileName} 未產生 DOCX。`, fileName);
    }
    const convertedDocxPath = path.join(documentWork, docxName);
    const docxPath = await normalizeSanitizedDocx(convertedDocxPath, documentWork, fileName);
    const sanitized = await validateSanitizedDocx(docxPath, fileName);

    const derivativeProfile = path.join(documentWork, "derivative-profile");
    await configureLockedLibreOfficeProfile(derivativeProfile, fileName);
    const derivativeProfileUrl = pathToFileURL(derivativeProfile).href;
    const derivativeCommandPrefix = [
        `-env:UserInstallation=${derivativeProfileUrl}`,
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--norestore",
    ];
    runTool(TOOLS.soffice, [...derivativeCommandPrefix, "--convert-to", "pdf", "--outdir", documentWork, docxPath], fileName);
    runTool(TOOLS.soffice, [...derivativeCommandPrefix, "--convert-to", "html", "--outdir", documentWork, docxPath], fileName);
    const outputs = await readdir(documentWork);
    const pdfName = outputs.find((name) => name.toLowerCase().endsWith(".pdf"));
    const htmlName = outputs.find((name) => name.toLowerCase().endsWith(".html"));
    if (!pdfName || !htmlName) {
        throw new HanlinImportError("CONVERSION_OUTPUT_MISSING", `${fileName} 的安全 DOCX 未產生 PDF/HTML。`, fileName);
    }
    const pdfPath = path.join(documentWork, pdfName);
    const htmlPath = path.join(documentWork, htmlName);
    const pdfValidation = await validateSanitizedPdf(pdfPath, fileName);
    const declaredPages = Number(pdfValidation.inspection.pageCount ?? 0);
    const pages = pdfValidation.inspection.pages ?? [];
    if (!declaredPages || pages.length !== declaredPages) {
        throw new HanlinImportError("PAGE_COUNT_MISMATCH", `${fileName} 的 PDF 頁數與文字頁面不一致。`, fileName);
    }
    let sanitizedText;
    if (authorizedLesson?.parserStyle === "metadata-first") {
        const semanticHtmlPath = path.join(documentWork, "semantic-math.html");
        await writeFile(semanticHtmlPath, preserveMathScriptMarkup(await readFile(htmlPath, "utf8")), "utf8");
        sanitizedText = runTool(TOOLS.textutil, ["-convert", "txt", "-stdout", semanticHtmlPath], fileName, {
            maxBuffer: 64 * 1024 * 1024,
        });
    }
    else {
        sanitizedText = runTool(TOOLS.textutil, ["-convert", "txt", "-stdout", docxPath], fileName, {
            maxBuffer: 64 * 1024 * 1024,
        });
    }
    const normalizedText = cleanText(stripLegacyWordSequenceFieldPrefixes(normalizeLegacyWordSymbolArrows(
        normalizeSanitizedSectionHeaders(sanitizedText),
    ))).replace(/^\s*\d+\s+(?=題號：)/gm, "");
    const records = authorizedLesson?.parserStyle === "metadata-first"
        ? parseMetadataFirst(normalizedText, authorizedLesson.questionTypes ?? KANGXUAN_MATH_TYPES, fileName)
        : parseMetadataLast(normalizedText, HANLIN_CHINESE_TYPES, fileName);
    if (authorizedLesson?.parserStyle === "metadata-first") {
        records.forEach((record) => {
            record.origin = authorizedLesson.target.sourceCategoryName;
            record.unit = authorizedLesson.target.unitName;
        });
    }
    if (!records.length) throw new HanlinImportError("NO_QUESTIONS", `${fileName} 找不到可辨識題目。`, fileName);
    const recordPages = mapQuestionPages(records, pages);
    const html = await readFile(htmlPath, "utf8");
    const pdfImageRows = pdfValidation.inspection.images ?? [];
    const ignoredImageChecksums = authorizedLesson?.originalSha256 === validation.sha256
        ? new Set(authorizedLesson.approvedDecorativeImageSha256s)
        : new Set();
    const approvedQuestionChecksums = authorizedLesson?.originalSha256 === validation.sha256
        ? new Set((authorizedLesson.approvedQuestionImageMappings ?? []).map((mapping) => mapping.checksum))
        : new Set();
    const stableImages = await extractStableEmbeddedImages(
        path.join(documentWork, "normalized-docx"),
        documentWork,
        fileName,
        ignoredImageChecksums,
        approvedQuestionChecksums,
    );
    const imageAnalysis = await extractImages({
        html,
        htmlPath,
        pdfImageRows,
        stableImages,
        records,
        recordPages,
        ignoredImageChecksums,
        approvedQuestionImageMappings: authorizedLesson?.originalSha256 === validation.sha256
            ? authorizedLesson.approvedQuestionImageMappings ?? []
            : [],
        unresolvedImageQuestionNumbers: authorizedLesson?.originalSha256 === validation.sha256
            ? authorizedLesson.unresolvedImageQuestionNumbers ?? []
            : [],
        preferPrecedingAssociation: authorizedLesson?.parserStyle === "metadata-first",
        allowDocxMedia: authorizedLesson?.parserStyle === "metadata-first",
    });
    const originalTitle = path.basename(fileName, path.extname(fileName));
    const sourceDocumentId = deterministicUuid(`source-document:sanitized-docx:${SANITIZER_VERSION}:${validation.sha256}`);

    const parsedRecords = records.map((record, recordIndex) => {
        const approvedChoiceRepair = authorizedLesson?.approvedChoiceRepairs?.find((repair) =>
            repair.questionNumber === normalizeQuestionNumber(record.number)) ?? null;
        const structured = structuredRecord(record, approvedChoiceRepair);
        const pendingReasons = [...structured.pendingReasons];
        if (recordPages[recordIndex].length !== 1) pendingReasons.push("source-page-not-unique");
        if (VISUAL_REFERENCE.test(record.body) && !(imageAnalysis.imagesByRecord.get(recordIndex)?.length)) {
            pendingReasons.push("visual-reference-without-image");
        }
        const images = imageAnalysis.imagesByRecord.get(recordIndex) ?? [];
        const requiredChoiceImages = approvedChoiceRepair?.options
            .filter((option) => option.imageChecksum)
            .map((option) => ({ key: option.key, checksum: option.imageChecksum })) ?? [];
        const choiceRepairImagesComplete = requiredChoiceImages.every((required) =>
            images.some((image) => image.optionKey === required.key && image.checksum === required.checksum));
        if (approvedChoiceRepair && !choiceRepairImagesComplete) pendingReasons.push("choice-repair-image-missing");
        if (imageAnalysis.pendingIndexes.has(recordIndex) && !approvedChoiceRepair) {
            pendingReasons.push("image-mapping-unverified");
        }
        const number = normalizeQuestionNumber(record.number);
        if (!number || number.length > 120) pendingReasons.push("invalid-question-number");
        const item = {
            documentIndex,
            recordIndex,
            sourceDocumentId,
            sourcePage: recordPages[recordIndex].length === 1 ? recordPages[recordIndex][0] : null,
            sourceQuestionNumber: String(record.number ?? "").trim(),
            normalizedQuestionNumber: number,
            originalType: record.type,
            originalDifficulty: String(record.difficulty ?? "").trim(),
            originalCognitive: String(record.cognitive ?? "").trim(),
            originalKnowledge: String(record.knowledge ?? "").trim(),
            originalSource: String(record.origin ?? "").trim(),
            originalUnit: String(record.unit ?? "").trim() || originalTitle,
            structured,
            images,
            pendingReasons: [...new Set(pendingReasons)],
        };
        return { ...item, contentFingerprint: recordFingerprint(item) };
    });

    return {
        documentIndex,
        fileName,
        relativePath: fileName.normalize("NFC"),
        originalTitle,
        sourcePath,
        originalSha256: validation.sha256,
        originalByteSize: validation.byteSize,
        originalMimeType: validation.mimeType,
        originalStorageKey: assertAssetStorageKey(`quarantine/source-documents/${validation.sha256}.doc`),
        originalAssetId: deterministicUuid(`asset:quarantine-source-document:${validation.sha256}`),
        originalMacroMarkers: validation.macroMarkers,
        sanitizedSha256: sanitized.sha256,
        sanitizedByteSize: sanitized.byteSize,
        sanitizedMimeType: sanitized.mimeType,
        sanitizedPath: docxPath,
        storageKey: assertAssetStorageKey(`sanitized-source-documents/${validation.sha256}.docx`),
        assetId: deterministicUuid(`asset:sanitized-source-document:${SANITIZER_VERSION}:${validation.sha256}`),
        sourceDocumentId,
        sanitization: {
            tool: "LibreOffice",
            version: SANITIZER_VERSION,
            policy: "fresh-profile;safe-mode;macro-security-level=3;headless;docx-macro-denylist;deterministic-zip;pdf-active-content-denylist",
            originalScanStatus: validation.macroMarkers.length ? "rejected" : "quarantined",
        },
        pageCount: declaredPages,
        htmlImageCount: imageAnalysis.imageTags,
        pdfImageCount: imageAnalysis.pdfImages,
        stableImageCount: stableImages.images.length,
        records: parsedRecords,
    };
}

function addCrossDocumentDuplicateState(documents) {
    const allRecords = documents.flatMap((document) => document.records.map((record) => ({ document, record })));
    const byDocumentNumber = new Map();
    for (const entry of allRecords) {
        const key = entry.record.normalizedQuestionNumber;
        if (!key) continue;
        const scopedKey = `${entry.document.originalSha256}:${key}`;
        byDocumentNumber.set(scopedKey, [...(byDocumentNumber.get(scopedKey) ?? []), entry]);
    }
    for (const entries of byDocumentNumber.values()) {
        if (entries.length > 1) {
            entries.forEach(({ record }) => record.pendingReasons.push("duplicate-question-number-in-document"));
        }
    }

    const byFingerprint = new Map();
    for (const entry of allRecords) {
        byFingerprint.set(entry.record.contentFingerprint, [
            ...(byFingerprint.get(entry.record.contentFingerprint) ?? []),
            entry,
        ]);
    }

    let duplicatesSkipped = 0;
    const groups = [];
    for (const entries of byFingerprint.values()) {
        entries.sort((first, second) => first.document.documentIndex - second.document.documentIndex
            || first.record.recordIndex - second.record.recordIndex);
        const documentIds = new Set(entries.map(({ document }) => document.sourceDocumentId));
        const canDedupeAcrossDocuments = entries.length > 1 && documentIds.size === entries.length;
        const grouped = canDedupeAcrossDocuments ? [entries] : entries.map((entry) => [entry]);
        if (canDedupeAcrossDocuments) duplicatesSkipped += entries.length - 1;
        for (const occurrences of grouped) {
            const canonical = occurrences[0];
            groups.push({
                number: canonical.record.normalizedQuestionNumber,
                identityKey: `${canonical.document.originalSha256}:${canonical.record.normalizedQuestionNumber || `record-${canonical.record.recordIndex}`}`,
                entries: occurrences,
            });
        }
    }
    return { groups, duplicatesSkipped };
}

function buildSummary(plan, failed = []) {
    const records = plan.documents.flatMap((document) => document.records);
    const pending = records.filter((record) => record.pendingReasons.length);
    const recordTypes = [...new Set(records.map((record) => record.originalType))];
    const byType = Object.fromEntries(recordTypes.map((type) => [type, records.filter((record) => record.originalType === type).length]));
    const byFile = Object.fromEntries(plan.documents.map((document) => [document.fileName, {
        parsed: document.records.length,
        publishable: document.records.filter((record) => !record.pendingReasons.length).length,
        pendingReview: document.records.filter((record) => record.pendingReasons.length).length,
        pages: document.pageCount,
        images: document.pdfImageCount,
        htmlImages: document.htmlImageCount,
        stableImages: document.stableImageCount,
    }]));
    const uniquePublishable = plan.questionGroups.filter((group) => group.publishable).length;
    const publishableGroups = plan.questionGroups.filter((group) => group.publishable);
    const pendingReasons = {};
    for (const record of records) {
        for (const reason of new Set(record.pendingReasons)) {
            pendingReasons[reason] = (pendingReasons[reason] ?? 0) + 1;
        }
    }
    const gradingPolicyParts = {};
    for (const group of publishableGroups) {
        for (const part of group.canonical.record.structured.parts) {
            gradingPolicyParts[part.gradingPolicy] = (gradingPolicyParts[part.gradingPolicy] ?? 0) + 1;
        }
    }
    const automaticPublished = publishableGroups.filter((group) =>
        group.canonical.record.structured.parts.every((part) => part.gradingPolicy === "automatic")).length;
    const manualReviewPublished = publishableGroups.filter((group) =>
        group.canonical.record.structured.parts.some((part) => part.gradingPolicy === "manual_review")).length;
    const sourceAssetCount = plan.documents.length;
    const questionAssets = new Set(records.flatMap((record) => record.images.map((image) => image.checksum))).size;
    return {
        sourceFiles: plan.documents.length,
        parsed: records.length,
        published: uniquePublishable,
        pendingReview: pending.length,
        duplicatesSkipped: plan.duplicatesSkipped,
        failed: failed.length,
        failedFiles: failed,
        byType,
        byFile,
        pendingReasons,
        automaticPublished,
        manualReviewPublished,
        gradingPolicyParts,
        pageMapping: {
            total: records.length,
            unique: records.filter((record) => record.sourcePage !== null).length,
            ambiguous: records.filter((record) => record.sourcePage === null).length,
        },
        assetCounts: { sourceDocuments: sourceAssetCount, questionContent: questionAssets },
        batchId: plan.batchId,
        sourceDocumentIds: plan.documents.map((document) => document.sourceDocumentId),
    };
}

async function resolveSourceSelection(sourceInput, allowDirectory) {
    const sourceMetadata = await lstat(sourceInput).catch(() => null);
    if (!sourceMetadata) {
        throw new HanlinImportError("SOURCE_PATH_MISSING", "指定題庫來源不存在或不可讀。");
    }
    if (sourceMetadata.isSymbolicLink()) {
        throw new HanlinImportError("SOURCE_PATH_SYMLINK", "題庫來源不可使用符號連結。");
    }
    if (sourceMetadata.isFile()) {
        const fileName = path.basename(sourceInput);
        if (path.extname(fileName).toLowerCase() !== ".doc") {
            throw new HanlinImportError("INVALID_SOURCE_FILE", "指定來源檔案必須是頂層 .doc 檔案。", fileName);
        }
        return { sourceDirectory: path.dirname(sourceInput), fileNames: [fileName], sourceKind: "file" };
    }
    if (!sourceMetadata.isDirectory()) {
        throw new HanlinImportError("INVALID_SOURCE_PATH", "題庫來源必須是單一 .doc 檔案或資料夾。");
    }
    if (!allowDirectory) {
        throw new HanlinImportError(
            "WRITE_SCOPE_REQUIRES_SINGLE_FILE",
            "正式匯入必須明確指定單一 .doc 檔案；資料夾只能用於 dry-run 盤點。",
        );
    }
    const entries = await readdir(sourceInput, { withFileTypes: true });
    const fileNames = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".doc"))
        .map((entry) => entry.name)
        .sort((first, second) => first.localeCompare(second, "zh-Hant"));
    if (!fileNames.length) throw new HanlinImportError("NO_SOURCE_FILES", "指定目錄沒有頂層 .doc 題庫檔案。");
    return { sourceDirectory: sourceInput, fileNames, sourceKind: "directory" };
}

/**
 * 解析明確指定的單一 `.doc`，或盤點資料夾內所有頂層 `.doc`。
 * 只在系統暫存目錄建立轉檔中間產物；呼叫端完成後必須呼叫 cleanup。
 */
export async function prepareHanlinChineseImport(sourceInput, {
    allowDirectory = true,
    authorizedLesson = null,
} = {}) {
    const { sourceDirectory, fileNames, sourceKind } = await resolveSourceSelection(sourceInput, allowDirectory);
    const target = authorizedLesson?.target ?? TARGET_CLASSIFICATION;
    const ids = authorizedLesson?.ids ?? LOCAL_CATALOG_IDS;

    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lerniqa-curriculum-import-"));
    try {
        const documents = [];
        for (const [index, fileName] of fileNames.entries()) {
            documents.push(await convertAndParseDocument(sourceDirectory, fileName, index, temporaryRoot, authorizedLesson));
        }
        const duplicateState = addCrossDocumentDuplicateState(documents);
        let globalOrder = 0;
        for (const document of documents) {
            for (const record of document.records) {
                record.sourceOrder = globalOrder;
                globalOrder += 1;
            }
        }
        const manifest = documents.map((document) => ({
            relativePath: document.relativePath,
            originalSha256: document.originalSha256,
        }));
        const sourceSetHash = sha256Text(stableJson(manifest));
        const parserVersion = authorizedLesson?.parserVersion ?? PARSER_VERSION;
        const idempotencyKey = `${parserVersion}:${target.key}:${sourceSetHash}`;
        const batchId = deterministicUuid(`import-batch:${idempotencyKey}`);
        const questionGroups = duplicateState.groups.map((group) => {
            const conflict = group.entries.some(({ record }) => record.pendingReasons.length);
            const fingerprints = new Set(group.entries.map(({ record }) => record.contentFingerprint));
            const publishable = Boolean(group.number) && !conflict && fingerprints.size === 1;
            const publisherIdentifier = `${group.entries[0].document.originalSha256.slice(0, 16)}:${group.number}`;
            return {
                number: group.number,
                identityKey: group.identityKey,
                publishable,
                contentFingerprint: group.entries[0].record.contentFingerprint,
                publisherIdentifier: publisherIdentifier.length <= 120
                    ? publisherIdentifier
                    : `${group.entries[0].document.originalSha256.slice(0, 16)}:${sha256Text(group.number)}`,
                canonical: group.entries[0],
                occurrences: group.entries,
                questionId: group.number ? deterministicUuid(`question:${target.publisherCode}:${group.identityKey}`) : null,
                revisionId: group.number ? deterministicUuid(`revision:${batchId}:${group.identityKey}:${group.entries[0].record.contentFingerprint}`) : null,
            };
        });
        const plan = {
            parserVersion,
            target,
            sourceKind,
            ids: { ...ids },
            idempotencyKey,
            batchId,
            sourceSetHash,
            documents,
            questionGroups,
            duplicatesSkipped: duplicateState.duplicatesSkipped,
        };
        return {
            plan,
            summary: buildSummary(plan),
            cleanup: () => rm(temporaryRoot, { recursive: true, force: true }),
        };
    }
    catch (error) {
        await rm(temporaryRoot, { recursive: true, force: true });
        throw error;
    }
}

async function copyVerified(sourcePath, destinationPath, expectedChecksum) {
    await mkdir(path.dirname(destinationPath), { recursive: true });
    try {
        await copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL);
    }
    catch (error) {
        if (error?.code !== "EEXIST") throw error;
    }
    const checksum = sha256Buffer(await readFile(destinationPath));
    if (checksum !== expectedChecksum) {
        throw new HanlinImportError("ASSET_CHECKSUM_MISMATCH", `本機資產 ${path.basename(destinationPath)} 雜湊不符。`);
    }
}

/** 把已驗證來源與圖片寫到本機資產目錄；storage_key 永遠維持相對路徑。 */
export async function materializeHanlinAssets(plan, assetRoot) {
    const resolvedRoot = path.resolve(assetRoot);
    const written = new Set();
    for (const document of plan.documents) {
        assertAssetStorageKey(document.storageKey);
        const sourceDestination = path.resolve(resolvedRoot, ...document.storageKey.split("/"));
        if (!sourceDestination.startsWith(`${resolvedRoot}${path.sep}`)) {
            throw new HanlinImportError("INVALID_STORAGE_KEY", "來源資產 storage_key 超出本機資產根目錄。");
        }
        await copyVerified(document.sanitizedPath, sourceDestination, document.sanitizedSha256);
        written.add(document.storageKey);
        assertAssetStorageKey(document.originalStorageKey);
        const quarantineDestination = path.resolve(resolvedRoot, ...document.originalStorageKey.split("/"));
        if (!quarantineDestination.startsWith(`${resolvedRoot}${path.sep}`)) {
            throw new HanlinImportError("INVALID_STORAGE_KEY", "隔離資產 storage_key 超出本機資產根目錄。");
        }
        await copyVerified(document.sourcePath, quarantineDestination, document.originalSha256);
        written.add(document.originalStorageKey);
        for (const record of document.records) {
            for (const image of record.images) {
                if (written.has(image.storageKey)) continue;
                assertAssetStorageKey(image.storageKey);
                const imageDestination = path.resolve(resolvedRoot, ...image.storageKey.split("/"));
                if (!imageDestination.startsWith(`${resolvedRoot}${path.sep}`)) {
                    throw new HanlinImportError("INVALID_STORAGE_KEY", "題目資產 storage_key 超出本機資產根目錄。");
                }
                await copyVerified(image.temporaryPath, imageDestination, image.checksum);
                written.add(image.storageKey);
            }
        }
    }
    return [...written];
}

function expectedAssetChecksums(plan) {
    const values = new Map();
    for (const document of plan.documents) {
        values.set(document.originalStorageKey, document.originalSha256);
        values.set(document.storageKey, document.sanitizedSha256);
        for (const record of document.records) {
            for (const image of record.images) values.set(image.storageKey, image.checksum);
        }
    }
    return values;
}

/**
 * 將同一檔案系統內的 staging 檔以 hard-link 排他方式提升到正式位置。
 * 已存在的檔案只驗證 checksum，不會覆寫；回傳值只列出本次新建檔案。
 */
export async function promoteHanlinAssets(plan, stagingRoot, assetRoot, storageKeys) {
    const resolvedStaging = path.resolve(stagingRoot);
    const resolvedAssetRoot = path.resolve(assetRoot);
    const checksums = expectedAssetChecksums(plan);
    const createdStorageKeys = [];
    try {
        for (const storageKey of storageKeys) {
            assertAssetStorageKey(storageKey);
            const expectedChecksum = checksums.get(storageKey);
            if (!expectedChecksum) throw new HanlinImportError("UNKNOWN_STAGED_ASSET", "staging 出現未知資產。");
            const stagedPath = path.resolve(resolvedStaging, ...storageKey.split("/"));
            const finalPath = path.resolve(resolvedAssetRoot, ...storageKey.split("/"));
            if (!stagedPath.startsWith(`${resolvedStaging}${path.sep}`)
                || !finalPath.startsWith(`${resolvedAssetRoot}${path.sep}`)) {
                throw new HanlinImportError("INVALID_STORAGE_KEY", "資產路徑超出 staging 或正式根目錄。");
            }
            const existing = await readFile(finalPath).catch((error) => {
                if (error?.code === "ENOENT") return null;
                throw error;
            });
            if (existing) {
                if (sha256Buffer(existing) !== expectedChecksum) {
                    throw new HanlinImportError("ASSET_CHECKSUM_MISMATCH", `已存在資產 ${path.basename(finalPath)} 雜湊不符。`);
                }
                continue;
            }
            await mkdir(path.dirname(finalPath), { recursive: true });
            try {
                await link(stagedPath, finalPath);
            }
            catch (error) {
                if (error?.code === "EEXIST") {
                    const raced = await readFile(finalPath);
                    if (sha256Buffer(raced) !== expectedChecksum) throw error;
                    continue;
                }
                if (error?.code !== "EXDEV") throw error;
                await copyFile(stagedPath, finalPath, fsConstants.COPYFILE_EXCL);
            }
            createdStorageKeys.push(storageKey);
            await unlink(stagedPath).catch((error) => {
                if (error?.code !== "ENOENT") throw error;
            });
        }
        return { createdStorageKeys };
    }
    catch (error) {
        await rollbackHanlinAssets(assetRoot, createdStorageKeys);
        throw error;
    }
}

/** 僅刪除本次 promote 新建的確切檔案，不觸碰既有資產。 */
export async function rollbackHanlinAssets(assetRoot, createdStorageKeys) {
    const resolvedAssetRoot = path.resolve(assetRoot);
    for (const storageKey of [...createdStorageKeys].reverse()) {
        assertAssetStorageKey(storageKey);
        const finalPath = path.resolve(resolvedAssetRoot, ...storageKey.split("/"));
        if (!finalPath.startsWith(`${resolvedAssetRoot}${path.sep}`)) continue;
        await unlink(finalPath).catch((error) => {
            if (error?.code !== "ENOENT") throw error;
        });
    }
}

export async function cleanupHanlinAssetStaging(stagingRoot) {
    await rm(stagingRoot, { recursive: true, force: true });
}

export function safeFailureSummary(error) {
    return {
        sourceFiles: 0,
        parsed: 0,
        published: 0,
        pendingReview: 0,
        duplicatesSkipped: 0,
        failed: 1,
        failedFiles: [{
            fileName: error instanceof HanlinImportError ? error.fileName : null,
            code: error instanceof HanlinImportError ? error.code : "IMPORT_FAILED",
            message: error instanceof Error ? error.message : "匯入失敗。",
        }],
        byType: {},
        byFile: {},
        pendingReasons: {},
        automaticPublished: 0,
        manualReviewPublished: 0,
        gradingPolicyParts: {},
        pageMapping: { total: 0, unique: 0, ambiguous: 0 },
        assetCounts: { sourceDocuments: 0, questionContent: 0 },
        batchId: null,
        sourceDocumentIds: [],
    };
}
