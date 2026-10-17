import { queryLocalPostgres } from "./local-postgres";
import {
    EDUCATION_STAGE_LABELS,
    type EducationCatalog,
    type EducationGrade,
    type EducationSemester,
    type EducationStage,
} from "./education-catalog-contract";

interface GradeRow {
    code: string;
    name: string;
    stage: EducationStage;
}

interface SemesterRow {
    code: string;
    name: string;
}

/**
 * 讀取可供學生資料使用的正式教育目錄。
 *
 * @returns 依資料庫排序的教育階段、年級與學期。
 */
export async function readEducationCatalog(): Promise<EducationCatalog> {
    const [gradeResult, semesterResult] = await Promise.all([
        queryLocalPostgres<GradeRow>(`
            SELECT code, name, stage
            FROM grades
            WHERE status = 'active'
                AND stage IN ('elementary', 'junior_high', 'senior_high')
            ORDER BY sort_order, code
        `),
        queryLocalPostgres<SemesterRow>(`
            SELECT code, name
            FROM semesters
            WHERE status = 'active'
            ORDER BY sort_order, code
        `),
    ]);
    const grades = gradeResult.rows as EducationGrade[];
    const stageOrder = Object.keys(EDUCATION_STAGE_LABELS) as EducationStage[];
    return {
        stages: stageOrder.flatMap((code) => {
            const stageGrades = grades.filter((grade) => grade.stage === code);
            return stageGrades.length ? [{
                code,
                name: EDUCATION_STAGE_LABELS[code],
                grades: stageGrades,
            }] : [];
        }),
        semesters: semesterResult.rows as EducationSemester[],
    };
}
