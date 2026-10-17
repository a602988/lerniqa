import {
    prepareQuestionInput,
    sha256,
    stableJson,
} from "./question-enrichment.mjs";
import {
    RELATION_ANALYSIS_SCHEMA,
    RELATION_ANALYSIS_VERSION,
    relationKeywordId,
    relationTemplateId,
    validateRelationAnalysis,
} from "./question-relation-analysis.mjs";
import { readCurrentPublishedQuestionsInTransaction } from "./question-enrichment-db.mjs";

function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
}

async function transaction(client, operation) {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
        const result = await operation();
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
    }
}

function validateDocument(document) {
    if (!document || typeof document !== "object" || Array.isArray(document)
        || document.schema_version !== RELATION_ANALYSIS_SCHEMA
        || document.method_version !== RELATION_ANALYSIS_VERSION
        || document.complete !== true
        || !Array.isArray(document.results)
        || document.results.length !== document.result_count
        || typeof document.run_id !== "string") {
        fail("INVALID_RELATION_ANALYSIS", "題型關係分析檔格式不正確。");
    }
    const seen = new Set();
    return document.results.map((result) => {
        if (!result || typeof result !== "object" || typeof result.question_id !== "string"
            || typeof result.question_revision_id !== "string" || typeof result.input_sha256 !== "string") {
            fail("INVALID_RELATION_ANALYSIS", "題型關係分析結果缺少題目身分。");
        }
        if (seen.has(result.question_revision_id)) fail("INVALID_RELATION_ANALYSIS", "題型關係分析含重複版本。");
        seen.add(result.question_revision_id);
        const { template_key: storedTemplateKey, ...templateInput } = result.template ?? {};
        const validated = validateRelationAnalysis({ template: templateInput, keywords: result.keywords });
        if (storedTemplateKey !== validated.template.template_key) {
            fail("INVALID_RELATION_ANALYSIS", "題型關係分析的模板 key 與內容不一致。");
        }
        return { ...result, ...validated };
    });
}

function assertCurrentSnapshot(document, results, questions) {
    const current = new Map(questions.map((question) => {
        const prepared = prepareQuestionInput(question);
        return [prepared.revisionId, prepared];
    }));
    const manifest = results.map((result) => {
        const prepared = current.get(result.question_revision_id);
        if (!prepared || prepared.questionId !== result.question_id || prepared.inputSha256 !== result.input_sha256) {
            fail("RELATION_SOURCE_CHANGED", "題目目前版本或內容已變更，拒絕匯入舊分析。");
        }
        return {
            question_id: prepared.questionId,
            question_revision_id: prepared.revisionId,
            input_sha256: prepared.inputSha256,
        };
    }).sort((left, right) => left.question_revision_id.localeCompare(right.question_revision_id, "en"));
    if (sha256(manifest) !== document.source_manifest_sha256) {
        fail("RELATION_SOURCE_CHANGED", "題型關係分析來源清單與目前題庫不一致。");
    }
}

async function insertTemplate(client, document, result) {
    const template = result.template;
    let templateId = relationTemplateId(template.template_key);
    const evidence = {
        run_id: document.run_id,
        input_sha256: result.input_sha256,
        confidence: template.confidence,
        reasons: template.evidence,
    };
    const inserted = await client.query(`
        INSERT INTO question_templates (
            id, template_key, normalized_pattern, logic_key, status,
            created_source, method_version, evidence
        )
        VALUES ($1, $2, $3, $4, 'pending', 'ai', $5, $6::jsonb)
        ON CONFLICT (template_key) DO NOTHING
        RETURNING id
    `, [templateId, template.template_key, template.normalized_pattern, template.logic_key,
        document.method_version, JSON.stringify(evidence)]);
    if (inserted.rowCount === 0) {
        const existing = await client.query(`
            SELECT id, normalized_pattern, logic_key
            FROM question_templates
            WHERE template_key = $1
        `, [template.template_key]);
        const row = existing.rows[0];
        if (!row || row.normalized_pattern !== template.normalized_pattern
            || row.logic_key !== template.logic_key) {
            fail("RELATION_IDENTITY_COLLISION", "模板 key 已存在但內容不一致。");
        }
        templateId = row.id;
    }
    const membershipEvidence = { ...evidence, template_key: template.template_key };
    await client.query(`
        INSERT INTO question_template_memberships (
            question_template_id, question_id, based_on_revision_id,
            variable_values, status, evidence
        )
        VALUES ($1, $2, $3, $4::jsonb, 'pending', $5::jsonb)
        ON CONFLICT (question_template_id, question_id) DO NOTHING
    `, [templateId, result.question_id, result.question_revision_id,
        JSON.stringify(template.variables), JSON.stringify(membershipEvidence)]);
    const membership = await client.query(`
        SELECT based_on_revision_id, variable_values
        FROM question_template_memberships
        WHERE question_template_id = $1 AND question_id = $2
    `, [templateId, result.question_id]);
    const membershipRow = membership.rows[0];
    if (!membershipRow || membershipRow.based_on_revision_id !== result.question_revision_id
        || stableJson(membershipRow.variable_values) !== stableJson(template.variables)) {
        fail("RELATION_MEMBERSHIP_CONFLICT", "既有模板成員使用不同題目版本或可變值，拒絕覆寫審核結果。");
    }
    return templateId;
}

async function insertKeywords(client, document, result) {
    for (const keyword of result.keywords) {
        let keywordId = relationKeywordId(keyword.keyword_key);
        const evidence = {
            run_id: document.run_id,
            input_sha256: result.input_sha256,
            confidence: keyword.confidence,
            reasons: keyword.evidence,
        };
        await client.query(`
            INSERT INTO relation_keywords (
                id, keyword_key, label, keyword_kind, status,
                created_source, method_version, evidence
            )
            VALUES ($1, $2, $3, $4, 'pending', 'ai', $5, $6::jsonb)
            ON CONFLICT (keyword_key) DO NOTHING
        `, [keywordId, keyword.keyword_key, keyword.label, keyword.kind,
            document.method_version, JSON.stringify(evidence)]);
        const existing = await client.query(`
            SELECT id, label, keyword_kind
            FROM relation_keywords
            WHERE keyword_key = $1
        `, [keyword.keyword_key]);
        const row = existing.rows[0];
        if (!row || row.label !== keyword.label || row.keyword_kind !== keyword.kind) {
            fail("RELATION_IDENTITY_COLLISION", "關鍵字 key 已存在但標籤或種類不一致。");
        }
        keywordId = row.id;
        await client.query(`
            INSERT INTO question_revision_keywords (
                question_revision_id, relation_keyword_id, value_source,
                method_version, status, evidence
            )
            VALUES ($1, $2, 'ai', $3, 'pending', $4::jsonb)
            ON CONFLICT (question_revision_id, relation_keyword_id) DO NOTHING
        `, [result.question_revision_id, keywordId, document.method_version, JSON.stringify(evidence)]);
    }
}

export async function persistPendingQuestionRelations(client, document, {
    loadQuestions = readCurrentPublishedQuestionsInTransaction,
} = {}) {
    const results = validateDocument(document);
    return transaction(client, async () => {
        const questions = await loadQuestions(client);
        assertCurrentSnapshot(document, results, questions);
        for (const result of results) {
            await insertTemplate(client, document, result);
            await insertKeywords(client, document, result);
        }
        return {
            persisted: true,
            pending_templates: new Set(results.map((result) => result.template.template_key)).size,
            pending_memberships: results.length,
            pending_keyword_relations: results.reduce((count, result) => count + result.keywords.length, 0),
            fingerprint: sha256(stableJson(document)),
        };
    });
}
