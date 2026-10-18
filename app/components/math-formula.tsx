import katex from "katex";
import { mathFormulaRenderExpression } from "../lib/math-formula";

/** Render trusted, canonical formula text without enabling KaTeX URL/HTML commands. */
export function MathFormula({ expression, className = "" }: { expression: string; className?: string }) {
    try {
        const html = katex.renderToString(mathFormulaRenderExpression(expression), {
            displayMode: false,
            output: "htmlAndMathml",
            strict: "warn",
            throwOnError: true,
            trust: false,
        });
        return <span className={`math-formula ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />;
    }
    catch {
        return <span className={`math-formula math-formula-fallback ${className}`.trim()}>{expression}</span>;
    }
}
