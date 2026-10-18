#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    HANLIN_SOCIAL_TYPES,
    catalogIdsForTarget,
    cleanupHanlinAssetStaging,
    materializeHanlinAssets,
    prepareHanlinChineseImport,
    promoteHanlinAssets,
    rollbackHanlinAssets,
    deterministicUuid,
} from "./lib/hanlin-chinese-import.mjs";
import { validateHanlinPostgresPlan, writeHanlinPostgresImport } from "./lib/hanlin-postgres-writer.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPROVED_NATIVE_TABLE_MAPPINGS_PATH = path.join(REPOSITORY_ROOT, "scripts", "data", "social-native-table-mappings.json");
const APPROVED_NATIVE_TABLE_MAPPINGS_BY_SOURCE_SHA256 = Object.freeze(
    JSON.parse(readFileSync(APPROVED_NATIVE_TABLE_MAPPINGS_PATH, "utf8")),
);
const DEFAULT_SOURCE_ROOT = "/Users/chianlin/Library/CloudStorage/GoogleDrive-jean@minmax.biz/我的雲端硬碟/個人/題庫資料/國中/國中社會/題本檔案/01_第一冊";
const SOURCE_RULES = Object.freeze([
    Object.freeze({ folder: "01_試題", geographyEnd: 21, historyEnd: 34, code: "publisher-test-bank", name: "出版社題庫", suffix: "bank" }),
    Object.freeze({ folder: "02_素養題", geographyEnd: 15, historyEnd: 27, code: "literacy-question", name: "素養題", suffix: "literacy" }),
    Object.freeze({ folder: "04_練習本", geographyEnd: 19, historyEnd: 31, code: "workbook-practice", name: "練習本", suffix: "workbook" }),
    Object.freeze({ folder: "05_各章節基測試題", geographyEnd: 15, historyEnd: 25, code: "basic-competency-test", name: "基測", suffix: "bct" }),
    Object.freeze({ folder: "06_各章節會考試題", geographyEnd: 13, historyEnd: 24, code: "comprehensive-assessment", name: "會考", suffix: "cap" }),
]);
const SUBJECTS = Object.freeze({
    geography: Object.freeze({ code: "geography", name: "地理", alias: "地理", marker: "01", short: "geo" }),
    history: Object.freeze({ code: "history", name: "歷史", alias: "歷史", marker: "02", short: "hist" }),
    civics: Object.freeze({ code: "civics", name: "公民", alias: "公民", marker: "03", short: "civ" }),
});
const EMPTY_APPROVED_QUESTION_TABLE_MAPPINGS = Object.freeze([]);
const EMPTY_APPROVED_VISUAL_MATCHING_REPAIRS = Object.freeze([]);
const EMPTY_APPROVED_CHOICE_REPAIRS = Object.freeze([]);
const EMPTY_APPROVED_MULTI_PART_REPAIRS = Object.freeze([]);
const EMPTY_APPROVED_QUESTION_IMAGE_MAPPINGS = Object.freeze([]);
const EMPTY_APPROVED_NO_VISUAL_REFERENCE_QUESTION_NUMBERS = Object.freeze([]);
const APPROVED_SOCIAL_QUESTION_IMAGE_MAPPINGS_BY_SOURCE_SHA256 = Object.freeze({
    "d6055170f791ba32cfc98561eb390811d8e78c23888b38a6a63b2ec21fc19634": Object.freeze([
        Object.freeze({ checksum: "24f87ad66feb585278fb10c569c6cda250c439d1eb8208db6394d1b2d1e28f16", questionNumber: "05015522", placement: "prompt", optionKey: "A", altText: "小家庭選項 A" }),
        Object.freeze({ checksum: "e9f9de8b7a400c4c26a49d335c95f9e1b227de6f48fe1de17bae718b9f1be84d", questionNumber: "05015522", placement: "prompt", optionKey: "B", altText: "小家庭選項 B" }),
        Object.freeze({ checksum: "b2744b896ae56ca78421977cc66b06b37c3d930c8f089da2c94c2560d60dab6c", questionNumber: "05015522", placement: "prompt", optionKey: "C", altText: "小家庭選項 C" }),
        Object.freeze({ checksum: "601755642b5173812ad01a6260b559d2b12347e4530b88e19db2ab070328416e", questionNumber: "05015522", placement: "prompt", optionKey: "D", altText: "小家庭選項 D" }),
    ]),
    "6c3f892321a81a2e54165e478da3d2317d8c4417e2c23a8a5c6332d89a288e45": Object.freeze([
        Object.freeze({ checksum: "e84282a2a4a9e48a98f53d3424497a73c70ce13b455f90a69abc9aaaa9315242", questionNumber: "05013443", placement: "prompt", altText: "臺灣北部木梘灌溉位置圖" }),
        Object.freeze({ checksum: "2248a487366c496e5be80a2b4af3e2e46ff40744f1974bb662e803ebb7952400", questionNumber: "05013453", placement: "prompt", altText: "清代臺灣四大水圳位置圖" }),
        Object.freeze({ checksum: "e84282a2a4a9e48a98f53d3424497a73c70ce13b455f90a69abc9aaaa9315242", questionNumber: "05013462", placement: "prompt", altText: "清代臺灣四大水圳位置圖" }),
        Object.freeze({ checksum: "e84282a2a4a9e48a98f53d3424497a73c70ce13b455f90a69abc9aaaa9315242", questionNumber: "05013464", placement: "prompt", altText: "清代臺灣四大水圳位置圖" }),
    ]),
    "bbec37fb684464662895e7d5c18af974bdef15761e360bb9e14fcc175f69f7bd": Object.freeze([
        Object.freeze({ checksum: "e46164c10ee02d147e069ab60b8863897f87153c9bc582e0c37a2632901304bd", questionNumber: "05015424", placement: "prompt", optionKey: "A", altText: "社會變遷趨勢選項 A" }),
        Object.freeze({ checksum: "36dcbf5e2694435e444a151a8b4b5c1bac9322773fc64fd0c09ad3bb3c7b59c1", questionNumber: "05015424", placement: "prompt", optionKey: "B", altText: "社會變遷趨勢選項 B" }),
        Object.freeze({ checksum: "42c415546411a748ab610c718364d68d9c48ce110c4c5f96b138ca3ad0cba85c", questionNumber: "05015424", placement: "prompt", optionKey: "C", altText: "社會變遷趨勢選項 C" }),
        Object.freeze({ checksum: "38e3f197d74a088f71d8e8f40adc8a164bfac596d21a5a308f77b0b856bec6db", questionNumber: "05015424", placement: "prompt", optionKey: "D", altText: "社會變遷趨勢選項 D" }),
    ]),
    "b1c8d76a0e277becd711880f72751fcc21db5aa90d833d1b85f519e8a192a668": Object.freeze([
        Object.freeze({ checksum: "965713584ca8def8cb29029e29f0483fcbd61292ac39e4f5e1f90dc1eb962c11", questionNumber: "05013389", placement: "prompt", altText: "清代臺灣七處地點略圖" }),
    ]),
    "115d1aec5e5e73af3bf1cf7e8118d2af8065d504248d24d159d72400b3878b23": Object.freeze([
        Object.freeze({ checksum: "6673e13d89db8d1996d5741b0ba4bae21ad0ad68f570d55350fd4f0d4e8a7ff4", questionNumber: "05014460", placement: "prompt", optionKey: "A", altText: "甲國統計圖選項 A" }),
        Object.freeze({ checksum: "d7a85c17c0b466c97b593c7f59ad93b11f31f13ace9e47934f19691b41d0cce0", questionNumber: "05014460", placement: "prompt", optionKey: "B", altText: "甲國統計圖選項 B" }),
        Object.freeze({ checksum: "7ba04016df45d95630e56bc47783ed6929bcdb9103fc12c8dd101827b098a5c7", questionNumber: "05014460", placement: "prompt", optionKey: "C", altText: "甲國統計圖選項 C" }),
        Object.freeze({ checksum: "abeff5044d05347afa59384e73698850319a1406d85cdf3c321b0b7fb90055ed", questionNumber: "05014460", placement: "prompt", optionKey: "D", altText: "甲國統計圖選項 D" }),
    ]),
    "c6d0246c5293eeecc3fb5afe3a57fcb6280675cb5eeb300c608fd8906e2b0d97": Object.freeze([
        Object.freeze({ checksum: "7f70ff3fcabe3de30a65a47ca56e7e8b68a1ca568383be9d428edc3628fc4ddc", questionNumber: "05015597", placement: "prompt", optionKey: "A", altText: "臺灣海岸景觀選項 A" }),
        Object.freeze({ checksum: "b87a4ae716f7201dd18d8f6eca7265f86f25637c55835e340013c41f687df6b0", questionNumber: "05015597", placement: "prompt", optionKey: "B", altText: "臺灣海岸景觀選項 B" }),
        Object.freeze({ checksum: "c0d3f12c79cf9c4ce19f14bacb26e6d229a1d95c68466fa929220d268839c5ef", questionNumber: "05015597", placement: "prompt", optionKey: "C", altText: "臺灣海岸景觀選項 C" }),
        Object.freeze({ checksum: "ec7b72f852d1279832115b34dd899afe33f70be05b64f87822d3c4095e5eb239", questionNumber: "05015597", placement: "prompt", optionKey: "D", altText: "臺灣海岸景觀選項 D" }),
    ]),
    "a714290ca525cce3b6d84e0e439b1e79ed8dbdf1b227ff622ccf43b880f4639b": Object.freeze([
        Object.freeze({ checksum: "94c97d2be25f9eb85b3549d7660c3b26a643eb089c175ee8fb5017a9af97f8cc", questionNumber: "05012004", placement: "prompt", optionKey: "A", altText: "氣候圖選項 A" }),
        Object.freeze({ checksum: "73d2b80d7693a5c5bb91210c101787dd5f52c54e637e2a13278243f233c4600f", questionNumber: "05012004", placement: "prompt", optionKey: "B", altText: "氣候圖選項 B" }),
        Object.freeze({ checksum: "4fec185b7b0fa26c6a3c73007ae708ad4232418bb3483f7df088f6adb48ed726", questionNumber: "05012004", placement: "prompt", optionKey: "C", altText: "氣候圖選項 C" }),
        Object.freeze({ checksum: "6b7b447f0511c07d87225ce1505befcd4d77d3e555b7b3b17b162db4dd146014", questionNumber: "05012004", placement: "prompt", optionKey: "D", altText: "氣候圖選項 D" }),
        Object.freeze({ checksum: "d28aac1c4fc71ebb98ed316463299c2779af878ed67df1f40c310de3923aa6d6", questionNumber: "05012258", placement: "prompt", altText: "六條河川水文資料表" }),
    ]),
    "80d16c35ff2bbca2e50e1a612eb0f1a8341c88b8972a4abbdf11c9ad05862685": Object.freeze([
        Object.freeze({ checksum: "317f20bf4fb22235926dcac7cebadedc7b07ed95f028a1907b7600678061dfe3", questionNumber: "05012068", placement: "prompt", altText: "臺灣某河川平均流量變化圖" }),
        Object.freeze({ checksum: "8178d242de142dec553da3a856a04a942df756b30069fb9f6fa8bb3bc255dd44", questionNumber: "05012092", placement: "prompt", optionKey: "A", altText: "年降水量圖" }),
        Object.freeze({ checksum: "0d354170124f54b6bf1e157de2e52fd757baa8693932c232136584328f1c964c", questionNumber: "05012092", placement: "prompt", optionKey: "B", altText: "衛星雲圖" }),
        Object.freeze({ checksum: "6241bf72a71151ab1b0417dc5ccb3ddda05bfada5735e7fe2d2b41d96c51ab9f", questionNumber: "05012092", placement: "prompt", optionKey: "C", altText: "月均溫圖" }),
        Object.freeze({ checksum: "7ee76f3341431923d00b8a41481b74a7e7b030ee990ddb2cc938a1a692b677c6", questionNumber: "05012092", placement: "prompt", optionKey: "D", altText: "地面天氣圖" }),
    ]),
    "bdddf49cbeb57f7ca1d0559d94ca5dce265b974767563dab2770ee52efdc3f10": Object.freeze([
        Object.freeze({ checksum: "6f017250eb48bc6b2477b423d0b94ef7f76391d83a9a11a76bc6f59b6fef62d1", questionNumber: "05011968", placement: "prompt", altText: "河川流域分布圖" }),
    ]),
    "f73af816586fa1038c95b5ff93c5cca7f120051283318f2e6e1ee6f9a033aa97": Object.freeze([
        Object.freeze({ checksum: "b0b081a4b6938a20c8e0360f4b5751b17e92689ca1e454de4f73f5acfac9d2b8", questionNumber: "05012877", placement: "prompt", optionKey: "A", altText: "卑南文化出土文物選項 A" }),
        Object.freeze({ checksum: "e5a6f866560a9ce7f3c7240a3dd510a62a0f3b15848567ca6dbe0f68401680ba", questionNumber: "05012877", placement: "prompt", optionKey: "B", altText: "卑南文化出土文物選項 B" }),
        Object.freeze({ checksum: "bf45f643e17ea33c157029f65d180288bb5abe553eb9a505e1aeace2856f5474", questionNumber: "05012877", placement: "prompt", optionKey: "C", altText: "卑南文化出土文物選項 C" }),
        Object.freeze({ checksum: "51c9513d26e650b838dd505b4018eb3f385f0ffd64be4eb8899f59f6cf76ef8c", questionNumber: "05012877", placement: "prompt", optionKey: "D", altText: "卑南文化出土文物選項 D" }),
    ]),
    "4fda3d2df9bfc18ba23bb36ce9b8777550cb5b37a21cb8879e76acb96938a2a5": Object.freeze([
        Object.freeze({ checksum: "085453dccfedb18352cf987a6a3654144dd4d22d02263d7629db938f690c7576", questionNumber: "05012327", placement: "prompt", altText: "假想島嶼圖" }),
        Object.freeze({ checksum: "250422547cf18e1b2a4c1ea8cc2c1a78bfde34e29cfd6e4aeba43e25d5e9d780", questionNumber: "05012327", placement: "prompt", optionKey: "A", altText: "山地降水分布選項 A" }),
        Object.freeze({ checksum: "df8816074d2143f0973a584b0c761db28c67efce4d821d6ff3ea9aba21b0c26b", questionNumber: "05012327", placement: "prompt", optionKey: "B", altText: "山地降水分布選項 B" }),
        Object.freeze({ checksum: "0e6e8aa31e32367e438d2ff43c4155ee460f77e19061362d5e2dbd11fd64ba60", questionNumber: "05012327", placement: "prompt", optionKey: "C", altText: "山地降水分布選項 C" }),
        Object.freeze({ checksum: "2164f12d19f505709a708caee722c911a6febbdea9c44fe915af8dcbec54bb78", questionNumber: "05012327", placement: "prompt", optionKey: "D", altText: "山地降水分布選項 D" }),
    ]),
    "29547f492f0fc65220ff84c105bb5dc0b798a3c926af628a04020d3f77d69656": Object.freeze([
        Object.freeze({ checksum: "185c38d96babb0cf76ec95f5c7002bdbe89a2aecf01f8a32c2f3c6887536eb2b", questionNumber: "05010967", placement: "prompt", altText: "臺灣地形區與 A 至 D 圖片選項" }),
    ]),
    "fe3dcdcae89cded5fed4fbf83e0bcde3b9659a7b563d0f30a3bae4dbf167d05a": Object.freeze([
        Object.freeze({ checksum: "36f5c40e4bcedb5abb90cfb550d43386e860bf2649f26e22e2af1ea00afc10db", questionNumber: "05010738", placement: "prompt", altText: "宜蘭縣分層設色圖與四條剖面線" }),
        Object.freeze({ checksum: "4fe0674339de633846623adf5fe05187ef3470c072033960a40d3acad9db7365", questionNumber: "05010738", placement: "prompt", optionKey: "A", altText: "地形剖面圖選項 A" }),
        Object.freeze({ checksum: "14b9ce85c014725edb25ef4f93e45b66bb4eebf11665c161e8150a2541c657e5", questionNumber: "05010738", placement: "prompt", optionKey: "B", altText: "地形剖面圖選項 B" }),
        Object.freeze({ checksum: "e60f5f91b674f6bd7ef2c737e0eb5cccb33d4c3f45f60a292126175c171a388d", questionNumber: "05010738", placement: "prompt", optionKey: "C", altText: "地形剖面圖選項 C" }),
        Object.freeze({ checksum: "5ba83f0527f992ad1a53401f964550ec7aa3903a58dbb626e325bf2573b477ef", questionNumber: "05010738", placement: "prompt", optionKey: "D", altText: "地形剖面圖選項 D" }),
        Object.freeze({ checksum: "5cbf61c55e02621a84811da3bb2a0b94bc116bd6109133a1eafa2d540a07a2e4", questionNumber: "05010738", placement: "explanation", altText: "解析剖面圖一" }),
        Object.freeze({ checksum: "29a08ace1c3183f64e046cd5382531e7c1adf64aed4f0668ed8e15d2a4506199", questionNumber: "05010738", placement: "explanation", altText: "解析剖面圖二" }),
        Object.freeze({ checksum: "54652dadc72729f21b23a4b7423feb5771e39f307ac4394d0f15daff2e3f5b6d", questionNumber: "05010738", placement: "explanation", altText: "解析剖面圖三" }),
        Object.freeze({ checksum: "c886cff0b1ed242645e0421833699c937fbc97c2160b3428171907d5fe5beec2", questionNumber: "05010738", placement: "explanation", altText: "解析剖面圖四" }),
    ]),
    "0501e6a192b8abef9abd4264669afe14b137a8064be4e2a0fccc3f870ac8b7f2": Object.freeze([
        Object.freeze({ checksum: "352ea2cc9b855ed4a442cb63693cd02d04485c881cf1e3971cc49c989e853c19", questionNumber: "05015709", placement: "prompt", altText: "全臺未來強震發生機率分布圖" }),
        Object.freeze({ checksum: "a50cb28975549f83384636f2c8135a63e1f7d5b884fdf6d3ffef749445be0931", questionNumber: "05015709", placement: "prompt", partStableKey: "3", altText: "第 3 小題地形選項圖：盆地、山地、高原、平原" }),
    ]),
    "e6e06f195eaa1a9f4f77e7868f81c4ce19fc5e32a70341deb10af11a4e9aa269": Object.freeze([
        Object.freeze({ checksum: "ab3ada7cf5025d90e50489a8edba26918ee2288cf5cc4e8ad9e64a0b3ef1c6b1", questionNumber: "05010672", placement: "prompt", altText: "甲乙兩地地形景觀" }),
    ]),
    "084ab4ab0de0e427b4e2d20d976bc8c7773a947d5293da49a74f276c8c58f153": Object.freeze([
        Object.freeze({ checksum: "9c0f5fac9d3084365176d23d7140ce273a4b353d8415a6343523b24d4a1bf802", questionNumber: "05015705", placement: "prompt", optionKey: "A", altText: "外營力地形選項 A" }),
        Object.freeze({ checksum: "8e4905866331449e6592c68b79bb935824317e5f29a24e1ba0efa57aee24d7ce", questionNumber: "05015705", placement: "prompt", optionKey: "B", altText: "外營力地形選項 B" }),
    ]),
    "5eb2ecdf94eb025c3309c07fe6cc191454fe9b71fc7f3f6a53ccb9881f0e370c": Object.freeze([
        Object.freeze({ checksum: "1116c71102670f9938f536dbeb01af662de1b21e849938bcad79a17f53f72313", questionNumber: "05010633", placement: "prompt", altText: "童話世界廣場園區示意圖" }),
        Object.freeze({ checksum: "57102217548c091346a9a3ce5387b7d24d77d608d08a765d8a8b7d3db26a95c5", questionNumber: "05010633", placement: "prompt", optionKey: "A", altText: "座標標示選項 A" }),
        Object.freeze({ checksum: "fd908467d5af96cf0a9982627ce2dddbe87c32b4398387fef031695c9987f602", questionNumber: "05010633", placement: "prompt", optionKey: "B", altText: "座標標示選項 B" }),
        Object.freeze({ checksum: "8ea2ddba9bcefa7cdb4d29248c7acebf3f24503b7c62745823ea31117f436dfc", questionNumber: "05010633", placement: "prompt", optionKey: "C", altText: "座標標示選項 C" }),
        Object.freeze({ checksum: "0cc7a5b9b306391ac67d899d49d734867f5bcb5fe81f0c377f8338da6f922822", questionNumber: "05010633", placement: "prompt", optionKey: "D", altText: "座標標示選項 D" }),
    ]),
});
const APPROVED_SOCIAL_NO_VISUAL_REFERENCE_QUESTION_NUMBERS_BY_SOURCE_SHA256 = Object.freeze({
    "ddd19a5eddcd08e2289b98c06400d2321648d628acfe9eb74b028ecd225fb89b": Object.freeze([
        "05015174",
    ]),
    "7afb6c58d251a0181042bbeee7a935058eb70eb12a18085ccac6afbb7bc781fa": Object.freeze([
        "05014903",
    ]),
    "26ceec0b474ae9e1de6ac54e855b494c0a218d8860f79a658435e15e55f6cc8c": Object.freeze([
        "05014249",
    ]),
    "58cd99a10171f01b55e2f44389c9519ca95695df9ac44240dc7afe87b23eee6a": Object.freeze([
        "05013604",
    ]),
    "b1c8d76a0e277becd711880f72751fcc21db5aa90d833d1b85f519e8a192a668": Object.freeze([
        "05013360",
    ]),
    "a98f16470723a96fae700d1843f159e86bf5cc70771b310eaabc456ada6206aa": Object.freeze([
        "05013122",
    ]),
    "fe3dcdcae89cded5fed4fbf83e0bcde3b9659a7b563d0f30a3bae4dbf167d05a": Object.freeze([
        "05010739", "05010740", "05010786", "05010790", "05010849",
    ]),
    "2be98787d2dc39b95e6f3f718355f3738467181ff3e5d80311af28f9bc61a5b6": Object.freeze([
        "05010296",
        "05010344",
    ]),
});
const APPROVED_SOCIAL_CHOICE_REPAIRS_BY_SOURCE_SHA256 = Object.freeze({
    "2be98787d2dc39b95e6f3f718355f3738467181ff3e5d80311af28f9bc61a5b6": Object.freeze([
        Object.freeze({
            questionNumber: "05010356", answerKey: "D",
            nativeTableSha256: "5fbbd7cc91c85e62580bb8dbea4f056920bdb8e5626e0f2c268f6cec1fde63d1",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "表格中的（A）欄" }),
                Object.freeze({ key: "B", text: "表格中的（B）欄" }),
                Object.freeze({ key: "C", text: "表格中的（C）欄" }),
                Object.freeze({ key: "D", text: "表格中的（D）欄" }),
            ]),
        }),
        Object.freeze({
            questionNumber: "05010355",
            answerKey: "C",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "傳統地圖：更新較快；電子地圖：更新較慢" }),
                Object.freeze({ key: "B", text: "傳統地圖：資料較多；電子地圖：資料較少" }),
                Object.freeze({ key: "C", text: "傳統地圖：資料搜索較慢；電子地圖：資料搜索較快" }),
                Object.freeze({ key: "D", text: "傳統地圖：範圍較大；電子地圖：範圍較小" }),
            ]),
        }),
        Object.freeze({
            questionNumber: "05010363",
            answerKey: "D",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "1/10000" }),
                Object.freeze({ key: "B", text: "1:10000" }),
                Object.freeze({ key: "C", text: "一萬分之一" }),
                Object.freeze({
                    key: "D",
                    text: "圖示比例尺",
                    imageChecksum: "6139275d9d33d0f401276b59f5b41b3642117ae696ab817545d55efeb81e620c",
                }),
            ]),
        }),
    ]),
    "e6e06f195eaa1a9f4f77e7868f81c4ce19fc5e32a70341deb10af11a4e9aa269": Object.freeze([
        Object.freeze({
            questionNumber: "05010715", answerKey: "C",
            nativeTableSha256: "535c0232a34d6296d6236f2a38041f67827203593fd2a5c4140c93802324fb7c",
            options: Object.freeze(["A", "B", "C", "D"].map((key) => Object.freeze({ key, text: `表格中的（${key}）列` }))),
        }),
        Object.freeze({
            questionNumber: "05010672",
            answerKey: "C",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "甲：侵蝕作用；乙：侵蝕作用" }),
                Object.freeze({ key: "B", text: "甲：侵蝕作用；乙：堆積作用" }),
                Object.freeze({ key: "C", text: "甲：堆積作用；乙：侵蝕作用" }),
                Object.freeze({ key: "D", text: "甲：堆積作用；乙：堆積作用" }),
            ]),
        }),
    ]),
    "69b5846c8dcda78ff723b9679f51890a5e530c2adaa740f2b79e8d2bf3f0a050": Object.freeze([
        Object.freeze({
            questionNumber: "05011117", answerKey: "B",
            nativeTableSha256: "e227cf2662c2b7dddb444d14faa2138abdce620368bb382c4c0ce9b8b533f3da",
            options: Object.freeze(["A", "B", "C", "D"].map((key) => Object.freeze({ key, text: `表格中的（${key}）欄` }))),
        }),
    ]),
    "7530269da41c9b3c750979943eb89b3410246a851def3f7d9a4a91e3ddb01329": Object.freeze([
        Object.freeze({
            questionNumber: "05011254", answerKey: "C",
            nativeTableSha256: "b90fdb1288e0ecc471eebdeda22887c459f636afc8473034848ec136a06df500",
            options: Object.freeze(["A", "B", "C", "D"].map((key) => Object.freeze({ key, text: `表格中的（${key}）列` }))),
        }),
    ]),
    "f8d7460091d3a117b175f3f349abe4c46eef7d43fd78645784e77758094b72b7": Object.freeze([
        Object.freeze({
            questionNumber: "05011508", answerKey: "A",
            nativeTableSha256: "250cfe584d329725a458d8d2bfaf5427b51ad56692cd052359defe5a889e7aa1",
            options: Object.freeze(["A", "B", "C", "D"].map((key) => Object.freeze({ key, text: `表格中的（${key}）欄` }))),
        }),
    ]),
    "80d16c35ff2bbca2e50e1a612eb0f1a8341c88b8972a4abbdf11c9ad05862685": Object.freeze([
        Object.freeze({
            questionNumber: "05012121", answerKey: "C",
            nativeTableSha256: "96debc9ffd97d8a478d8884cee8fe505d099b92a382fb50a5d1e72c944067cf1",
            options: Object.freeze(["A", "B", "C", "D"].map((key) => Object.freeze({ key, text: `表格中的（${key}）列` }))),
        }),
        Object.freeze({
            questionNumber: "05012068", answerKey: "A",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "流量最高點：颱風；流量最低點：背風坡" }),
                Object.freeze({ key: "B", text: "流量最高點：雷陣雨；流量最低點：氣溫高" }),
                Object.freeze({ key: "C", text: "流量最高點：颱風；流量最低點：低氣壓籠罩" }),
                Object.freeze({ key: "D", text: "流量最高點：梅雨；流量最低點：滯留鋒面" }),
            ]),
        }),
        Object.freeze({
            questionNumber: "05012092", answerKey: "A",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "年降水量圖", imageChecksum: "8178d242de142dec553da3a856a04a942df756b30069fb9f6fa8bb3bc255dd44" }),
                Object.freeze({ key: "B", text: "衛星雲圖", imageChecksum: "0d354170124f54b6bf1e157de2e52fd757baa8693932c232136584328f1c964c" }),
                Object.freeze({ key: "C", text: "月均溫圖", imageChecksum: "6241bf72a71151ab1b0417dc5ccb3ddda05bfada5735e7fe2d2b41d96c51ab9f" }),
                Object.freeze({ key: "D", text: "地面天氣圖", imageChecksum: "7ee76f3341431923d00b8a41481b74a7e7b030ee990ddb2cc938a1a692b677c6" }),
            ]),
        }),
    ]),
    "a714290ca525cce3b6d84e0e439b1e79ed8dbdf1b227ff622ccf43b880f4639b": Object.freeze([
        Object.freeze({
            questionNumber: "05012248", answerKey: "D",
            nativeTableSha256: "ebed22b38b3663ee73a976a67c9176d99075db33872494854529b7e0198682c0",
            options: Object.freeze(["A", "B", "C", "D"].map((key) => Object.freeze({ key, text: `表格中的（${key}）列` }))),
        }),
        Object.freeze({
            questionNumber: "05012004", answerKey: "D",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "氣候圖選項 A", imageChecksum: "94c97d2be25f9eb85b3549d7660c3b26a643eb089c175ee8fb5017a9af97f8cc" }),
                Object.freeze({ key: "B", text: "氣候圖選項 B", imageChecksum: "73d2b80d7693a5c5bb91210c101787dd5f52c54e637e2a13278243f233c4600f" }),
                Object.freeze({ key: "C", text: "氣候圖選項 C", imageChecksum: "4fec185b7b0fa26c6a3c73007ae708ad4232418bb3483f7df088f6adb48ed726" }),
                Object.freeze({ key: "D", text: "氣候圖選項 D", imageChecksum: "6b7b447f0511c07d87225ce1505befcd4d77d3e555b7b3b17b162db4dd146014" }),
            ]),
        }),
    ]),
    "da7824313b42dc657d1fb792bfb67311ebdd5b7df047261d064f1b8bd7024e49": Object.freeze([
        Object.freeze({
            questionNumber: "05015630", answerKey: "B",
            nativeTableSha256: "d92c5d8564132c68cbde367d83ddcd4857b0a627df9c8cfb6c84dc10ac850718",
            options: Object.freeze(["A", "B", "C", "D"].map((key) => Object.freeze({ key, text: `表格中的（${key}）列` }))),
        }),
    ]),
    "d6055170f791ba32cfc98561eb390811d8e78c23888b38a6a63b2ec21fc19634": Object.freeze([
        Object.freeze({
            questionNumber: "05015522", answerKey: "A",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "與弟弟、爸爸媽媽及一隻狗同住", imageChecksum: "24f87ad66feb585278fb10c569c6cda250c439d1eb8208db6394d1b2d1e28f16" }),
                Object.freeze({ key: "B", text: "與爸爸媽媽及阿公同住", imageChecksum: "e9f9de8b7a400c4c26a49d335c95f9e1b227de6f48fe1de17bae718b9f1be84d" }),
                Object.freeze({ key: "C", text: "與奶奶及阿姨一家人同住", imageChecksum: "b2744b896ae56ca78421977cc66b06b37c3d930c8f089da2c94c2560d60dab6c" }),
                Object.freeze({ key: "D", text: "未婚且與女朋友同住", imageChecksum: "601755642b5173812ad01a6260b559d2b12347e4530b88e19db2ab070328416e" }),
            ]),
        }),
    ]),
    "bbec37fb684464662895e7d5c18af974bdef15761e360bb9e14fcc175f69f7bd": Object.freeze([
        Object.freeze({
            questionNumber: "05015424", answerKey: "D",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "社會變遷趨勢選項 A", imageChecksum: "e46164c10ee02d147e069ab60b8863897f87153c9bc582e0c37a2632901304bd" }),
                Object.freeze({ key: "B", text: "社會變遷趨勢選項 B", imageChecksum: "36dcbf5e2694435e444a151a8b4b5c1bac9322773fc64fd0c09ad3bb3c7b59c1" }),
                Object.freeze({ key: "C", text: "社會變遷趨勢選項 C", imageChecksum: "42c415546411a748ab610c718364d68d9c48ce110c4c5f96b138ca3ad0cba85c" }),
                Object.freeze({ key: "D", text: "社會變遷趨勢選項 D", imageChecksum: "38e3f197d74a088f71d8e8f40adc8a164bfac596d21a5a308f77b0b856bec6db" }),
            ]),
        }),
    ]),
    "115d1aec5e5e73af3bf1cf7e8118d2af8065d504248d24d159d72400b3878b23": Object.freeze([
        Object.freeze({
            questionNumber: "05014460", answerKey: "C",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "甲國統計圖選項 A", imageChecksum: "6673e13d89db8d1996d5741b0ba4bae21ad0ad68f570d55350fd4f0d4e8a7ff4" }),
                Object.freeze({ key: "B", text: "甲國統計圖選項 B", imageChecksum: "d7a85c17c0b466c97b593c7f59ad93b11f31f13ace9e47934f19691b41d0cce0" }),
                Object.freeze({ key: "C", text: "甲國統計圖選項 C", imageChecksum: "7ba04016df45d95630e56bc47783ed6929bcdb9103fc12c8dd101827b098a5c7" }),
                Object.freeze({ key: "D", text: "甲國統計圖選項 D", imageChecksum: "abeff5044d05347afa59384e73698850319a1406d85cdf3c321b0b7fb90055ed" }),
            ]),
        }),
    ]),
    "c6d0246c5293eeecc3fb5afe3a57fcb6280675cb5eeb300c608fd8906e2b0d97": Object.freeze([
        Object.freeze({
            questionNumber: "05015597", answerKey: "A",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "海岸景觀選項 A", imageChecksum: "7f70ff3fcabe3de30a65a47ca56e7e8b68a1ca568383be9d428edc3628fc4ddc" }),
                Object.freeze({ key: "B", text: "海岸景觀選項 B", imageChecksum: "b87a4ae716f7201dd18d8f6eca7265f86f25637c55835e340013c41f687df6b0" }),
                Object.freeze({ key: "C", text: "海岸景觀選項 C", imageChecksum: "c0d3f12c79cf9c4ce19f14bacb26e6d229a1d95c68466fa929220d268839c5ef" }),
                Object.freeze({ key: "D", text: "海岸景觀選項 D", imageChecksum: "ec7b72f852d1279832115b34dd899afe33f70be05b64f87822d3c4095e5eb239" }),
            ]),
        }),
    ]),
    "bdddf49cbeb57f7ca1d0559d94ca5dce265b974767563dab2770ee52efdc3f10": Object.freeze([
        Object.freeze({
            questionNumber: "05011968",
            answerKey: "B",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "甲 650m；乙 490m；丙 380m；丁 610m" }),
                Object.freeze({ key: "B", text: "甲 110m；乙 1,050m；丙 1,500m；丁 482m" }),
                Object.freeze({ key: "C", text: "甲 50m；乙 800m；丙 1,240m；丁 1,590m" }),
                Object.freeze({ key: "D", text: "甲 980m；乙 720m；丙 654m；丁 440m" }),
            ]),
        }),
    ]),
    "f73af816586fa1038c95b5ff93c5cca7f120051283318f2e6e1ee6f9a033aa97": Object.freeze([
        Object.freeze({
            questionNumber: "05012877",
            answerKey: "B",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "出土文物選項 A", imageChecksum: "b0b081a4b6938a20c8e0360f4b5751b17e92689ca1e454de4f73f5acfac9d2b8" }),
                Object.freeze({ key: "B", text: "出土文物選項 B", imageChecksum: "e5a6f866560a9ce7f3c7240a3dd510a62a0f3b15848567ca6dbe0f68401680ba" }),
                Object.freeze({ key: "C", text: "出土文物選項 C", imageChecksum: "bf45f643e17ea33c157029f65d180288bb5abe553eb9a505e1aeace2856f5474" }),
                Object.freeze({ key: "D", text: "出土文物選項 D", imageChecksum: "51c9513d26e650b838dd505b4018eb3f385f0ffd64be4eb8899f59f6cf76ef8c" }),
            ]),
        }),
    ]),
    "1a92f79efe9bcea3ec1323dc802777e88494868b754518330d55210f6d3d92e2": Object.freeze([
        Object.freeze({
            questionNumber: "05011609",
            answerKey: "B",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "一月月均溫 14°C；七月月均溫 28°C；年降水量 3,000 mm" }),
                Object.freeze({ key: "B", text: "一月月均溫 12°C；七月月均溫 28°C；年降水量 2,000 mm" }),
                Object.freeze({ key: "C", text: "一月月均溫 10°C；七月月均溫 20°C；年降水量 2,000 mm" }),
                Object.freeze({ key: "D", text: "一月月均溫 16°C；七月月均溫 28°C；年降水量 2,500 mm" }),
            ]),
        }),
    ]),
    "4fda3d2df9bfc18ba23bb36ce9b8777550cb5b37a21cb8879e76acb96938a2a5": Object.freeze([
        Object.freeze({
            questionNumber: "05012327",
            answerKey: "A",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "山地降水分布選項 A", imageChecksum: "250422547cf18e1b2a4c1ea8cc2c1a78bfde34e29cfd6e4aeba43e25d5e9d780" }),
                Object.freeze({ key: "B", text: "山地降水分布選項 B", imageChecksum: "df8816074d2143f0973a584b0c761db28c67efce4d821d6ff3ea9aba21b0c26b" }),
                Object.freeze({ key: "C", text: "山地降水分布選項 C", imageChecksum: "0e6e8aa31e32367e438d2ff43c4155ee460f77e19061362d5e2dbd11fd64ba60" }),
                Object.freeze({ key: "D", text: "山地降水分布選項 D", imageChecksum: "2164f12d19f505709a708caee722c911a6febbdea9c44fe915af8dcbec54bb78" }),
            ]),
        }),
    ]),
    "29547f492f0fc65220ff84c105bb5dc0b798a3c926af628a04020d3f77d69656": Object.freeze([
        Object.freeze({
            questionNumber: "05010967",
            answerKey: "B",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "圖中選項 A" }),
                Object.freeze({ key: "B", text: "圖中選項 B" }),
                Object.freeze({ key: "C", text: "圖中選項 C" }),
                Object.freeze({ key: "D", text: "圖中選項 D" }),
            ]),
        }),
    ]),
    "fe3dcdcae89cded5fed4fbf83e0bcde3b9659a7b563d0f30a3bae4dbf167d05a": Object.freeze([
        Object.freeze({
            questionNumber: "05010738",
            answerKey: "D",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "地形剖面圖選項 A", imageChecksum: "4fe0674339de633846623adf5fe05187ef3470c072033960a40d3acad9db7365" }),
                Object.freeze({ key: "B", text: "地形剖面圖選項 B", imageChecksum: "14b9ce85c014725edb25ef4f93e45b66bb4eebf11665c161e8150a2541c657e5" }),
                Object.freeze({ key: "C", text: "地形剖面圖選項 C", imageChecksum: "e60f5f91b674f6bd7ef2c737e0eb5cccb33d4c3f45f60a292126175c171a388d" }),
                Object.freeze({ key: "D", text: "地形剖面圖選項 D", imageChecksum: "5ba83f0527f992ad1a53401f964550ec7aa3903a58dbb626e325bf2573b477ef" }),
            ]),
        }),
    ]),
    "084ab4ab0de0e427b4e2d20d976bc8c7773a947d5293da49a74f276c8c58f153": Object.freeze([
        Object.freeze({
            questionNumber: "05015705",
            answerKey: "B",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "外營力地形選項 A", imageChecksum: "9c0f5fac9d3084365176d23d7140ce273a4b353d8415a6343523b24d4a1bf802" }),
                Object.freeze({ key: "B", text: "外營力地形選項 B", imageChecksum: "8e4905866331449e6592c68b79bb935824317e5f29a24e1ba0efa57aee24d7ce" }),
            ]),
        }),
    ]),
    "5eb2ecdf94eb025c3309c07fe6cc191454fe9b71fc7f3f6a53ccb9881f0e370c": Object.freeze([
        Object.freeze({
            questionNumber: "05010633",
            answerKey: "D",
            options: Object.freeze([
                Object.freeze({ key: "A", text: "座標標示選項 A", imageChecksum: "57102217548c091346a9a3ce5387b7d24d77d608d08a765d8a8b7d3db26a95c5" }),
                Object.freeze({ key: "B", text: "座標標示選項 B", imageChecksum: "fd908467d5af96cf0a9982627ce2dddbe87c32b4398387fef031695c9987f602" }),
                Object.freeze({ key: "C", text: "座標標示選項 C", imageChecksum: "8ea2ddba9bcefa7cdb4d29248c7acebf3f24503b7c62745823ea31117f436dfc" }),
                Object.freeze({ key: "D", text: "座標標示選項 D", imageChecksum: "0cc7a5b9b306391ac67d899d49d734867f5bcb5fe81f0c377f8338da6f922822" }),
            ]),
        }),
    ]),
});
const APPROVED_SOCIAL_MULTI_PART_REPAIRS_BY_SOURCE_SHA256 = Object.freeze({
    "5787d12939bd17799b7c6b62a5dd94b5cee2fb0c0ad43aaf699792bd711342f2": Object.freeze([
        Object.freeze({
            questionNumber: "05010275",
            nativeTableSha256: "5ff12c0d0057015372bf2ea305367f2c24a6d2e0753ceecef0d7538ee9916708",
            prompt: "21 世紀的再生能源使用成為重要課題，包括了水力、風力、潮汐等能源，其中以太陽能的研究最為積極，希望得以取代現有能源。然而受到各地條件差異的影響，因此科學家在進行太陽輻射能量的觀察與測量時，必須考慮到絕對位置、季節時間及氣候變化。請問：",
            expectedSourceAnswer: "(1)(C);(2)(B)",
            parts: Object.freeze([
                Object.freeze({
                    stableKey: "1",
                    prompt: "相關學者若在每年的最後一天於不同地區進行研究，其觀測點如附圖所示。請問：此時何處的陽光照射角度最大？",
                    answerKey: "C",
                    options: Object.freeze(["A", "B", "C", "D"].map((key) => Object.freeze({ key, text: key === "A" ? "甲" : key === "B" ? "乙" : key === "C" ? "丙" : "丁" }))),
                }),
                Object.freeze({
                    stableKey: "2",
                    prompt: "附表為各地區太陽輻射總量的觀測資料，請問：何者最可能位於歐洲？",
                    answerKey: "B",
                    options: Object.freeze(["A", "B", "C", "D"].map((key) => Object.freeze({ key, text: `表格中的（${key}）欄` }))),
                }),
            ]),
        }),
    ]),
    "2a34527b951cfb84d43667a049640824c54d9f00a285cd0ba89bd1e10967b6cc": Object.freeze([
        Object.freeze({
            questionNumber: "05015411",
            prompt: "下列是部落在社會變遷下所面臨的挑戰,請根據各小題的相關敘述填入正確的答案代號。\n(A)傳統文化的斷層\n(B)部落經濟的停滯\n(C)傳統領域的爭議\n(D)文化與法律的衝突",
            expectedSourceAnswer: "(1)(D);(2)(A);(3)(B);(4)(C)",
            parts: Object.freeze([
                Object.freeze({ stableKey: "1", prompt: "原住民獵人因狩獵傳統持有獵槍而遭移送法辦。", answerMode: "text", acceptedValue: "D" }),
                Object.freeze({ stableKey: "2", prompt: "族人在部落推動母語歌謠教唱及祭典文化活動。", answerMode: "text", acceptedValue: "A" }),
                Object.freeze({ stableKey: "3", prompt: "協助部落小農農產品銷售及提供網路銷售平臺。", answerMode: "text", acceptedValue: "B" }),
                Object.freeze({ stableKey: "4", prompt: "政府開發案破壞部落生活區域,侵犯其自治權。", answerMode: "text", acceptedValue: "C" }),
            ]),
        }),
    ]),
    "6c3f892321a81a2e54165e478da3d2317d8c4417e2c23a8a5c6332d89a288e45": Object.freeze([
        Object.freeze({
            questionNumber: "05013464",
            prompt: "附圖是清代在臺灣所興築的水利設施,請將水圳與圖中代號相配合。",
            expectedSourceAnswer: "(1)甲;(2)丙;(3)丁;(4)乙",
            parts: Object.freeze([
                Object.freeze({ stableKey: "1", prompt: "瑠公圳", answerMode: "text", acceptedValue: "甲" }),
                Object.freeze({ stableKey: "2", prompt: "八堡圳", answerMode: "text", acceptedValue: "丙" }),
                Object.freeze({ stableKey: "3", prompt: "曹公圳", answerMode: "text", acceptedValue: "丁" }),
                Object.freeze({ stableKey: "4", prompt: "貓霧捒圳", answerMode: "text", acceptedValue: "乙" }),
            ]),
        }),
    ]),
    "b1c8d76a0e277becd711880f72751fcc21db5aa90d833d1b85f519e8a192a668": Object.freeze([
        Object.freeze({
            questionNumber: "05013387",
            prompt: "請將臺灣歷史上各時期的治臺措施與當時主政者相配合。請填入代號。",
            expectedSourceAnswer: "(1)(甲)(戊);(2)(壬);(3)(丁)(庚);(4)(乙)(丙)(己)(辛)",
            parts: Object.freeze([
                Object.freeze({ stableKey: "1", prompt: "荷蘭治臺時期", answerMode: "text", acceptedValue: "甲、戊" }),
                Object.freeze({ stableKey: "2", prompt: "西班牙據臺時期", answerMode: "text", acceptedValue: "壬" }),
                Object.freeze({ stableKey: "3", prompt: "鄭氏治臺時期", answerMode: "text", acceptedValue: "丁、庚" }),
                Object.freeze({ stableKey: "4", prompt: "清帝國時期", answerMode: "text", acceptedValue: "乙、丙、己、辛" }),
            ]),
        }),
        Object.freeze({
            questionNumber: "05013389",
            prompt: "附圖是清代的臺灣略圖,圖中有七處地方畫有「×」記號,分別以代號稱之,請依下列的問題填入適當的代號。(可複選)",
            expectedSourceAnswer: "(1)甲乙己;(2)甲乙戊;(3)己;(4)庚",
            parts: Object.freeze([
                Object.freeze({ stableKey: "1", prompt: "英法聯軍之役後,哪些港口開放通商?", answerMode: "text", acceptedValue: "甲、乙、己" }),
                Object.freeze({ stableKey: "2", prompt: "清法戰爭時,戰火曾波及哪三地?", answerMode: "text", acceptedValue: "甲、乙、戊" }),
                Object.freeze({ stableKey: "3", prompt: "沈葆楨來臺興建的第一座西式炮臺,位在何處?", answerMode: "text", acceptedValue: "己" }),
                Object.freeze({ stableKey: "4", prompt: "同治 13 年日軍侵臺,在何處登陸?", answerMode: "text", acceptedValue: "庚" }),
            ]),
        }),
    ]),
    "91cc95bf4eb99f85bf6bb37fb5936cb4c95de3d7a147f71f23690544cca5abc7": Object.freeze([
        Object.freeze({
            questionNumber: "05013010",
            prompt: "請將下列荷蘭與西班牙的治臺措施相配合。\n(甲)積極傳播天主教\n(乙)積極傳播基督教\n(丙)用羅馬字母拼寫原住民語言\n(丁)招募漢人開墾土地\n(戊)促進臺灣北部的開發",
            expectedSourceAnswer: "(1)(乙)(丙)(丁);(2)(甲)(戊)",
            parts: Object.freeze([
                Object.freeze({ stableKey: "1", prompt: "荷蘭人", answerMode: "text", acceptedValue: "乙、丙、丁" }),
                Object.freeze({ stableKey: "2", prompt: "西班牙人", answerMode: "text", acceptedValue: "甲、戊" }),
            ]),
        }),
    ]),
    "a714290ca525cce3b6d84e0e439b1e79ed8dbdf1b227ff622ccf43b880f4639b": Object.freeze([
        Object.freeze({
            questionNumber: "05012258",
            prompt: "附表為淡水河、蘭陽溪、大甲溪、濁水溪、曾文溪、高屏溪六條河川的水文資料。請以表中河川代號回答下列問題:",
            expectedSourceAnswer: "(1)甲;(2)戊;(3)(B)",
            parts: Object.freeze([
                Object.freeze({ stableKey: "1", prompt: "日月潭水庫位於表中哪一條河川上游?", answerMode: "text", acceptedValue: "甲" }),
                Object.freeze({ stableKey: "2", prompt: "曾文水庫是全臺容量最大水庫,位於表中哪一條河川上游?", answerMode: "text", acceptedValue: "戊" }),
                Object.freeze({
                    stableKey: "3", prompt: "丙、丁兩條河川年逕流量的豐、枯水期差異程度較其他四條河川小,其可能原因為何?", answerKey: "B",
                    options: Object.freeze([
                        Object.freeze({ key: "A", text: "流經的區域較少" }),
                        Object.freeze({ key: "B", text: "有地形雨補注水量" }),
                        Object.freeze({ key: "C", text: "沿岸人民取水量少" }),
                        Object.freeze({ key: "D", text: "流域地形落差較小" }),
                    ]),
                }),
            ]),
        }),
    ]),
    "0501e6a192b8abef9abd4264669afe14b137a8064be4e2a0fccc3f870ac8b7f2": Object.freeze([
        Object.freeze({
            questionNumber: "05015709",
            prompt: "臺灣每年平均可偵測到 3 萬多起地震,有感地震達 700~2,000 多次。其中,接近一半的地震發生在東部區域,僅管臺灣西部區域發生地震的比例較東部低,但西部地震深度普遍較淺又是人口稠密區,若發生強震的災害損失也相對更為嚴重。請依據地圖回答下列問題。",
            parts: Object.freeze([
                Object.freeze({
                    stableKey: "1",
                    prompt: "地震所屬的營力與下列何者相同?",
                    options: Object.freeze([
                        Object.freeze({ key: "A", text: "土石流" }),
                        Object.freeze({ key: "B", text: "沖積扇" }),
                        Object.freeze({ key: "C", text: "火山爆發" }),
                        Object.freeze({ key: "D", text: "河川堆積" }),
                    ]),
                    answerKey: "C",
                }),
                Object.freeze({
                    stableKey: "2",
                    prompt: "臺灣東部發生地震的比例較西部高的原因可能為何?",
                    options: Object.freeze([
                        Object.freeze({ key: "A", text: "地處板塊交界帶" }),
                        Object.freeze({ key: "B", text: "多為火山分布區" }),
                        Object.freeze({ key: "C", text: "地勢普遍較高聳" }),
                        Object.freeze({ key: "D", text: "山地主要分布區" }),
                    ]),
                    answerKey: "A",
                }),
                Object.freeze({
                    stableKey: "3",
                    prompt: "在地震頻繁的東部地區,何種地形最需預防因地震造成土石崩落的災害?",
                    options: Object.freeze([
                        Object.freeze({ key: "A", text: "盆地" }),
                        Object.freeze({ key: "B", text: "山地" }),
                        Object.freeze({ key: "C", text: "高原" }),
                        Object.freeze({ key: "D", text: "平原" }),
                    ]),
                    answerKey: "B",
                }),
            ]),
        }),
    ]),
});
const APPROVED_SOCIAL_VISUAL_MATCHING_REPAIRS_BY_SOURCE_SHA256 = Object.freeze({
    "5787d12939bd17799b7c6b62a5dd94b5cee2fb0c0ad43aaf699792bd711342f2": Object.freeze([
        Object.freeze({
            questionNumber: "05010290",
            imageChecksum: "ad6a9b3a2b982bb96992a16b9620ab5c0ab661dbcab7cb63cd98c3d35526659c",
            labels: Object.freeze(["A", "B", "C", "D", "E", "F"]),
        }),
    ]),
});
const APPROVED_SOCIAL_QUESTION_TABLE_MAPPINGS_BY_SOURCE_SHA256 = Object.freeze({
    "5787d12939bd17799b7c6b62a5dd94b5cee2fb0c0ad43aaf699792bd711342f2": Object.freeze([
        Object.freeze({
            questionNumber: "05010175",
            embeddedObjectName: "oleObject1.bin",
            embeddedObjectSha256: "f6d1de7ea75af1b40ab9fdf7a36ccb7b44be7a5e7da027d1cf99f26c0938d612",
            placement: "prompt",
            rows: Object.freeze([
                Object.freeze(["地區", "甲", "乙", "丙", "丁"]),
                Object.freeze(["經緯度", "（120°E，30°N）", "（120°W，30°N）", "（125°E，30°S）", "（140°W，30°S）"]),
            ]),
        }),
    ]),
    "f8d7460091d3a117b175f3f349abe4c46eef7d43fd78645784e77758094b72b7": Object.freeze([
        Object.freeze({
            questionNumber: "05011470",
            embeddedObjectName: "oleObject1.bin",
            embeddedObjectSha256: "3a42014bcd17f7a086c4a624bd13d3feb02715cceed0cf3080fe3660aa5f1779",
            placement: "prompt",
            rows: Object.freeze([
                Object.freeze(["(甲)氣溫", "(乙)風速", "(丙)降水量", "(丁)氣壓"]),
                Object.freeze(["25.8 ℃", "1.1 hPa", "0.8 mm", "1014.6 m∕s"]),
            ]),
        }),
    ]),
    "58cd99a10171f01b55e2f44389c9519ca95695df9ac44240dc7afe87b23eee6a": Object.freeze([
        Object.freeze({
            questionNumber: "05013597",
            embeddedObjectName: "oleObject3.docx",
            embeddedObjectSha256: "a318db985b6f5e3841086c74406db719ad151536e1163971a571168611613eda",
            placement: "prompt",
            rows: Object.freeze([
                Object.freeze(["城市", "臺南", "大稻埕", "艋舺"]),
                Object.freeze(["人口", "47,583 人", "31,533 人", "23,767 人"]),
            ]),
        }),
    ]),
});

const approvedSocialQuestionTableMappings = (sourceSha256) => Object.freeze([
    ...(APPROVED_SOCIAL_QUESTION_TABLE_MAPPINGS_BY_SOURCE_SHA256[sourceSha256]
        ?? EMPTY_APPROVED_QUESTION_TABLE_MAPPINGS),
    ...(APPROVED_NATIVE_TABLE_MAPPINGS_BY_SOURCE_SHA256[sourceSha256]
        ?? EMPTY_APPROVED_QUESTION_TABLE_MAPPINGS),
]);

function parseArguments(argv) {
    const dryRun = argv.includes("--dry-run");
    const sourceIndex = argv.indexOf("--source-root");
    const sourceRoot = sourceIndex >= 0 ? path.resolve(argv[sourceIndex + 1] ?? "") : DEFAULT_SOURCE_ROOT;
    const startIndexArgument = argv.indexOf("--start-index");
    const startIndex = startIndexArgument >= 0 ? Number(argv[startIndexArgument + 1]) : 0;
    const limitArgument = argv.indexOf("--limit");
    const limit = limitArgument >= 0 ? Number(argv[limitArgument + 1]) : null;
    const auditReportArgument = argv.indexOf("--audit-report");
    const auditReport = auditReportArgument >= 0 ? path.resolve(argv[auditReportArgument + 1] ?? "") : null;
    const auditReasonArgument = argv.indexOf("--audit-pending-reason");
    const auditPendingReason = auditReasonArgument >= 0 ? String(argv[auditReasonArgument + 1] ?? "").trim() : null;
    const auditExcludeConfirmedImageOptions = argv.includes("--audit-exclude-confirmed-image-options");
    const details = argv.includes("--details");
    const sourcePathArgument = argv.indexOf("--source-path");
    const sourcePath = sourcePathArgument >= 0 ? path.resolve(argv[sourcePathArgument + 1] ?? "") : null;
    const questionNumberArgument = argv.indexOf("--question-number");
    const questionNumber = questionNumberArgument >= 0 ? String(argv[questionNumberArgument + 1] ?? "").trim() : null;
    const correctionVersionArgument = argv.indexOf("--correction-version");
    const correctionVersion = correctionVersionArgument >= 0 ? String(argv[correctionVersionArgument + 1] ?? "").trim() : null;
    if (!Number.isInteger(startIndex) || startIndex < 0) throw new Error("--start-index 必須是非負整數。");
    if (limit !== null && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit 必須是正整數。");
    if (auditReasonArgument >= 0 && !auditPendingReason) throw new Error("--audit-pending-reason 不可為空。");
    if (sourcePathArgument >= 0 && !sourcePath) throw new Error("--source-path 不可為空。");
    if ((questionNumber || correctionVersion) && (!sourcePath || !questionNumber || !correctionVersion)) {
        throw new Error("逐題修訂必須同時提供 --source-path、--question-number 與 --correction-version。");
    }
    if (questionNumber && !/^\d{8}$/u.test(questionNumber)) throw new Error("--question-number 必須是 8 位題號。");
    return { dryRun, details, sourceRoot, sourcePath, questionNumber, correctionVersion, startIndex, limit, auditReport, auditPendingReason, auditExcludeConfirmedImageOptions, assetRoot: path.join(REPOSITORY_ROOT, "local-data", "assets") };
}

function classify(rule, fileName) {
    const match = fileName.match(/^(\d{2})_(01|02|03)_\d+-\d+_(導言|\d+-\d+)_\s*(.+)\.doc$/u);
    if (!match) throw new Error(`無法解析社會科檔名：${fileName}`);
    const sequence = Number(match[1]);
    const subjectKey = sequence <= rule.geographyEnd ? "geography" : sequence <= rule.historyEnd ? "history" : "civics";
    const subject = SUBJECTS[subjectKey];
    if (match[2] !== subject.marker) throw new Error(`檔名科目與指定範圍不一致：${rule.folder}/${fileName}`);
    const sectionCode = match[3] === "導言" ? "intro" : match[3];
    const unitName = `${match[3]} ${match[4].trim()}`;
    const numericPosition = sectionCode === "intro" ? 0 : Number(sectionCode.replace("-", ""));
    return { subject, sectionCode, unitName, unitPosition: numericPosition };
}

function buildTarget(rule, fileName) {
    const { subject, sectionCode, unitName, unitPosition } = classify(rule, fileName);
    return Object.freeze({
        key: `jh1-${subject.short}-hanlin-v1-${sectionCode}-${rule.suffix}`,
        gradeCode: "junior-high-1", gradeName: "國一",
        semesterCode: "semester-1", semesterName: "上學期",
        subjectCode: subject.code, subjectName: subject.name, subjectAlias: subject.alias,
        publisherCode: "hanlin", publisherName: "翰林", bookName: "翰林版",
        volumeCode: "volume-1", volumeName: "第一冊",
        unitCode: sectionCode === "intro" ? "intro" : `chapter-${sectionCode}`,
        unitName, unitPosition,
        sourceCategoryCode: rule.code, sourceCategoryName: rule.name,
        originalSourceName: rule.folder.replace(/^\d+_/u, ""),
    });
}

async function authorizedImport(rule, sourcePath) {
    const fileName = path.basename(sourcePath);
    const originalSha256 = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
    const target = buildTarget(rule, fileName);
    return Object.freeze({
        fileName, originalSha256, target, ids: catalogIdsForTarget(target),
        parserVersion: "hanlin-social-v9", questionTypes: HANLIN_SOCIAL_TYPES,
        allowDerivedHtmlImages: true,
        allowVerifiedImageChoiceInference: true,
        allowTextualTableVisualReferences: true,
        approvedDecorativeImageSha256s: Object.freeze([]),
        approvedQuestionImageMappings: APPROVED_SOCIAL_QUESTION_IMAGE_MAPPINGS_BY_SOURCE_SHA256[originalSha256]
            ?? EMPTY_APPROVED_QUESTION_IMAGE_MAPPINGS,
        approvedQuestionTableMappings: approvedSocialQuestionTableMappings(originalSha256),
        approvedVisualMatchingRepairs: APPROVED_SOCIAL_VISUAL_MATCHING_REPAIRS_BY_SOURCE_SHA256[originalSha256]
            ?? EMPTY_APPROVED_VISUAL_MATCHING_REPAIRS,
        approvedChoiceRepairs: APPROVED_SOCIAL_CHOICE_REPAIRS_BY_SOURCE_SHA256[originalSha256]
            ?? EMPTY_APPROVED_CHOICE_REPAIRS,
        approvedMultiPartRepairs: APPROVED_SOCIAL_MULTI_PART_REPAIRS_BY_SOURCE_SHA256[originalSha256]
            ?? EMPTY_APPROVED_MULTI_PART_REPAIRS,
        allowPartialPartImageQuestionNumbers: originalSha256 === "0501e6a192b8abef9abd4264669afe14b137a8064be4e2a0fccc3f870ac8b7f2"
            ? Object.freeze(["05015709"])
            : Object.freeze([]),
        approvedNoVisualReferenceQuestionNumbers: APPROVED_SOCIAL_NO_VISUAL_REFERENCE_QUESTION_NUMBERS_BY_SOURCE_SHA256[originalSha256]
            ?? EMPTY_APPROVED_NO_VISUAL_REFERENCE_QUESTION_NUMBERS,
    });
}

function addTotals(totals, summary, target) {
    totals.files += 1;
    totals.parsed += summary.parsed;
    totals.published += summary.published;
    totals.pendingReview += summary.pendingReview;
    totals.failed += summary.failed;
    totals.questionAssets += summary.assetCounts.questionContent;
    totals.bySubject[target.subjectName] ??= { files: 0, parsed: 0, published: 0, pendingReview: 0 };
    const subject = totals.bySubject[target.subjectName];
    subject.files += 1;
    subject.parsed += summary.parsed;
    subject.published += summary.published;
    subject.pendingReview += summary.pendingReview;
}

async function importOne(sourcePath, authorized, options) {
    let prepared;
    let stagingRoot;
    let createdStorageKeys = [];
    try {
        prepared = await prepareHanlinChineseImport(sourcePath, { allowDirectory: false, authorizedLesson: authorized });
        if (options.questionNumber) {
            const group = prepared.plan.questionGroups.find((candidate) => candidate.number === options.questionNumber);
            if (!group || !group.publishable || group.occurrences.length !== 1) {
                throw new Error(`題號 ${options.questionNumber} 無法形成唯一且可發布的來源修訂。`);
            }
            const { document, record } = group.canonical;
            record.sourceOrder = 0;
            // This path is an explicit, source-SHA-scoped single-question repair.
            // It may safely restore a question that an earlier parser version
            // archived after placing the same source record back into review.
            record.approvedForReactivation = true;
            document.records = [record];
            group.occurrences = [{ document, record }];
            group.canonical = group.occurrences[0];
            prepared.plan.documents = [document];
            prepared.plan.questionGroups = [group];
            prepared.plan.duplicatesSkipped = 0;
            prepared.plan.correction = {
                questionNumber: options.questionNumber,
                version: options.correctionVersion,
            };
            const correctionKey = createHash("sha256")
                .update(`${prepared.plan.sourceSetHash}:${options.questionNumber}:${options.correctionVersion}`, "utf8")
                .digest("hex")
                .slice(0, 24);
            prepared.plan.idempotencyKey = `${prepared.plan.parserVersion}:${prepared.plan.target.key}:fix:${correctionKey}`;
            prepared.plan.batchId = deterministicUuid(`import-batch:${prepared.plan.idempotencyKey}`);
            group.revisionId = deterministicUuid(
                `revision:${prepared.plan.batchId}:${group.identityKey}:${group.contentFingerprint}`,
            );
            prepared.summary = {
                ...prepared.summary,
                parsed: 1,
                published: 1,
                pendingReview: 0,
                failed: 0,
                questionAssets: record.images.length,
            };
        }
        if (options.details) {
            for (const document of prepared.plan.documents) {
                for (const record of document.records.filter((entry) => entry.pendingReasons.length)) {
                    process.stderr.write(`${JSON.stringify({
                        fileName: document.fileName,
                        questionNumber: record.normalizedQuestionNumber,
                        pendingReasons: record.pendingReasons,
                        images: record.images.map((image) => ({
                            checksum: image.checksum,
                            placement: image.placement,
                            detectedOptionKey: image.detectedOptionKey ?? null,
                            sourceName: image.sourceName ?? null,
                            width: image.width ?? null,
                            height: image.height ?? null,
                        })),
                    })}\n`);
                }
            }
        }
        const invalidOptionImages = prepared.plan.documents.flatMap((document) => document.records.flatMap((record) => {
            const optionKeys = new Set(record.structured.parts.flatMap((part) => part.options.map((option) => option.key)));
            return record.images
                .filter((image) => image.optionKey && !optionKeys.has(image.optionKey))
                .map((image) => `${record.normalizedQuestionNumber}:${image.optionKey}`);
        }));
        if (invalidOptionImages.length) {
            throw new Error(`${authorized.fileName} 的圖片選項結構不完整：${invalidOptionImages.join(", ")}`);
        }
        validateHanlinPostgresPlan(prepared.plan);
        if (prepared.summary.failed) throw new Error(`${authorized.fileName} 有 ${prepared.summary.failed} 筆解析失敗。`);
        if (options.dryRun) return prepared.summary;
        stagingRoot = path.join(options.assetRoot, ".staging", prepared.plan.batchId);
        await cleanupHanlinAssetStaging(stagingRoot);
        const stagedStorageKeys = await materializeHanlinAssets(prepared.plan, stagingRoot);
        return await writeHanlinPostgresImport({
            plan: prepared.plan, summary: prepared.summary, assetRoot: options.assetRoot, pgEnv: process.env,
            beforeCommit: async ({ storageKeys }) => {
                ({ createdStorageKeys } = await promoteHanlinAssets(prepared.plan, stagingRoot, options.assetRoot,
                    storageKeys.length ? storageKeys : stagedStorageKeys));
                return { rollback: () => rollbackHanlinAssets(options.assetRoot, createdStorageKeys) };
            },
        });
    }
    finally {
        if (stagingRoot) await cleanupHanlinAssetStaging(stagingRoot).catch(() => undefined);
        await prepared?.cleanup();
    }
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const totals = { files: 0, parsed: 0, published: 0, pendingReview: 0, failed: 0, questionAssets: 0, bySubject: {} };
    const jobs = [];
    for (const rule of SOURCE_RULES) {
        const directory = path.join(options.sourceRoot, rule.folder);
        const fileNames = (await readdir(directory)).filter((name) =>
            !name.startsWith("~$") && name.toLowerCase().endsWith(".doc"))
            .sort((a, b) => a.localeCompare(b, "zh-Hant"));
        for (const fileName of fileNames) {
            const sourcePath = path.join(directory, fileName);
            if (!options.sourcePath || path.resolve(sourcePath) === options.sourcePath) {
                jobs.push({ rule, fileName, sourcePath });
            }
        }
    }
    if (options.sourcePath && jobs.length !== 1) throw new Error(`--source-path 找不到唯一來源文件：${options.sourcePath}`);
    const runJob = async ({ rule, fileName, sourcePath }) => {
        const authorized = await authorizedImport(rule, sourcePath);
        const summary = await importOne(sourcePath, authorized, options);
        addTotals(totals, summary, authorized.target);
        process.stderr.write(`${options.dryRun ? "盤點" : "匯入"} ${rule.folder}/${fileName}: ${summary.published}/${summary.parsed}, 待檢 ${summary.pendingReview}, 圖片 ${summary.assetCounts.questionContent}\n`);
    };
    let selectedJobs = jobs.slice(options.startIndex, options.limit === null ? undefined : options.startIndex + options.limit);
    if (options.auditReport) {
        const report = JSON.parse(await readFile(options.auditReport, "utf8"));
        const audits = Array.isArray(report) ? report : report.audits;
        if (!Array.isArray(audits)) throw new Error("--audit-report 必須包含 audits 陣列。");
        const approvedSourcePaths = new Set(audits
            .filter((entry) => entry.subject === "社會" && (options.auditPendingReason
                ? entry.pendingReasons?.includes(options.auditPendingReason)
                : entry.wordStatus === "word-confirms-image-options"))
            .filter((entry) => !options.auditExcludeConfirmedImageOptions
                || entry.wordStatus !== "word-confirms-image-options")
            .map((entry) => path.resolve(entry.sourcePath)));
        selectedJobs = selectedJobs.filter((job) => approvedSourcePaths.has(path.resolve(job.sourcePath)));
        if (!selectedJobs.length) throw new Error("--audit-report 沒有可處理的社會科圖片選項來源。");
    }
    const workerCount = options.dryRun ? 8 : 1;
    if (workerCount > 1) {
        const workers = Array.from({ length: workerCount }, async (_, workerIndex) => {
            for (let index = workerIndex; index < selectedJobs.length; index += workerCount) await runJob(selectedJobs[index]);
        });
        await Promise.all(workers);
    }
    else {
        for (const job of selectedJobs) await runJob(job);
    }
    process.stdout.write(`${JSON.stringify({ ...totals, dryRun: options.dryRun })}\n`);
}

await main();
