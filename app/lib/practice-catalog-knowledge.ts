import type { LocalPracticeQuestion } from "./local-practice-types";

export interface PracticeCatalogKnowledgeRow {
    question_revision_id: string;
    id: string;
    code: string | null;
    name: string;
    is_primary: boolean;
}

/**
 * Published revision classifications are immutable, so this second batched read
 * can safely enrich the already-authorized catalog page without an N+1 query.
 */
export const PRACTICE_CATALOG_KNOWLEDGE_SQL = `
    SELECT
        relation.question_revision_id,
        knowledge_point.id,
        knowledge_point.code,
        knowledge_point.name,
        relation.is_primary
    FROM question_revision_knowledge_points AS relation
    JOIN knowledge_points AS knowledge_point
        ON knowledge_point.id = relation.knowledge_point_id
        AND knowledge_point.status = 'active'
    WHERE relation.question_revision_id = ANY($1::uuid[])
    ORDER BY
        relation.question_revision_id,
        relation.is_primary DESC,
        knowledge_point.name,
        knowledge_point.id
`;

/** Adds all real catalog knowledge points while keeping legacy DTO inputs valid. */
export function attachPracticeCatalogKnowledge(
    questions: readonly LocalPracticeQuestion[],
    rows: readonly PracticeCatalogKnowledgeRow[],
): LocalPracticeQuestion[] {
    const byRevision = new Map<string, LocalPracticeQuestion["knowledgePoints"]>();
    for (const row of rows) {
        const current = byRevision.get(row.question_revision_id) ?? [];
        current.push({
            id: row.id,
            code: row.code,
            name: row.name,
            isPrimary: row.is_primary,
        });
        byRevision.set(row.question_revision_id, current);
    }

    return questions.map((question) => ({
        ...question,
        knowledgePoints: byRevision.get(question.revisionId) ?? [],
    }));
}
