import { createHash, randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";

import type { AdminQueryRunner } from "./admin-auth.ts";
import type { AdminMutationContext, AdminMutationSpec } from "./admin-mutation-handler.ts";
import { adminMutationReceipts } from "./admin-mutation-receipts.ts";
import { AdminApiError } from "./admin-types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface RelationTemplateProposal {
    id: string;
    templateKey: string;
    normalizedPattern: string;
    logicKey: string;
    evidence: Record<string, unknown>;
    questionCount: number;
    prompts: string[];
    variables: Array<Record<string, unknown>>;
}

export interface RelationKeywordProposal {
    keywordId: string;
    revisionId: string;
    questionId: string;
    keywordKey: string;
    label: string;
    kind: string;
    evidence: Record<string, unknown>;
    prompt: string;
}

interface TemplateRow extends QueryResultRow {
    id: string;
    template_key: string;
    normalized_pattern: string;
    logic_key: string;
    evidence: Record<string, unknown>;
    question_count: number;
    prompts: string[];
    variables: Array<Record<string, unknown>>;
}

interface KeywordRow extends QueryResultRow {
    keyword_id: string;
    revision_id: string;
    question_id: string;
    keyword_key: string;
    label: string;
    keyword_kind: string;
    evidence: Record<string, unknown>;
    prompt: string;
}

interface IdRow extends QueryResultRow {
    id: string;
}

export interface QuestionRelationReviewSnapshot {
    templates: RelationTemplateProposal[];
    keywords: RelationKeywordProposal[];
    templateTotal: number;
    keywordTotal: number;
}

function assertUuid(value: string, label: string): string {
    if (!UUID_PATTERN.test(value)) throw new AdminApiError("INVALID_INPUT", `${label}格式不正確。`, 422);
    return value;
}

function parseDecision(value: unknown): "approve" | "reject" {
    if (value !== "approve" && value !== "reject") {
        throw new AdminApiError("INVALID_INPUT", "審核決定格式不正確。", 422);
    }
    return value;
}

function parseReason(value: unknown, decision: "approve" | "reject"): string | null {
    if (value === null || value === undefined || value === "") {
        if (decision === "reject") throw new AdminApiError("INVALID_INPUT", "退回時必須填寫原因。", 422);
        return null;
    }
    if (typeof value !== "string" || value.trim().length > 500 || /[\u0000-\u001f\u007f]/u.test(value)) {
        throw new AdminApiError("INVALID_INPUT", "審核原因格式不正確。", 422);
    }
    return value.trim();
}

function fingerprint(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export async function listPendingQuestionRelations(
    runner: AdminQueryRunner,
    limit = 50,
): Promise<QuestionRelationReviewSnapshot> {
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const [templates, keywords, counts] = await Promise.all([
        runner.query<TemplateRow>(`
            SELECT
                template.id,
                template.template_key,
                template.normalized_pattern,
                template.logic_key,
                template.evidence,
                COUNT(membership.question_id)::integer AS question_count,
                ARRAY_AGG(COALESCE(prompt.prompt, '（無文字題幹）') ORDER BY membership.question_id) AS prompts,
                jsonb_agg(membership.variable_values ORDER BY membership.question_id) AS variables
            FROM question_templates AS template
            JOIN question_template_memberships AS membership
                ON membership.question_template_id = template.id
                AND membership.status = 'pending'
            LEFT JOIN LATERAL (
                SELECT string_agg(block.text_content, ' ' ORDER BY block.position, block.id) AS prompt
                FROM question_content_blocks AS block
                WHERE block.question_revision_id = membership.based_on_revision_id
                    AND block.placement IN ('prompt', 'transcript')
                    AND block.text_content IS NOT NULL
            ) AS prompt ON TRUE
            WHERE template.status = 'pending'
            GROUP BY template.id
            ORDER BY template.created_at, template.id
            LIMIT $1
        `, [boundedLimit]),
        runner.query<KeywordRow>(`
            SELECT
                keyword.id AS keyword_id,
                relation.question_revision_id AS revision_id,
                revision.question_id,
                keyword.keyword_key,
                keyword.label,
                keyword.keyword_kind,
                relation.evidence,
                COALESCE(prompt.prompt, '（無文字題幹）') AS prompt
            FROM question_revision_keywords AS relation
            JOIN relation_keywords AS keyword ON keyword.id = relation.relation_keyword_id
            JOIN question_revisions AS revision ON revision.id = relation.question_revision_id
            LEFT JOIN LATERAL (
                SELECT string_agg(block.text_content, ' ' ORDER BY block.position, block.id) AS prompt
                FROM question_content_blocks AS block
                WHERE block.question_revision_id = relation.question_revision_id
                    AND block.placement IN ('prompt', 'transcript')
                    AND block.text_content IS NOT NULL
            ) AS prompt ON TRUE
            WHERE relation.status = 'pending'
            ORDER BY relation.created_at, relation.question_revision_id, keyword.id
            LIMIT $1
        `, [boundedLimit]),
        runner.query<{ template_total: number; keyword_total: number }>(`
            SELECT
                (SELECT COUNT(*)::integer FROM question_templates WHERE status = 'pending') AS template_total,
                (SELECT COUNT(*)::integer FROM question_revision_keywords WHERE status = 'pending') AS keyword_total
        `),
    ]);
    const count = counts.rows[0] ?? { template_total: 0, keyword_total: 0 };
    return {
        templates: templates.rows.map((row) => ({
            id: row.id,
            templateKey: row.template_key,
            normalizedPattern: row.normalized_pattern,
            logicKey: row.logic_key,
            evidence: row.evidence,
            questionCount: Number(row.question_count),
            prompts: row.prompts,
            variables: row.variables,
        })),
        keywords: keywords.rows.map((row) => ({
            keywordId: row.keyword_id,
            revisionId: row.revision_id,
            questionId: row.question_id,
            keywordKey: row.keyword_key,
            label: row.label,
            kind: row.keyword_kind,
            evidence: row.evidence,
            prompt: row.prompt,
        })),
        templateTotal: Number(count.template_total),
        keywordTotal: Number(count.keyword_total),
    };
}

async function insertAudit(
    context: AdminMutationContext,
    action: string,
    targetType: string,
    targetId: string,
    decision: string,
    reason: string | null,
): Promise<string> {
    const auditId = randomUUID();
    const result = await context.runner.query<IdRow>(`
        INSERT INTO admin_audit_logs (
            id, actor_type, actor_user_id, action, target_type, target_id,
            before_data, after_data, request_id, created_at
        )
        VALUES (
            $1::uuid, 'user', $2::uuid, $3::varchar, $4::varchar, $5::uuid,
            '{"status":"pending"}'::jsonb, $6::jsonb, $7::varchar, transaction_timestamp()
        )
        RETURNING id
    `, [auditId, context.actor.userId, action, targetType, targetId,
        JSON.stringify({ decision, reason }), context.evidence.requestId]);
    if (!result.rows[0]?.id) throw new AdminApiError("CONFLICT", "題型關係稽核未完成。", 409);
    return auditId;
}

async function reviewTemplate(
    context: AdminMutationContext,
    targetId: string,
    decision: "approve" | "reject",
    reason: string | null,
) {
    const templateId = assertUuid(targetId, "模板識別碼");
    return adminMutationReceipts.execute(context.runner, {
        actorUserId: context.actor.userId,
        operation: "question_relation_template_review",
        key: context.evidence.idempotencyKey,
        payloadFingerprint: fingerprint([templateId, decision, reason]),
        requestId: context.evidence.requestId,
    }, async () => {
        const locked = await context.runner.query<IdRow>(`
            SELECT id FROM question_templates WHERE id = $1::uuid AND status = 'pending' FOR UPDATE
        `, [templateId]);
        if (!locked.rows[0]) throw new AdminApiError("CONFLICT", "模板已被審核或不存在。", 409);
        const templateStatus = decision === "approve" ? "confirmed" : "inactive";
        const memberStatus = decision === "approve" ? "confirmed" : "rejected";
        await context.runner.query(`
            UPDATE question_templates
            SET status = $2, confirmed_by_user_id = $3::uuid, confirmed_at = transaction_timestamp(),
                evidence = evidence || jsonb_build_object('review_reason', $4::text)
            WHERE id = $1::uuid AND status = 'pending'
        `, [templateId, templateStatus, context.actor.userId, reason]);
        await context.runner.query(`
            UPDATE question_template_memberships
            SET status = $2, reviewed_by_user_id = $3::uuid, reviewed_at = transaction_timestamp(),
                evidence = evidence || jsonb_build_object('review_reason', $4::text)
            WHERE question_template_id = $1::uuid AND status = 'pending'
        `, [templateId, memberStatus, context.actor.userId, reason]);
        const auditId = await insertAudit(context, "question_relation_template_reviewed", "question_template", templateId, decision, reason);
        const result = { targetId: templateId, kind: "template" as const, decision };
        return { result, receipt: { targetType: "question_template", targetId: templateId, auditLogId: auditId, responseStatus: 200 } };
    });
}

async function reviewKeyword(
    context: AdminMutationContext,
    revisionId: string,
    targetId: string,
    decision: "approve" | "reject",
    reason: string | null,
) {
    const keywordId = assertUuid(targetId, "關鍵字識別碼");
    const checkedRevisionId = assertUuid(revisionId, "題目版本識別碼");
    return adminMutationReceipts.execute(context.runner, {
        actorUserId: context.actor.userId,
        operation: "question_relation_keyword_review",
        key: context.evidence.idempotencyKey,
        payloadFingerprint: fingerprint([checkedRevisionId, keywordId, decision, reason]),
        requestId: context.evidence.requestId,
    }, async () => {
        const locked = await context.runner.query<IdRow>(`
            SELECT relation_keyword_id AS id
            FROM question_revision_keywords
            WHERE question_revision_id = $1::uuid AND relation_keyword_id = $2::uuid AND status = 'pending'
            FOR UPDATE
        `, [checkedRevisionId, keywordId]);
        if (!locked.rows[0]) throw new AdminApiError("CONFLICT", "關鍵字關聯已被審核或不存在。", 409);
        if (decision === "approve") {
            await context.runner.query(`
                UPDATE relation_keywords
                SET status = 'active', reviewed_by_user_id = $2::uuid, reviewed_at = transaction_timestamp(),
                    evidence = evidence || jsonb_build_object('review_reason', $3::text)
                WHERE id = $1::uuid AND status = 'pending'
            `, [keywordId, context.actor.userId, reason]);
        }
        await context.runner.query(`
            UPDATE question_revision_keywords
            SET status = $3, reviewed_by_user_id = $4::uuid, reviewed_at = transaction_timestamp(),
                evidence = evidence || jsonb_build_object('review_reason', $5::text)
            WHERE question_revision_id = $1::uuid AND relation_keyword_id = $2::uuid AND status = 'pending'
        `, [checkedRevisionId, keywordId, decision === "approve" ? "confirmed" : "rejected", context.actor.userId, reason]);
        if (decision === "reject") {
            await context.runner.query(`
                UPDATE relation_keywords AS keyword
                SET status = 'inactive', reviewed_by_user_id = $2::uuid, reviewed_at = transaction_timestamp(),
                    evidence = evidence || jsonb_build_object('review_reason', $3::text)
                WHERE keyword.id = $1::uuid
                    AND keyword.status = 'pending'
                    AND NOT EXISTS (
                        SELECT 1
                        FROM question_revision_keywords AS relation
                        WHERE relation.relation_keyword_id = keyword.id
                            AND relation.status IN ('pending', 'confirmed')
                    )
            `, [keywordId, context.actor.userId, reason]);
        }
        const auditId = await insertAudit(context, "question_relation_keyword_reviewed", "relation_keyword", keywordId, decision, reason);
        const result = { targetId: keywordId, revisionId: checkedRevisionId, kind: "keyword" as const, decision };
        return { result, receipt: { targetType: "relation_keyword", targetId: keywordId, auditLogId: auditId, responseStatus: 200 } };
    });
}

export function questionRelationReviewSpec(
    kind: string,
    targetId: string,
    revisionId?: string,
): AdminMutationSpec<{ decision: "approve" | "reject"; reason: string | null }, unknown> {
    if (kind !== "template" && kind !== "keyword") throw new AdminApiError("NOT_FOUND", "找不到審核類型。", 404);
    return {
        allowedFields: ["decision", "reason"],
        parse(body) {
            const decision = parseDecision(body.decision);
            return { decision, reason: parseReason(body.reason, decision) };
        },
        mutate(context, input) {
            if (kind === "template") return reviewTemplate(context, targetId, input.decision, input.reason);
            if (!revisionId) throw new AdminApiError("INVALID_INPUT", "缺少題目版本識別碼。", 422);
            return reviewKeyword(context, revisionId, targetId, input.decision, input.reason);
        },
    };
}
