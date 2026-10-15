import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import fixture from "@/data/fixtures/database.json";
import { ALL_UNITS, DEFAULT_ROLE_ACCESS, getUnitLabel, SUBJECTS } from "./demo-data";
import type { AccountRole, AssessmentRange, ExamSetting, ImportBook, MockDatabase, PracticePlan, Question, QuestionCollection, QuestionMetadataField, RoleAccess, ScheduledPractice, StoredState, Subject } from "./demo-data";
import { normalizeQuestionText } from "./question-text";

const RUNTIME_DIR = process.env.VERCEL
    ? path.join("/tmp", "lerniqa-runtime")
    : path.join(process.cwd(), "runtime-data");
const RUNTIME_FILE = path.join(RUNTIME_DIR, "database.json");
const RUNTIME_ASSETS = path.join(RUNTIME_DIR, "assets");
const FIXTURE_ASSETS = path.join(process.cwd(), "data", "fixtures", "assets");
const MAX_STATE_BYTES = 5 * 1024 * 1024;
let writeQueue: Promise<unknown> = Promise.resolve();

type LegacySubject = Subject | "自然" | "社會";
type LegacyRanges = Partial<Record<LegacySubject, AssessmentRange>>;

type LegacyPracticePlan = Omit<PracticePlan, "examSettings" | "activeExamId"> & {
    examSettings?: ExamSetting[];
    activeExamId?: string;
    assessment?: string;
    assessmentRanges?: LegacyRanges;
    assessmentScope?: string;
    examDate?: string;
    metadataFilters?: Record<string, string[]>;
};

type LegacyRoleAccess = Omit<RoleAccess, "learnerIdsByRole"> & {
    learnerIdsByRole?: Record<AccountRole, string[]>;
};

type LegacyStoredState = Omit<StoredState, "roleAccess" | "schedulesByLearner" | "importBooks" | "questionCollectionsByLearner"> & {
    roleAccess?: LegacyRoleAccess;
    schedulesByLearner?: Record<string, ScheduledPractice[]>;
    importBooks?: ImportBook[];
    questionCollectionsByLearner?: Record<string, QuestionCollection[]>;
};

/** 判斷未知值是否為一般物件。 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 將舊合併科目轉為目前的獨立科目。
 * @param subject 舊版或目前使用的科目。
 * @returns 可供目前資料模型使用的科目。
 */
function migrateSubject(subject: LegacySubject): Subject {
    if (subject === "自然") return "生物";
    if (subject === "社會") return "地理";
    return subject;
}

/**
 * 將舊科目範圍轉為獨立科目的範圍鍵值。
 * @param value 原始範圍鍵值。
 * @param legacySubject 舊版科目名稱。
 * @param subject 目前科目名稱。
 * @returns 更新科目前綴後的範圍鍵值。
 */
function migrateScope(value: string, legacySubject: LegacySubject, subject: Subject, scopeAliases: Map<string, string>) {
    if (value === ALL_UNITS) return value;
    const subjectScope = value.replace(`${legacySubject}::`, `${subject}::`);
    return scopeAliases.get(value) ?? scopeAliases.get(subjectScope) ?? subjectScope;
}

/**
 * 補齊拆分後各科目的書籍版本。
 * @param versions 舊版或目前的科目版本資料。
 * @returns 包含所有目前科目的版本資料。
 */
function migrateBookVersions(versions: Partial<Record<LegacySubject, string>>) {
    const legacySubjects: Partial<Record<Subject, LegacySubject>> = {
        理化: "自然",
        生物: "自然",
        歷史: "社會",
        地理: "社會",
        公民: "社會",
    };
    return Object.fromEntries(SUBJECTS.map((subject) => [
        subject,
        versions[subject] ?? versions[legacySubjects[subject] as LegacySubject] ?? "",
    ])) as Record<Subject, string>;
}

/**
 * 將舊考試範圍轉為拆分後的科目範圍。
 * @param ranges 舊版或目前的考試範圍。
 * @returns 包含所有目前科目的考試範圍。
 */
function migrateRanges(ranges: LegacyRanges, scopeAliases: Map<string, string>) {
    return Object.fromEntries(SUBJECTS.map((subject) => {
        const legacySubject = subject === "生物" ? "自然" : subject === "地理" ? "社會" : subject;
        const range = ranges[subject] ?? ranges[legacySubject] ?? { start: ALL_UNITS, end: ALL_UNITS };
        return [subject, {
            start: migrateScope(range.start, legacySubject, subject, scopeAliases),
            end: migrateScope(range.end, legacySubject, subject, scopeAliases),
        }];
    })) as Record<Subject, AssessmentRange>;
}

/** 將舊版單一考試資料轉成可保存多筆的考試設定。 */
function migratePlan(plan: LegacyPracticePlan, scopeAliases: Map<string, string>): PracticePlan {
    const { assessment: _assessment, assessmentRanges, assessmentScope, examDate: _examDate, ...current } = plan;
    const creatorRole = ["家長", "學習者", "家教"].includes(current.creatorRole) ? current.creatorRole : "家長";
    const subject = current.subject === "自然" ? "生物" : current.subject === "社會" ? "地理" : current.subject;
    const subjectScope = current.scope
        .replace("自然::", "生物::")
        .replace("社會::", "地理::");
    const scope = scopeAliases.get(current.scope) ?? scopeAliases.get(subjectScope) ?? subjectScope;
    if (plan.examSettings?.length) {
        const activeExamId = plan.examSettings.some((exam) => exam.id === plan.activeExamId)
            ? plan.activeExamId as string
            : plan.examSettings[0].id;
        const examSettings = plan.examSettings.map((exam) => ({
            ...exam,
            ranges: migrateRanges(exam.ranges as LegacyRanges, scopeAliases),
        }));
        return { ...current, subject, scope, creatorRole, metadataFilters: plan.metadataFilters ?? {}, examSettings, activeExamId };
    }
    const legacySubjects: LegacySubject[] = [...SUBJECTS, "自然", "社會"];
    const legacySubject = legacySubjects.find((candidate) => assessmentScope?.startsWith(`${candidate}::`));
    const legacyRanges = assessmentRanges ?? (legacySubject ? {
        [legacySubject]: { start: assessmentScope ?? ALL_UNITS, end: assessmentScope ?? ALL_UNITS },
    } : {});
    const ranges = migrateRanges(legacyRanges, scopeAliases);
    const examSettings: ExamSetting[] = [{
        id: "exam-1",
        name: plan.assessment ?? "第一次定期評量",
        date: plan.examDate ?? "",
        ranges,
    }];
    return { ...current, subject, scope, creatorRole, metadataFilters: plan.metadataFilters ?? {}, examSettings, activeExamId: examSettings[0].id };
}

/** 將既有核心欄位轉成可動態篩選的來源欄位。 */
function migrateQuestion(question: Question): Question {
    const current = {
        ...question,
        subject: migrateSubject(question.subject as LegacySubject),
        prompt: normalizeQuestionText(question.prompt),
        explanation: normalizeQuestionText(question.explanation),
        ...(question.options ? { options: question.options.map(normalizeQuestionText) } : {}),
        ...(question.parts ? { parts: question.parts.map((part) => ({
            ...part,
            prompt: normalizeQuestionText(part.prompt),
            ...(part.options ? { options: part.options.map(normalizeQuestionText) } : {}),
        })) } : {}),
        ...(question.blocks ? { blocks: question.blocks.map((block) => block.text ? {
            ...block,
            text: normalizeQuestionText(block.text),
        } : block) } : {}),
    };
    const existingMetadata = current.metadata?.map((field) => field.key === "source" ? {
        ...field,
        rawValue: field.rawValue === question.source ? current.source : field.rawValue,
        values: field.values.map((value) => value === question.source ? current.source : value),
    } : field);
    if (existingMetadata?.length) return { ...current, metadata: existingMetadata };
    const metadata: QuestionMetadataField[] = [
        { key: "source", label: "來源", rawValue: current.source, values: [current.source], valueSource: "fixture", confidence: 1 },
        { key: "knowledge_point", label: "知識點", rawValue: current.knowledge, values: [current.knowledge], valueSource: "fixture", confidence: 1 },
    ];
    const sourceType = ["舊綱題", "會考", "基測", "同步練習卷", "素養題", "試題"].find((value) => current.source.includes(value));
    if (sourceType) metadata.push({ key: "source_type", label: "來源類型", rawValue: sourceType, values: [sourceType], valueSource: "path", confidence: 1 });
    const exam = current.prompt.match(/〔(\d{2,3})\.(第一次|第二次)?(基測|會考)〕/);
    if (exam) {
        metadata.push({ key: "exam_year", label: "考試年份", rawValue: exam[1], values: [exam[1]], valueSource: "document", confidence: 1 });
        metadata.push({ key: "exam_type", label: "考試類型", rawValue: exam[3], values: [exam[3]], valueSource: "document", confidence: 1 });
        if (exam[2]) metadata.push({ key: "exam_session", label: "考試梯次", rawValue: exam[2], values: [exam[2]], valueSource: "document", confidence: 1 });
    }
    const questionNumber = current.sourceDetail?.questionNumber;
    const code = current.code ?? (questionNumber && /^\d{8,12}$/.test(questionNumber) ? questionNumber : undefined);
    return { ...current, ...(code ? { code } : {}), metadata };
}

/**
 * 建立舊單元鍵值到來源文件單元鍵值的對照。
 * @param questions 尚未遷移的題目資料。
 * @returns 可同步修正練習與考試範圍的對照表。
 */
function getScopeAliases(questions: Question[]) {
    const aliases = new Map<string, string>();
    questions.forEach((question) => {
        const legacySubject = question.subject as LegacySubject;
        const subject = migrateSubject(legacySubject);
        const unit = question.unit;
        const scope = `${subject}::${unit}`;
        aliases.set(`${legacySubject}::${question.unit}`, scope);
        aliases.set(`${subject}::${question.unit}`, scope);
    });
    return aliases;
}

/** 將 runtime JSON 升級為目前的資料格式。 */
function migrateDatabase(database: MockDatabase) {
    const state = database.state as LegacyStoredState;
    const fixtureDatabase = fixture as unknown as MockDatabase;
    const fixtureImports = fixtureDatabase.imports;
    const importIds = new Set(database.imports.map((batch) => batch.id));
    const fixtureQuestions = new Map(fixtureDatabase.questions.map((question) => [question.id, question]));
    const currentQuestionIds = new Set(database.questions.map((question) => question.id));
    const sourceQuestions = [
        ...database.questions,
        ...fixtureDatabase.questions.filter((question) => !currentQuestionIds.has(question.id)),
    ];
    const preparedQuestions = sourceQuestions.map((question) => {
        const fixtureQuestion = fixtureQuestions.get(question.id);
        const fixtureMetadata = fixtureQuestion?.metadata ?? [];
        const currentMetadata = question.metadata ?? [];
        const metadata = [...fixtureMetadata, ...currentMetadata]
            .filter((field, index, fields) => fields.findIndex((candidate) => candidate.key === field.key && candidate.rawValue === field.rawValue) === index);
        return {
            ...question,
            code: question.code ?? fixtureQuestion?.code,
            ...(metadata.length ? { metadata } : {}),
        };
    });
    const scopeAliases = getScopeAliases(preparedQuestions);
    const questions = preparedQuestions.map(migrateQuestion);
    const questionById = new Map(questions.map((question) => [question.id, question]));
    const plansByLearner = Object.fromEntries(Object.entries(state.plansByLearner)
        .map(([learnerId, plan]) => [learnerId, migratePlan(plan as LegacyPracticePlan, scopeAliases)]));
    const learners = state.learners.map((learner) => ({
        ...learner,
        bookVersions: migrateBookVersions(learner.bookVersions as Partial<Record<LegacySubject, string>>),
    }));
    const learnerIds = learners.map((learner) => learner.id);
    const roles: AccountRole[] = ["家長", "學習者", "家教"];
    const roleAccess: RoleAccess = {
        ...DEFAULT_ROLE_ACCESS,
        ...state.roleAccess,
        learnerIdsByRole: Object.fromEntries(roles.map((role) => [
            role,
            (state.roleAccess?.learnerIdsByRole?.[role] ?? learnerIds).filter((learnerId) => learnerIds.includes(learnerId)),
        ])) as Record<AccountRole, string[]>,
    };
    const scheduleSource = state.schedulesByLearner ?? fixtureDatabase.state.schedulesByLearner;
    const schedulesByLearner = Object.fromEntries(Object.entries(scheduleSource)
        .map(([learnerId, schedules]) => [learnerId, schedules.map((schedule) => ({
            ...schedule,
            subjectLabel: schedule.subjectLabel
                .replace(/^自然(?=\s*·)/, "生物")
                .replace(/^社會(?=\s*·)/, "地理"),
            scopeLabel: (() => {
                const units = [...new Set(schedule.questionIds
                    .map((id) => questionById.get(id)?.unit)
                    .filter((unit): unit is string => Boolean(unit)))];
                return units.length === 1 ? getUnitLabel(units[0]) : schedule.scopeLabel;
            })(),
        }))]));
    const fixtureCollections = fixtureDatabase.state.questionCollectionsByLearner;
    const collectionSource = state.questionCollectionsByLearner ?? fixtureCollections;
    const questionCollectionsByLearner = Object.fromEntries(learnerIds.map((learnerId) => [
        learnerId,
        collectionSource[learnerId] ?? [],
    ]));
    return {
        ...database,
        version: Math.max(database.version, 14),
        questions,
        imports: [...fixtureImports.filter((batch) => !importIds.has(batch.id)), ...database.imports],
        state: {
            ...state,
            learners,
            plansByLearner,
            roleAccess,
            importBooks: state.importBooks ?? [],
            schedulesByLearner,
            questionCollectionsByLearner,
        },
    } as MockDatabase;
}

/** 確認 runtime JSON 已從 fixture 初始化。 */
async function ensureRuntime() {
    await mkdir(RUNTIME_ASSETS, { recursive: true });

    try {
        await stat(RUNTIME_FILE);
    }
    catch {
        const initial = JSON.stringify(fixture, null, 2);
        await writeFile(RUNTIME_FILE, `${initial}\n`, "utf8");
        await cp(FIXTURE_ASSETS, RUNTIME_ASSETS, { recursive: true, force: false });
    }
}

/** 以暫存檔替換 runtime JSON，避免中途失敗留下半份資料。 */
async function writeDatabase(database: MockDatabase) {
    const temporary = `${RUNTIME_FILE}.${process.pid}.${Date.now()}.tmp`;
    const serialized = `${JSON.stringify(database, null, 2)}\n`;
    await writeFile(temporary, serialized, "utf8");
    await rename(temporary, RUNTIME_FILE);
}

/** 讀取目前可寫入的 JSON 模擬資料庫。 */
export async function readDatabase(): Promise<MockDatabase> {
    await ensureRuntime();
    const raw = await readFile(RUNTIME_FILE, "utf8");
    return migrateDatabase(JSON.parse(raw) as MockDatabase);
}

/** 依序修改 runtime JSON，避免同一個 Node 程序內的寫入互相覆蓋。 */
export async function updateDatabase(mutator: (database: MockDatabase) => MockDatabase | Promise<MockDatabase>) {
    const task = writeQueue.then(async () => {
        const current = await readDatabase();
        const next = await mutator(current);
        await writeDatabase(next);
        return next;
    });
    writeQueue = task.catch(() => undefined);
    return task;
}

/** 將 runtime JSON 與圖片恢復成 fixture。 */
export async function resetDatabase() {
    const task = writeQueue.then(async () => {
        await rm(RUNTIME_DIR, { recursive: true, force: true });
        await ensureRuntime();
        return readDatabase();
    });
    writeQueue = task.catch(() => undefined);
    return task;
}

/** 驗證前端送來的學習狀態，阻擋不完整或超量資料。 */
export function parseStoredState(value: unknown, questions: Question[]): StoredState | null {
    if (!isRecord(value) || JSON.stringify(value).length > MAX_STATE_BYTES) return null;
    if (!Array.isArray(value.learners) || !value.learners.length || value.learners.length > 20) return null;

    const learners = value.learners;
    const learnerIds: string[] = [];
    for (const learner of learners) {
        const bookVersions = isRecord(learner) ? learner.bookVersions : null;
        if (!isRecord(learner)
            || typeof learner.id !== "string" || !learner.id || learner.id.length > 80
            || typeof learner.name !== "string" || learner.name.length > 80
            || typeof learner.grade !== "string" || learner.grade.length > 20
            || typeof learner.semester !== "string" || learner.semester.length > 20
            || typeof learner.school !== "string" || learner.school.length > 120
            || (learner.avatar !== undefined && (typeof learner.avatar !== "string" || learner.avatar.length > 1_500_000))
            || !Number.isInteger(learner.defaultQuestionLimit) || Number(learner.defaultQuestionLimit) < 1
            || Number(learner.defaultQuestionLimit) > 500
            || !isRecord(bookVersions)
            || !SUBJECTS.every((subject) => typeof bookVersions[subject] === "string" && String(bookVersions[subject]).length <= 80)) return null;
        learnerIds.push(learner.id);
    }

    if (new Set(learnerIds).size !== learnerIds.length
        || typeof value.activeLearnerId !== "string"
        || !learnerIds.includes(value.activeLearnerId)
        || !isRecord(value.attemptsByLearner)
        || !isRecord(value.plansByLearner)
        || !isRecord(value.schedulesByLearner)
        || !isRecord(value.questionCollectionsByLearner)
        || !isRecord(value.roleAccess)
        || !Array.isArray(value.importBooks)
        || !isRecord(value.queuedSimilarByLearner)) return null;

    const roleAccess = value.roleAccess;
    const roles: AccountRole[] = ["家長", "學習者", "家教"];
    if (!roles.includes(roleAccess.activeRole as AccountRole)
        || typeof roleAccess.registrationEmail !== "string" || roleAccess.registrationEmail.length > 254
        || !isRecord(roleAccess.pinHashes)
        || !Object.entries(roleAccess.pinHashes).every(([role, hash]) => roles.includes(role as AccountRole)
            && role !== "學習者" && typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash))) return null;
    if (!isRecord(roleAccess.learnerIdsByRole)) return null;
    const learnerIdsByRole = roleAccess.learnerIdsByRole;
    if (!roles.every((role) => {
        const assigned = learnerIdsByRole[role];
        return Array.isArray(assigned)
            && assigned.length <= learnerIds.length
            && assigned.every((learnerId: unknown) => learnerIds.includes(String(learnerId)));
    })) return null;

    const importBooks = value.importBooks;
    const importBookIds = importBooks.map((book) => isRecord(book) ? book.id : null);
    if (importBooks.length > 100 || new Set(importBookIds).size !== importBookIds.length || !importBooks.every((book) => isRecord(book)
        && typeof book.id === "string" && book.id.length > 0 && book.id.length <= 80
        && typeof book.name === "string" && book.name.trim().length > 0 && book.name.length <= 80
        && roles.includes(book.ownerRole as AccountRole)
        && Array.isArray(book.learnerIds) && book.learnerIds.length <= learnerIds.length
        && book.learnerIds.every((learnerId) => learnerIds.includes(String(learnerId)))
        && typeof book.createdAt === "string" && !Number.isNaN(Date.parse(book.createdAt)))) return null;

    const questionsById = new Map(questions.map((question) => [question.id, question]));
    const questionIds = new Set(questionsById.keys());
    for (const learnerId of learnerIds) {
        const attempts = value.attemptsByLearner[learnerId];
        const plan = value.plansByLearner[learnerId];
        const schedules = value.schedulesByLearner[learnerId];
        const collections = value.questionCollectionsByLearner[learnerId];
        const queue = value.queuedSimilarByLearner[learnerId];
        if (!Array.isArray(attempts) || attempts.length > 10_000 || !isRecord(plan) || !Array.isArray(schedules) || schedules.length > 500 || !Array.isArray(collections) || collections.length > 100 || !Array.isArray(queue)) return null;
        if (!attempts.every((attempt) => isRecord(attempt)
            && typeof attempt.questionId === "number" && questionIds.has(attempt.questionId)
            && (attempt.sessionId === undefined || (typeof attempt.sessionId === "string" && attempt.sessionId.length <= 120))
            && (attempt.sessionMode === undefined || ["practice", "review", "similar"].includes(String(attempt.sessionMode)))
            && typeof attempt.answer === "string" && attempt.answer.length <= 4_000
            && (typeof attempt.correct === "boolean" || attempt.correct === null)
            && (attempt.partResults === undefined || (Array.isArray(attempt.partResults) && attempt.partResults.length <= 100
                && attempt.partResults.every((result) => isRecord(result)
                    && typeof result.partId === "string" && result.partId.length <= 120
                    && typeof result.answer === "string" && result.answer.length <= 4_000
                    && typeof result.correct === "boolean"
                    && questionsById.get(Number(attempt.questionId))?.parts?.some((part) => part.id === result.partId))))
            && typeof attempt.date === "string" && !Number.isNaN(Date.parse(attempt.date))
            && typeof attempt.durationSeconds === "number" && attempt.durationSeconds >= 0
            && (attempt.handwriting === undefined || (typeof attempt.handwriting === "string" && attempt.handwriting.length <= 2_000_000)))) return null;
        const examSettings = plan.examSettings;
        if (typeof plan.creatorRole !== "string"
            || typeof plan.subject !== "string"
            || typeof plan.scope !== "string"
            || (plan.bookVersion !== undefined && (typeof plan.bookVersion !== "string" || plan.bookVersion.length > 80))
            || !Array.isArray(examSettings) || !examSettings.length || examSettings.length > 20
            || typeof plan.activeExamId !== "string"
            || !examSettings.some((exam) => isRecord(exam) && exam.id === plan.activeExamId)
            || !["complete", "instant", "score"].includes(String(plan.checkMode))
            || !Number.isInteger(plan.questionLimit) || Number(plan.questionLimit) < 1
            || !["chapter", "assessment"].includes(String(plan.basis))
            || !isRecord(plan.difficultyMix)
            || ![plan.difficultyMix.easy, plan.difficultyMix.medium, plan.difficultyMix.hard].every((item) => typeof item === "number" && item >= 0 && item <= 100)
            || !Array.isArray(plan.sourceFilters)
            || !plan.sourceFilters.every((item) => typeof item === "string" && item.length <= 240)
            || !["all", "choice", "boolean", "written", "multi-choice"].includes(String(plan.questionKind))
            || typeof plan.knowledge !== "string"
            || !isRecord(plan.metadataFilters)
            || !Object.entries(plan.metadataFilters).every(([key, items]) => /^[a-z][a-z0-9_]{0,79}$/.test(key)
                && Array.isArray(items) && items.length <= 100
                && items.every((item) => typeof item === "string" && item.length <= 240))) return null;
        const examIds = examSettings.map((exam) => isRecord(exam) ? exam.id : null);
        if (new Set(examIds).size !== examIds.length || !examSettings.every((exam) => {
            if (!isRecord(exam)
                || typeof exam.id !== "string" || !exam.id || exam.id.length > 80
                || typeof exam.name !== "string" || !exam.name || exam.name.length > 120
                || typeof exam.date !== "string" || exam.date.length > 20
                || !isRecord(exam.ranges)) return false;
            const ranges = exam.ranges;
            return SUBJECTS.every((subject) => {
                const range = ranges[subject];
                return isRecord(range)
                    && typeof range.start === "string" && range.start.length <= 240
                    && typeof range.end === "string" && range.end.length <= 240;
            });
        })) return null;
        if (!queue.every((id) => typeof id === "number" && questionIds.has(id))) return null;
        const collectionIds = collections.map((collection) => isRecord(collection) ? collection.id : null);
        if (new Set(collectionIds).size !== collectionIds.length || !collections.every((collection) => isRecord(collection)
            && typeof collection.id === "string" && collection.id.length > 0 && collection.id.length <= 120
            && typeof collection.name === "string" && collection.name.trim().length > 0 && collection.name.length <= 80
            && Array.isArray(collection.questionIds) && collection.questionIds.length <= 10_000
            && collection.questionIds.every((id) => typeof id === "number" && questionIds.has(id))
            && typeof collection.createdAt === "string" && !Number.isNaN(Date.parse(collection.createdAt)))) return null;
        if (!schedules.every((schedule) => isRecord(schedule)
            && typeof schedule.id === "string" && schedule.id.length > 0 && schedule.id.length <= 120
            && ["家長", "學習者", "家教"].includes(String(schedule.creatorRole))
            && typeof schedule.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(schedule.date)
            && (schedule.time === undefined || (typeof schedule.time === "string" && /^\d{2}:\d{2}$/.test(schedule.time)))
            && typeof schedule.subjectLabel === "string" && schedule.subjectLabel.length <= 120
            && typeof schedule.scopeLabel === "string" && schedule.scopeLabel.length <= 240
            && ["complete", "instant", "score"].includes(String(schedule.checkMode))
            && Array.isArray(schedule.questionIds) && schedule.questionIds.length > 0 && schedule.questionIds.length <= 500
            && schedule.questionIds.every((id) => typeof id === "number" && questionIds.has(id))
            && typeof schedule.createdAt === "string" && !Number.isNaN(Date.parse(schedule.createdAt))
            && (schedule.result === undefined || (isRecord(schedule.result)
                && typeof schedule.result.sessionId === "string" && schedule.result.sessionId.length <= 120
                && typeof schedule.result.completedAt === "string" && !Number.isNaN(Date.parse(schedule.result.completedAt))
                && Number.isInteger(schedule.result.totalQuestions) && Number(schedule.result.totalQuestions) > 0 && Number(schedule.result.totalQuestions) <= 500
                && Number.isInteger(schedule.result.wrongQuestions) && Number(schedule.result.wrongQuestions) >= 0 && Number(schedule.result.wrongQuestions) <= Number(schedule.result.totalQuestions)
                && Number.isInteger(schedule.result.accuracy) && Number(schedule.result.accuracy) >= 0 && Number(schedule.result.accuracy) <= 100)))) return null;
    }

    return value as unknown as StoredState;
}

/** 取得 runtime 圖片的絕對路徑，拒絕目錄跳脫字串。 */
export function getAssetPath(storageKey: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(storageKey)) return null;
    return path.join(RUNTIME_ASSETS, storageKey);
}

/** 將 data URL 圖片寫入 runtime asset 目錄並回傳儲存資訊。 */
export async function writeDataImage(dataUrl: string) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new Error("INVALID_IMAGE");
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new Error("INVALID_IMAGE_SIZE");
    const extension = match[1] === "image/jpeg" ? "jpg" : match[1].split("/")[1];
    const storageKey = `${crypto.randomUUID()}.${extension}`;
    await ensureRuntime();
    await writeFile(path.join(RUNTIME_ASSETS, storageKey), buffer);
    return { storageKey, mimeType: match[1], bytes: buffer.length };
}

/** 移除匯入失敗後留下的 runtime 圖片。 */
export async function removeAssets(storageKeys: string[]) {
    await Promise.all(storageKeys.map((storageKey) => rm(path.join(RUNTIME_ASSETS, storageKey), { force: true })));
}
