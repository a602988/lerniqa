const KANGXUAN_FRACTION_SOURCE = "372f14612c6c4d0a12a2c55e04dea006da2f558f4e80eb5c082e7da2b9c91989";
const KANGXUAN_DIVISIBILITY_SOURCE = "05af8ac3292610edfc99a9fc9216b80f4f5ed6bcf8de6564d8bd75ba9db0dcab";

const VERIFIED_FRACTION_FORMULAS = new Map(Object.entries({
    "42a332f55d15758d7a3ddade6f06543a55c6aaa121964a5c7e0a8eeab86f786d": "\\frac{6}{8}",
    "aa61ee98385cecf2c9f7d13a78d28f3067879f7e6d68e5a737a278e2f66138a6": "\\frac{3}{\\phantom{00}}",
    "e779f3b759afbcd301497c0e63624ae04d380005d08037590565e46994b30be2": "\\frac{\\phantom{00}}{16}",
    "ba937e612ccd7ef7dc7c4490ff28e7be0a36fc1fb12d868f370552de2df0a16d": "\\frac{1}{3}",
    "bec20a0f0fd76d853f2100507b6afa4577765c0753e5d93321805c92314c001d": "\\frac{\\phantom{00}}{6}",
    "99e128d2119dddcd0715b98c48afe526736fb1ca958ece4381c60cd2633b711a": "\\frac{10}{\\phantom{00}}",
    "4135002cb43f31241af093ed5d7aa6073982bfaf5149f6f69d41dc77305ddafa": "\\frac{\\phantom{00}}{18}",
    "4e25c3b43fa4f8367451d040e4b4aaef8f3a5c52d39ee96e3d08bc0b568ac82f": "\\frac{8}{16}",
    "9ac7a7c60d1a6eed084378a60a6ca5dadc8787b4a21bf118aaaa5ebc7da5a66f": "\\frac{\\phantom{00}}{8}",
    "ef4d15b746a71eb69ac24ffe9ad04bbf3646456a5231c93b68fa1e68eacc4de0": "\\frac{16}{\\phantom{00}}",
    "1bd94b90f73806974b5f8c4ecc658e5e435d4798c0f6b118687079b921413690": "\\frac{1}{2}",
    "ab032fca1af34bc801d45fbbe15ceaa675df5000bc64deddd5cfc2376ed7ab19": "\\frac{\\phantom{00}}{4}",
    "063512577bfde299165e97d013f8cc81b724674a6bd56b05d62ffdd9067a0c7f": "\\frac{3}{4}",
    "eb3341032c93f13e7088fcd602afd083625f984b33db1e4d66f39f5c69fd6fae": "\\frac{12}{16}",
    "19a1eeea7f869222fee544908d7e5521718f94b763d4f587daa77688ba9e1603": "\\frac{20}{6}",
    "935fcbf42f846319111c05dcf15ef06292404292676d643127868f9cde9096fd": "\\frac{10}{3}",
    "227882e3d093de5ab6b965b9b1ae8425ed669703c631be3a25e98aaff3cac77a": "\\frac{60}{18}",
    "0d653259f1d4b049104deda26929994174e3db393168776e904731a858697e3a": "\\frac{60}{18}",
    "05b6328de89227a9508ddf9a3439bf971b22c8f540fb29575ad44e5113f63057": "-\\frac{4}{8}",
    "51264d428e4de920dbb9174a59ab6e1321e34e94d431cc6f0cf2c3aae0a56588": "\\frac{16}{-32}",
    "d25f51df4f6023bec1088063b80123b3573c4d7dbd810584481776b75e3307f6": "\\frac{13}{2}",
    "aca4fbb91405e1581c30c13c96ce091ef1b81c368853f82dd610d5e1f3da8380": "-\\frac{26}{4}",
    "b462c09510b1e43290aefd9321ff3f8e1168870beb67dd04eca2d437b2d65af5": "-\\frac{39}{6}",
}));

const VERIFIED_BATTING_AVERAGE_FORMULAS = new Map(Object.entries({
    "84d354946b2b0ed4869f38ccf4c0c9a2a19d2c3696a088354a72be8de22c2070": "\\frac{\\text{安打數}}{\\text{打擊次數}}",
    "e4b6b6e274cc1a196babef945cbeb432225e47b4d29dd030632ce64b8109cc0d": "\\frac{11}{24}",
    "4661688f40eb747375965060a08a481e914698fc8012abd04d5046f7c8f4ae01": "\\frac{13}{24}",
    "392dc2b53d8abdca0478e0e4abe0217555498500c3b22f6cbc373ad4c48f6b1d": "\\frac{6}{19}",
    "cf54ed3c83fa3f49fe505e00f602110532f810411d5dfac0a0b3a44517c756cf": "\\frac{13}{19}",
    "b1ce47755e8eb49edfb092a7e917e50fe241e79333e4e1439d10e34c38d84c55": "\\frac{16}{29}",
    "60b937e3242a414ccb83a3a9efcc1c87b2d245609e8f1a9b13bcccc617810e82": "\\frac{13}{29}",
    "a1f227c8217b9514c9c6e3a9d3e5678491253925c0b9a90d359d8241e6806c39": "\\frac{20}{33}",
    "b12576c991493d3ca1e9788b1ee027cf8866d17270e41eec66ceb6d7cb7656b5": "\\frac{13}{33}",
}));

const VERIFIED_DIVISIBILITY_FORMULAS = new Map(Object.entries({
    "036444dba226e502061b12624abcc6fa970fbf44bfb2a10eb827175140aa4b75": "\\frac{2 \\times A + 1}{5}",
}));

const VERIFIED_FORMULAS_BY_QUESTION = new Map([
    [`${KANGXUAN_FRACTION_SOURCE}:1501004796`, VERIFIED_FRACTION_FORMULAS],
    [`${KANGXUAN_FRACTION_SOURCE}:1501004805`, VERIFIED_BATTING_AVERAGE_FORMULAS],
    [`${KANGXUAN_DIVISIBILITY_SOURCE}:1501000017`, VERIFIED_DIVISIBILITY_FORMULAS],
]);

/** Exact-source allowlist. Unknown image formulas deliberately remain images. */
export function verifiedMathFormula(sourceSha256, questionNumber, checksum) {
    const formulas = VERIFIED_FORMULAS_BY_QUESTION.get(`${sourceSha256}:${String(questionNumber)}`);
    return formulas?.get(String(checksum ?? "").toLowerCase()) ?? null;
}

export function formulaSearchProjection(expression) {
    const raw = String(expression ?? "").trim();
    if (!raw) return "";
    const readable = raw
        .replace(/\\text\{([^{}]+)\}/gu, "$1")
        .replace(/\\phantom\{[^{}]*\}/gu, "□")
        .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/gu, "$1/$2")
        .replace(/[{}\s]/gu, "");
    return [...new Set([raw, raw.replace(/\s/gu, ""), readable])].join(" ");
}
