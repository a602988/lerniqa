import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("題目中的方框與分數會透過共用文字元件維持可讀尺寸與同列對齊", async () => {
    const [component, styles] = await Promise.all([
        readFile(new URL("../app/components/bopomofo-text.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    ]);

    assert.match(component, /\|□\+/u);
    assert.match(component, /className="question-placeholder-boxes"/u);
    assert.match(component, /className="question-placeholder-box"/u);
    assert.match(styles, /\.question-placeholder-box[\s\S]*width: 1em[\s\S]*height: 1em[\s\S]*border: 0\.09em solid currentColor/u);
    assert.match(component, /className="question-inline-fraction"/u);
    assert.match(component, /role="math"/u);
    assert.match(styles, /\.question-inline-fraction[\s\S]*display: inline-grid[\s\S]*font-size: 1em[\s\S]*vertical-align: middle/u);
});

test("相鄰注音音節維持橫排，單一音節保留原有直式元件", async () => {
    const [component, styles] = await Promise.all([
        readFile(new URL("../app/components/bopomofo-text.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    ]);

    assert.match(component, /function BopomofoWordGroup/u);
    assert.match(component, /className="bopomofo-word-group"/u);
    assert.match(component, /<span className="bopomofo-word-group">\{value\}<\/span>/u);
    assert.match(styles, /\.bopomofo-word-group[\s\S]*display: inline-block[\s\S]*font-size: 1em[\s\S]*line-height: inherit[\s\S]*white-space: nowrap/u);
    assert.doesNotMatch(styles, /\.bopomofo-word-group \.bopomofo-syllable/u);
});
