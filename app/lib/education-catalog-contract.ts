export const EDUCATION_STAGE_LABELS = {
    elementary: "國小",
    junior_high: "國中",
    senior_high: "高中／高職",
} as const;

export type EducationStage = keyof typeof EDUCATION_STAGE_LABELS;

export interface EducationGrade {
    code: string;
    name: string;
    stage: EducationStage;
}

export interface EducationSemester {
    code: string;
    name: string;
}

export interface EducationCatalogStage {
    code: EducationStage;
    name: string;
    grades: EducationGrade[];
}

export interface EducationCatalog {
    stages: EducationCatalogStage[];
    semesters: EducationSemester[];
}

/**
 * 依年級代碼尋找正式教育階段。
 *
 * @param catalog 正式教育目錄。
 * @param gradeCode 年級穩定代碼。
 * @returns 找到的教育階段，找不到時回傳空值。
 */
export function findEducationStageByGradeCode(
    catalog: EducationCatalog | null | undefined,
    gradeCode: string | null | undefined,
): EducationCatalogStage | undefined {
    if (!catalog || !gradeCode) return undefined;
    return catalog.stages.find((stage) => stage.grades.some((grade) => grade.code === gradeCode));
}

/**
 * 依教育階段代碼尋找正式教育階段。
 *
 * @param catalog 正式教育目錄。
 * @param stageCode 教育階段穩定代碼。
 * @returns 找到的教育階段，找不到時回傳空值。
 */
export function findEducationStageByCode(
    catalog: EducationCatalog | null | undefined,
    stageCode: string | null | undefined,
): EducationCatalogStage | undefined {
    if (!catalog || !stageCode) return undefined;
    return catalog.stages.find((stage) => stage.code === stageCode);
}
