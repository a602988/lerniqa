import { Fragment } from "react";
import { normalizeQuestionDisplayText, tokenizeInlineQuestionText } from "../lib/question-presentation";

const INLINE_TEXT_SEQUENCE = /([\u3105-\u312f\u31a0-\u31bf]+[ˊˇˋ˙]?|□+)/gu;
const BOPOMOFO_TONES = new Set(["ˊ", "ˇ", "ˋ", "˙"]);

function BopomofoToneMark({ tone }: { tone: string }) {
    if (tone === "˙") {
        return <svg aria-hidden="true" className="bopomofo-tone-mark bopomofo-neutral-tone" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="2.6" />
        </svg>;
    }

    const path = tone === "ˊ"
        ? "M2.5 11.5 L9.5 4.5"
        : tone === "ˇ"
            ? "M2 4.5 L6 10 L10 4.5"
            : "M2.5 4.5 L9.5 11.5";

    return <svg aria-hidden="true" className="bopomofo-tone-mark bopomofo-tone" viewBox="0 0 12 16">
        <path d={path} />
    </svg>;
}

function BopomofoSyllable({ value }: { value: string }) {
    const characters = [...value];
    const finalCharacter = characters.at(-1) ?? "";
    const tone = BOPOMOFO_TONES.has(finalCharacter) ? finalCharacter : "";
    const symbols = tone ? characters.slice(0, -1) : characters;
    const neutralTone = tone === "˙";

    return <span className="bopomofo-syllable">
        <span className="sr-only">{value}</span>
        {neutralTone && <BopomofoToneMark tone={tone} />}
        <span aria-hidden="true" className="bopomofo-symbols">
            {symbols.map((symbol, index) => <span key={`${symbol}-${index}`}>{symbol}</span>)}
        </span>
        {tone && !neutralTone && <BopomofoToneMark tone={tone} />}
    </span>;
}

function InlineFraction({ numerator, denominator }: { numerator: string; denominator: string }) {
    return <span className="question-inline-fraction" role="math" aria-label={`${denominator} 分之 ${numerator}`}>
        <span aria-hidden="true" className="question-inline-fraction-numerator">{normalizeQuestionDisplayText(numerator)}</span>
        <span aria-hidden="true" className="question-inline-fraction-denominator">{normalizeQuestionDisplayText(denominator)}</span>
    </span>;
}

function InlinePlainText({ text }: { text: string }) {
    return <>{text.split(INLINE_TEXT_SEQUENCE).map((segment, index) => (
        /^[\u3105-\u312f\u31a0-\u31bf]+[ˊˇˋ˙]?$/u.test(segment)
            ? <BopomofoSyllable key={`${segment}-${index}`} value={segment} />
            : /^□+$/u.test(segment)
                ? <span className="question-placeholder-boxes" key={`${segment}-${index}`}>
                    <span className="sr-only">{[...segment].map(() => "空格").join("、")}</span>
                    <span aria-hidden="true" className="question-placeholder-box-sequence">
                        {[...segment].map((_, placeholderIndex) => <span className="question-placeholder-box" key={placeholderIndex} />)}
                    </span>
                </span>
                : <Fragment key={`${segment}-${index}`}>{normalizeQuestionDisplayText(segment)}</Fragment>
    ))}</>;
}

function InlineScript({ placement, value }: { placement: "superscript" | "subscript"; value: string }) {
    const content = <BopomofoText text={value} />;
    return placement === "superscript"
        ? <sup className="question-inline-script question-inline-superscript">{content}</sup>
        : <sub className="question-inline-script question-inline-subscript">{content}</sub>;
}

/** 共用題目文字呈現：注音、缺字方框、分數、上標與下標。 */
export function BopomofoText({ text }: { text: string }) {
    return <>{tokenizeInlineQuestionText(text).map((token, index) => {
        if (token.kind === "fraction") {
            return <InlineFraction key={`fraction-${index}`} numerator={token.numerator} denominator={token.denominator} />;
        }
        if (token.kind === "script") {
            return <InlineScript key={`script-${index}`} placement={token.placement} value={token.value} />;
        }
        return <InlinePlainText key={`text-${index}`} text={token.value} />;
    })}</>;
}
