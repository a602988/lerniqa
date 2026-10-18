import { parseQuestionTable } from "../lib/question-table";
import { BopomofoText } from "./bopomofo-text";

export function QuestionTable({ text }: { text: string | null }) {
    const rows = text ? parseQuestionTable(text) : [];
    if (rows.length === 0) return <p className="question-data-table-missing">（表格內容缺漏）</p>;

    return (
        <div className="question-data-table-wrap">
            <table className="question-data-table">
                <tbody>
                    {rows.map((row, rowIndex) => (
                        <tr key={`${rowIndex}-${row.join("\t")}`}>
                            {row.map((cell, columnIndex) => (
                                <td key={`${columnIndex}-${cell}`}>
                                    {cell ? <BopomofoText text={cell} /> : "\u00a0"}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
