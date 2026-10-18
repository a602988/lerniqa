export function parseQuestionTable(text: string): string[][] {
    const lines = text.replace(/\r\n?/gu, "\n").split("\n");
    while (lines.length > 0 && lines[0].trim() === "") lines.shift();
    while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();
    return lines.map((line) => line.split("\t").map((cell) => cell.trim()));
}
