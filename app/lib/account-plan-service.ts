import "server-only";

import type { PoolClient, QueryResultRow } from "pg";
import { queryLocalPostgres } from "./local-postgres";

export const OWNED_QUESTION_FEATURE = "owned_question_limit";
export const DAILY_PRACTICE_FEATURE = "daily_practice_question_limit";

interface PlanUsageRow extends QueryResultRow {
    code: string;
    name: string;
    owned_limit: number | string | null;
    daily_limit: number | string | null;
    owned_used: number | string;
    daily_used: number | string;
    usage_date: string;
}

export interface AccountPlanUsage {
    plan: { code: string; name: string };
    ownedQuestions: { used: number; limit: number | null };
    dailyPractice: { used: number; limit: number | null; resetsAt: string };
}

function numeric(value: number | string | null): number | null {
    return value === null ? null : Number(value);
}

function mapUsage(row: PlanUsageRow): AccountPlanUsage {
    const resetDate = new Date(`${row.usage_date}T00:00:00+08:00`);
    resetDate.setDate(resetDate.getDate() + 1);
    return {
        plan: { code: row.code, name: row.name },
        ownedQuestions: { used: Number(row.owned_used), limit: numeric(row.owned_limit) },
        dailyPractice: {
            used: Number(row.daily_used),
            limit: numeric(row.daily_limit),
            resetsAt: resetDate.toISOString(),
        },
    };
}

const USAGE_SQL = `
    SELECT
        plan.code,
        plan.name,
        owned.limit_value AS owned_limit,
        daily.limit_value AS daily_limit,
        (
            SELECT count(*)
            FROM questions AS question
            WHERE question.owner_user_id = assignment.user_id
                AND question.origin = 'account'
                AND question.status <> 'archived'
        ) AS owned_used,
        COALESCE(usage.used_count, 0) AS daily_used,
        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date::text AS usage_date
    FROM account_plan_assignments AS assignment
    JOIN subscription_plans AS plan ON plan.id = assignment.plan_id AND plan.status = 'active'
    LEFT JOIN subscription_feature_definitions AS owned_feature
        ON owned_feature.feature_key = '${OWNED_QUESTION_FEATURE}' AND owned_feature.status = 'active'
    LEFT JOIN subscription_plan_feature_limits AS owned
        ON owned.plan_id = plan.id AND owned.feature_definition_id = owned_feature.id AND owned.included
    LEFT JOIN subscription_feature_definitions AS daily_feature
        ON daily_feature.feature_key = '${DAILY_PRACTICE_FEATURE}' AND daily_feature.status = 'active'
    LEFT JOIN subscription_plan_feature_limits AS daily
        ON daily.plan_id = plan.id AND daily.feature_definition_id = daily_feature.id AND daily.included
    LEFT JOIN account_daily_feature_usage AS usage
        ON usage.user_id = assignment.user_id
        AND usage.feature_key = '${DAILY_PRACTICE_FEATURE}'
        AND usage.usage_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date
    WHERE assignment.user_id = $1::uuid
`;

export async function getAccountPlanUsage(userId: string): Promise<AccountPlanUsage> {
    const result = await queryLocalPostgres<PlanUsageRow>(USAGE_SQL, [userId]);
    const row = result.rows[0];
    if (!row) throw new Error("帳號沒有可用方案。");
    return mapUsage(row);
}

export async function getAccountPlanUsageInTransaction(
    client: PoolClient,
    userId: string,
): Promise<AccountPlanUsage> {
    const result = await client.query<PlanUsageRow>(USAGE_SQL, [userId]);
    const row = result.rows[0];
    if (!row) throw new Error("帳號沒有可用方案。");
    return mapUsage(row);
}

export async function consumeDailyPracticeQuestion(
    client: PoolClient,
    input: { userId: string; idempotencyKey: string; sessionItemId: string },
): Promise<AccountPlanUsage> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`plan-usage:${input.userId}`]);
    const replay = await client.query(`
        SELECT 1 FROM practice_quota_events
        WHERE user_id = $1::uuid AND idempotency_key = $2
    `, [input.userId, input.idempotencyKey]);
    if (replay.rows.length > 0) return getAccountPlanUsageInTransaction(client, input.userId);

    const usage = await getAccountPlanUsageInTransaction(client, input.userId);
    const limit = usage.dailyPractice.limit;
    if (limit !== null && usage.dailyPractice.used >= limit) {
        const error = new Error(`今日已完成 ${limit} 題，明天可繼續練習。`);
        Object.assign(error, { code: "DAILY_PRACTICE_LIMIT_REACHED", status: 429 });
        throw error;
    }

    await client.query(`
        INSERT INTO practice_quota_events (
            user_id, idempotency_key, usage_date, practice_session_item_id
        ) VALUES (
            $1::uuid, $2, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date, $3::uuid
        )
    `, [input.userId, input.idempotencyKey, input.sessionItemId]);
    await client.query(`
        INSERT INTO account_daily_feature_usage (user_id, usage_date, feature_key, used_count)
        VALUES ($1::uuid, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date, $2, 1)
        ON CONFLICT (user_id, usage_date, feature_key)
        DO UPDATE SET used_count = account_daily_feature_usage.used_count + 1,
            updated_at = transaction_timestamp()
    `, [input.userId, DAILY_PRACTICE_FEATURE]);
    return getAccountPlanUsageInTransaction(client, input.userId);
}
