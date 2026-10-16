import "server-only";

import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";

import {
    EmailVerificationError,
    type EmailVerificationConsumeResult,
    type EmailVerificationIssueResult,
    type EmailVerificationRepository,
} from "./email-verification";
import { withLocalPostgresTransaction } from "./local-postgres";

interface VerificationIdentityRow extends QueryResultRow {
    identity_id: string;
    display_name: string;
    email_normalized: string;
    verified_at: Date | string | null;
}

interface VerificationChallengeRow extends QueryResultRow {
    identity_id: string;
    user_id: string;
    expired: boolean;
    consumed_at: Date | string | null;
    verified_at: Date | string | null;
}

function asIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function issueChallenge(input: Readonly<{
    userId: string;
    tokenHash: string;
    expiresInMinutes: number;
    resendCooldownSeconds: number;
}>): Promise<EmailVerificationIssueResult> {
    return withLocalPostgresTransaction(async (client) => {
        await client.query("SELECT lerniqa_lock_auth_user($1::uuid)", [input.userId]);
        const identityResult = await client.query<VerificationIdentityRow>(`
            SELECT
                identity.id AS identity_id,
                app_user.display_name,
                identity.email_normalized,
                identity.verified_at
            FROM users AS app_user
            JOIN account_identities AS identity
                ON identity.user_id = app_user.id
                AND identity.provider = 'email'
                AND identity.revoked_at IS NULL
            WHERE app_user.id = $1
                AND app_user.status = 'active'
                AND (
                    SELECT count(*)
                    FROM account_identities AS active_identity
                    WHERE active_identity.user_id = app_user.id
                        AND active_identity.provider = 'email'
                        AND active_identity.revoked_at IS NULL
                ) = 1
            ORDER BY identity.created_at, identity.id
            LIMIT 1
            FOR UPDATE OF app_user, identity
        `, [input.userId]);
        const identity = identityResult.rows[0];
        if (!identity) {
            throw new EmailVerificationError(
                "EMAIL_VERIFICATION_FORBIDDEN",
                "目前帳號無法進行信箱驗證。",
                403,
            );
        }
        if (identity.verified_at !== null) return { status: "already_verified" };

        const recentResult = await client.query<{ recent: boolean }>(`
            SELECT EXISTS (
                SELECT 1
                FROM verification_challenges AS challenge
                WHERE challenge.user_id = $1
                    AND challenge.purpose = 'email_verify'
                    AND challenge.created_at
                        > transaction_timestamp() - ($2::integer * interval '1 second')
            ) AS recent
        `, [input.userId, input.resendCooldownSeconds]);
        if (recentResult.rows[0]?.recent) {
            throw new EmailVerificationError(
                "EMAIL_VERIFICATION_RATE_LIMITED",
                "驗證信剛剛已處理，請一分鐘後再試。",
                429,
            );
        }

        await client.query(`
            UPDATE verification_challenges
            SET consumed_at = transaction_timestamp()
            WHERE user_id = $1
                AND purpose = 'email_verify'
                AND consumed_at IS NULL
        `, [input.userId]);

        const challengeResult = await client.query<{ expires_at: Date | string }>(`
            INSERT INTO verification_challenges (
                id, user_id, purpose, target_role, token_hash, expires_at
            )
            VALUES (
                $1, $2, 'email_verify', NULL, $3,
                transaction_timestamp() + ($4::integer * interval '1 minute')
            )
            RETURNING expires_at
        `, [randomUUID(), input.userId, input.tokenHash, input.expiresInMinutes]);

        return {
            status: "issued",
            email: identity.email_normalized,
            displayName: identity.display_name,
            expiresAt: asIso(challengeResult.rows[0].expires_at),
        };
    });
}

async function consumeChallenge(tokenHash: string): Promise<EmailVerificationConsumeResult> {
    return withLocalPostgresTransaction(async (client) => {
        const ownerResult = await client.query<{ user_id: string }>(`
            SELECT user_id
            FROM verification_challenges
            WHERE token_hash = $1
                AND purpose = 'email_verify'
            LIMIT 1
        `, [tokenHash]);
        const userId = ownerResult.rows[0]?.user_id;
        if (!userId) return { status: "invalid", userId: null };

        await client.query("SELECT lerniqa_lock_auth_user($1::uuid)", [userId]);
        const challengeResult = await client.query<VerificationChallengeRow>(`
            SELECT
                identity.id AS identity_id,
                challenge.user_id,
                challenge.expires_at <= transaction_timestamp() AS expired,
                challenge.consumed_at,
                identity.verified_at
            FROM verification_challenges AS challenge
            JOIN users AS app_user
                ON app_user.id = challenge.user_id
                AND app_user.status = 'active'
            JOIN account_identities AS identity
                ON identity.user_id = challenge.user_id
                AND identity.provider = 'email'
                AND identity.revoked_at IS NULL
            WHERE challenge.token_hash = $1
                AND challenge.purpose = 'email_verify'
                AND (
                    SELECT count(*)
                    FROM account_identities AS active_identity
                    WHERE active_identity.user_id = challenge.user_id
                        AND active_identity.provider = 'email'
                        AND active_identity.revoked_at IS NULL
                ) = 1
            ORDER BY identity.created_at, identity.id
            LIMIT 1
            FOR UPDATE OF challenge, identity
        `, [tokenHash]);
        const challenge = challengeResult.rows[0];
        if (!challenge) return { status: "invalid", userId: null };

        if (challenge.consumed_at !== null) {
            return challenge.verified_at === null
                ? { status: "invalid", userId: null }
                : { status: "already_verified", userId: challenge.user_id };
        }
        if (challenge.expired) {
            await client.query(`
                UPDATE verification_challenges
                SET attempt_count = LEAST(attempt_count + 1, 32767)
                WHERE token_hash = $1
            `, [tokenHash]);
            return { status: "expired", userId: challenge.user_id };
        }

        await client.query(`
            UPDATE account_identities
            SET verified_at = COALESCE(verified_at, transaction_timestamp())
            WHERE id = $1
        `, [challenge.identity_id]);
        await client.query(`
            UPDATE verification_challenges
            SET
                consumed_at = transaction_timestamp(),
                attempt_count = LEAST(attempt_count + 1, 32767)
            WHERE user_id = $1
                AND purpose = 'email_verify'
                AND consumed_at IS NULL
        `, [challenge.user_id]);
        return { status: "verified", userId: challenge.user_id };
    });
}

export const localPostgresEmailVerificationRepository: EmailVerificationRepository = {
    issue: issueChallenge,
    consume: consumeChallenge,
};
