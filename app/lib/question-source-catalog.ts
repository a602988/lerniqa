import type { PoolClient, QueryResultRow } from "pg";

type QueryClient = Pick<PoolClient, "query">;

export interface QuestionSourceCatalogUnit {
    bookVersionId: string | null;
    bookVersionName: string | null;
    gradeId: string | null;
    gradeCode: string | null;
    gradeName: string | null;
    semesterId: string | null;
    semesterName: string | null;
    subjectAliases: string[];
    subjectId: string;
    subjectName: string;
    unitId: string;
    unitName: string;
    unitType: string;
}

export interface QuestionSourceCatalogSuggestion {
    bookVersionId: string | null;
    bookVersionName: string | null;
    gradeId: string | null;
    gradeName: string | null;
    semesterId: string | null;
    semesterName: string | null;
    subjectId: string;
    subjectName: string;
    unitId: string;
    unitName: string;
}

interface CatalogUnitRow extends QueryResultRow {
    book_version_id: string | null;
    book_version_name: string | null;
    grade_id: string | null;
    grade_code: string | null;
    grade_name: string | null;
    semester_id: string | null;
    semester_name: string | null;
    subject_aliases: string[];
    subject_id: string;
    subject_name: string;
    unit_id: string;
    unit_name: string;
    unit_type: string;
}

/**
 * 將 OCR 與目錄文字轉成可安全比對的形式，不保留版面空白與標點差異。
 *
 * @param value OCR 或正式目錄文字。
 * @returns 正規化後的比對文字。
 */
function normalizeCatalogText(value: string): string {
    return value.normalize("NFKC").toLocaleLowerCase("zh-Hant-TW").replace(/[\s\p{P}\p{S}]/gu, "");
}

/**
 * 從正式年級代碼產生台灣教材常見的年級寫法。
 *
 * @param unit 正式目錄單元。
 * @returns 可在 OCR 文字中查證的年級名稱。
 */
function gradeEvidence(unit: QuestionSourceCatalogUnit): string[] {
    if (!unit.gradeCode || !unit.gradeName) return [];
    const match = /^(elementary|junior-high|senior-high)-(\d)$/u.exec(unit.gradeCode);
    if (!match) return [unit.gradeName];
    const level = Number(match[2]);
    const numerals = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
    const chinese = numerals[level];
    const absolute = match[1] === "elementary" ? level : match[1] === "junior-high" ? level + 6 : level + 9;
    const stage = match[1] === "elementary" ? "國小" : match[1] === "junior-high" ? "國中" : "高中";
    return [unit.gradeName, `${stage}${chinese}年級`, `${chinese}年級`, `${absolute}年級`, `${numerals[absolute]}年級`];
}

/**
 * 計算 OCR 對目錄候選提供了多少項可直接查證的分類證據。
 *
 * @param text 已正規化的 OCR 文字。
 * @param unit 正式目錄候選。
 * @returns 科目、年級、學期與版本的命中數。
 */
function evidenceScore(text: string, unit: QuestionSourceCatalogUnit): number {
    const values = [
        unit.subjectName,
        ...unit.subjectAliases,
        ...gradeEvidence(unit),
        unit.semesterName,
        unit.bookVersionName,
    ];
    return values.filter((value): value is string => Boolean(value))
        .filter((value) => text.includes(normalizeCatalogText(value))).length;
}

/**
 * 將內部目錄單元縮減成前端可預填、仍須由使用者確認的欄位。
 *
 * @param unit 唯一匹配的正式目錄單元。
 * @returns 可預填的目錄候選。
 */
function toSuggestion(unit: QuestionSourceCatalogUnit): QuestionSourceCatalogSuggestion {
    return {
        bookVersionId: unit.bookVersionId,
        bookVersionName: unit.bookVersionName,
        gradeId: unit.gradeId,
        gradeName: unit.gradeName,
        semesterId: unit.semesterId,
        semesterName: unit.semesterName,
        subjectId: unit.subjectId,
        subjectName: unit.subjectName,
        unitId: unit.unitId,
        unitName: unit.unitName,
    };
}

/**
 * 只採用 OCR 文字中唯一且完整出現的既有單元名稱，避免用模糊相似度猜分類。
 *
 * @param ocrText 掃描頁面的合併 OCR 文字。
 * @param units 目前帳號可使用的正式單元目錄。
 * @returns 唯一可驗證的目錄候選；無法唯一判定時回傳 null。
 */
export function matchQuestionSourceCatalog(
    ocrText: string,
    units: QuestionSourceCatalogUnit[],
): QuestionSourceCatalogSuggestion | null {
    const text = normalizeCatalogText(ocrText);
    const matches = units.flatMap((unit) => {
        const unitName = normalizeCatalogText(unit.unitName);
        return unitName.length >= 2 && text.includes(unitName) ? [{ unit, length: unitName.length }] : [];
    });
    const longest = Math.max(0, ...matches.map((match) => match.length));
    const strongest = matches.filter((match) => match.length === longest).map((match) => match.unit);
    if (strongest.length === 1) return toSuggestion(strongest[0]!);
    const scored = strongest.map((unit) => ({ unit, score: evidenceScore(text, unit) }));
    const highestScore = Math.max(0, ...scored.map((candidate) => candidate.score));
    const withStrongestEvidence = scored.filter((candidate) => candidate.score === highestScore);
    return highestScore > 0 && withStrongestEvidence.length === 1
        ? toSuggestion(withStrongestEvidence[0]!.unit)
        : null;
}

/**
 * 讀取目前帳號可使用的正式單元，並以完整名稱對照 OCR 文字。
 *
 * @param client 已在授權流程內的 PostgreSQL client。
 * @param userId 目前登入帳號。
 * @param ocrText 掃描頁面的合併 OCR 文字。
 * @returns 可預填的唯一目錄候選。
 */
export async function findQuestionSourceCatalogSuggestion(
    client: QueryClient,
    userId: string,
    ocrText: string,
): Promise<QuestionSourceCatalogSuggestion | null> {
    const result = await client.query<CatalogUnitRow>(`
        SELECT unit.id AS unit_id,
               unit.name AS unit_name,
               unit.unit_type,
               subject.id AS subject_id,
               subject.name AS subject_name,
               grade.id AS grade_id,
               grade.code AS grade_code,
               grade.name AS grade_name,
               semester.id AS semester_id,
               semester.name AS semester_name,
               version.id AS book_version_id,
               version.name AS book_version_name,
               COALESCE(array_agg(alias.alias ORDER BY alias.alias) FILTER (WHERE alias.id IS NOT NULL), '{}') AS subject_aliases
        FROM curriculum_units AS unit
        JOIN subjects AS subject ON subject.id = unit.subject_id
        LEFT JOIN grades AS grade ON grade.id = unit.grade_id
        LEFT JOIN semesters AS semester ON semester.id = unit.semester_id
        LEFT JOIN book_versions AS version ON version.id = unit.book_version_id
        LEFT JOIN subject_aliases AS alias
          ON alias.subject_id = subject.id
         AND alias.status = 'active'
        WHERE unit.status = 'active'
          AND unit.unit_type <> 'volume'
          AND subject.status = 'active'
          AND (unit.origin = 'system' OR unit.owner_user_id = $1)
          AND (subject.origin = 'system' OR subject.owner_user_id = $1)
        GROUP BY unit.id, subject.id, grade.id, semester.id, version.id
        ORDER BY unit.name, unit.id
    `, [userId]);
    const units = result.rows.map((row): QuestionSourceCatalogUnit => ({
        bookVersionId: row.book_version_id,
        bookVersionName: row.book_version_name,
        gradeId: row.grade_id,
        gradeCode: row.grade_code,
        gradeName: row.grade_name,
        semesterId: row.semester_id,
        semesterName: row.semester_name,
        subjectAliases: row.subject_aliases,
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        unitId: row.unit_id,
        unitName: row.unit_name,
        unitType: row.unit_type,
    }));
    return matchQuestionSourceCatalog(ocrText, units);
}
