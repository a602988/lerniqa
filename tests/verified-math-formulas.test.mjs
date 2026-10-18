import assert from "node:assert/strict";
import test from "node:test";

import { formulaSearchProjection, verifiedMathFormula } from "../scripts/lib/verified-math-formulas.mjs";

const SOURCE = "372f14612c6c4d0a12a2c55e04dea006da2f558f4e80eb5c082e7da2b9c91989";
const FRACTION = "42a332f55d15758d7a3ddade6f06543a55c6aaa121964a5c7e0a8eeab86f786d";
const DIVISIBILITY_SOURCE = "05af8ac3292610edfc99a9fc9216b80f4f5ed6bcf8de6564d8bd75ba9db0dcab";
const DIVISIBILITY_FORMULA = "036444dba226e502061b12624abcc6fa970fbf44bfb2a10eb827175140aa4b75";
const BATTING_AVERAGE_FORMULAS = new Map(Object.entries({
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

test("verified formula mapping requires exact source, question and checksum", () => {
    assert.equal(verifiedMathFormula(SOURCE, "1501004796", FRACTION), "\\frac{6}{8}");
    assert.equal(verifiedMathFormula(SOURCE, "other", FRACTION), null);
    assert.equal(verifiedMathFormula("other", "1501004796", FRACTION), null);
    assert.equal(verifiedMathFormula(SOURCE, "1501004796", "0".repeat(64)), null);
});

test("writer search projection includes a readable fraction alias", () => {
    assert.match(formulaSearchProjection("\\frac{6}{8}"), /6\/8/u);
    assert.match(
        formulaSearchProjection("\\frac{\\text{安打數}}{\\text{打擊次數}}"),
        /安打數\/打擊次數/u,
    );
});

test("verified batting-average formulas require the exact source and question", () => {
    for (const [checksum, expression] of BATTING_AVERAGE_FORMULAS) {
        assert.equal(verifiedMathFormula(SOURCE, "1501004805", checksum), expression);
        assert.equal(verifiedMathFormula(SOURCE, "1501004796", checksum), null);
        assert.equal(verifiedMathFormula("other", "1501004805", checksum), null);
    }
});

test("verified divisibility formula requires the exact source, question and checksum", () => {
    const expression = "\\frac{2 \\times A + 1}{5}";
    assert.equal(verifiedMathFormula(DIVISIBILITY_SOURCE, "1501000017", DIVISIBILITY_FORMULA), expression);
    assert.equal(verifiedMathFormula(DIVISIBILITY_SOURCE, "other", DIVISIBILITY_FORMULA), null);
    assert.equal(verifiedMathFormula("other", "1501000017", DIVISIBILITY_FORMULA), null);
    assert.equal(verifiedMathFormula(DIVISIBILITY_SOURCE, "1501000017", "0".repeat(64)), null);
    assert.match(formulaSearchProjection(expression), /2\\timesA\+1\/5/u);
});
