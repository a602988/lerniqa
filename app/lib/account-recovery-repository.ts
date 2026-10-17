import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

import {
    AccountRecoveryError,
    type AccountRecoveryRepository,
    type RecoveryConsumeResult,
    type RecoveryIssueResult,
    type RecoveryPreflightResult,
} from "./account-recovery";
import { verifyRolePin } from "./auth-crypto";
import type { RolePinTargetRole } from "./auth-input";
import { queryLocalPostgres, withLocalPostgresTransaction } from "./local-postgres";

interface RecoveryIdentityRow extends QueryResultRow {
    user_id: string;
    identity_id: string;
    display_name: string;
    email_normalized: string;
}

interface ChallengeOwnerRow extends QueryResultRow {
    user_id: string;
    account_identity_id: string;
    target_role: RolePinTargetRole | null;
}

interface LockedChallengeRow extends QueryResultRow {
    user_id: string;
    identity_id: string;
    target_role: RolePinTargetRole | null;
    expired: boolean;
    consumed_at: Date | string | null;
}

interface RateLimitRow extends QueryResultRow {
    recent: boolean;
    hourly_count: number;
}

interface PreflightChallengeRow extends QueryResultRow {
    affected_user_id: string;
    affected_identity_id: string;
    target_role: RolePinTargetRole | null;
    expired: boolean;
    consumed_at: Date | string | null;
}

function asIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function preflightResult(
    row: PreflightChallengeRow | undefined,
): RecoveryPreflightResult {
    if (!row || row.consumed_at !== null) return { status: "invalid" };
    if (row.expired) return { status: "expired" };
    return {
        status: "valid",
        affectedUserId: row.affected_user_id,
        affectedIdentityId: row.affected_identity_id,
        ...(row.target_role ? { targetRole: row.target_role } : {}),
    };
}

async function preflightPasswordReset(input: Readonly<{
    tokenHash: string;
}>): Promise<RecoveryPreflightResult> {
    const result = await queryLocalPostgres<PreflightChallengeRow>(`
        SELECT
            challenge.user_id AS affected_user_id,
            challenge.account_identity_id AS affected_identity_id,
            challenge.target_role,
            challenge.expires_at <= transaction_timestamp() AS expired,
            challenge.consumed_at
        FROM verification_challenges AS challenge
        JOIN users AS app_user
            ON app_user.id = challenge.user_id
            AND app_user.status = 'active'
        JOIN account_identities AS identity
            ON identity.id = challenge.account_identity_id
            AND identity.user_id = challenge.user_id
            AND identity.provider = 'email'
            AND identity.revoked_at IS NULL
        WHERE challenge.token_hash = $1
            AND challenge.purpose = 'password_reset'
            AND (
                SELECT count(*)
                FROM account_identities AS active_identity
                WHERE active_identity.user_id = challenge.user_id
                    AND active_identity.provider = 'email'
                    AND active_identity.revoked_at IS NULL
            ) = 1
        ORDER BY identity.created_at, identity.id
        LIMIT 1
    `, [input.tokenHash]);
    return preflightResult(result.rows[0]);
}

async function preflightRolePinReset(input: Readonly<{
    tokenHash: string;
}>): Promise<RecoveryPreflightResult> {
    const result = await queryLocalPostgres<PreflightChallengeRow>(`
        SELECT
            challenge.user_id AS affected_user_id,
            challenge.account_identity_id AS affected_identity_id,
            challenge.target_role,
            challenge.expires_at <= transaction_timestamp() AS expired,
            challenge.consumed_at
        FROM verification_challenges AS challenge
        JOIN users AS app_user
            ON app_user.id = challenge.user_id
            AND app_user.status = 'active'
        JOIN account_identities AS identity
            ON identity.id = challenge.account_identity_id
            AND identity.user_id = challenge.user_id
            AND identity.provider = 'email'
            AND identity.revoked_at IS NULL
            AND identity.verified_at IS NOT NULL
        WHERE challenge.token_hash = $1
            AND challenge.purpose = 'role_pin_reset'
            AND challenge.target_role IN ('parent', 'tutor')
            AND EXISTS (
                SELECT 1
                FROM user_roles AS role
                WHERE role.user_id = challenge.user_id
                    AND role.role = challenge.target_role
                    AND role.revoked_at IS NULL
            )
            AND (
                SELECT count(*)
                FROM account_identities AS active_identity
                WHERE active_identity.user_id = challenge.user_id
                    AND active_identity.provider = 'email'
                    AND active_identity.revoked_at IS NULL
            ) = 1
        ORDER BY identity.created_at, identity.id
        LIMIT 1
    `, [input.tokenHash]);
    return preflightResult(result.rows[0]);
}

async function recoveryRateLimit(
    client: PoolClient,
    input: Readonly<{
        userId: string;
        purpose: "password_reset" | "role_pin_reset";
        targetRole: RolePinTargetRole | null;
        resendCooldownSeconds: number;
    }>,
): Promise<RateLimitRow> {
    const result = await client.query<RateLimitRow>(`
        SELECT
            COALESCE(bool_or(
                challenge.created_at
                    > transaction_timestamp() - ($4::integer * interval '1 second')
            ), false) AS recent,
            count(*)::integer AS hourly_count
        FROM verification_challenges AS challenge
        WHERE challenge.user_id = $1
            AND challenge.purpose = $2
            AND challenge.target_role IS NOT DISTINCT FROM $3::varchar(30)
            AND challenge.created_at > transaction_timestamp() - interval '1 hour'
    `, [
        input.userId,
        input.purpose,
        input.targetRole,
        input.resendCooldownSeconds,
    ]);
    return result.rows[0] ?? { recent: false, hourly_count: 0 };
}

async function issuePasswordReset(input: Readonly<{
    email: string;
    tokenHash: string;
    expiresInMinutes: number;
    resendCooldownSeconds: number;
    maxRequestsPerHour: number;
}>): Promise<RecoveryIssueResult> {
    return withLocalPostgresTransaction(async (client) => {
        const ownerResult = await client.query<{ user_id: string }>(`
            SELECT identity.user_id
            FROM account_identities AS identity
            JOIN users AS app_user
                ON app_user.id = identity.user_id
                AND app_user.status = 'active'
            WHERE identity.provider = 'email'
                AND identity.email_normalized = $1
                AND identity.revoked_at IS NULL
            LIMIT 2
        `, [input.email]);
        if (ownerResult.rows.length !== 1) return { status: "suppressed" };

        const userId = ownerResult.rows[0].user_id;
        await client.query("SELECT lerniqa_lock_auth_user($1::uuid)", [userId]);
        const identityResult = await client.query<RecoveryIdentityRow>(`
            SELECT
                app_user.id AS user_id,
                identity.id AS identity_id,
                app_user.display_name,
                identity.email_normalized
            FROM users AS app_user
            JOIN account_identities AS identity
                ON identity.user_id = app_user.id
                AND identity.provider = 'email'
                AND identity.email_normalized = $2
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
        `, [userId, input.email]);
        const identity = identityResult.rows[0];
        if (!identity) return { status: "suppressed" };

        const rate = await recoveryRateLimit(client, {
            userId: identity.user_id,
            purpose: "password_reset",
            targetRole: null,
            resendCooldownSeconds: input.resendCooldownSeconds,
        });
        if (rate.recent || rate.hourly_count >= input.maxRequestsPerHour) {
            return { status: "suppressed" };
        }

        await client.query(`
            UPDATE verification_challenges
            SET consumed_at = transaction_timestamp()
            WHERE user_id = $1
                AND purpose = 'password_reset'
                AND consumed_at IS NULL
        `, [identity.user_id]);
        const inserted = await client.query<{ expires_at: Date | string }>(`
            INSERT INTO verification_challenges (
                id, user_id, account_identity_id, purpose, target_role, token_hash, expires_at
            )
            VALUES (
                $1, $2, $3, 'password_reset', NULL, $4,
                transaction_timestamp() + ($5::integer * interval '1 minute')
            )
            RETURNING expires_at
        `, [
            randomUUID(),
            identity.user_id,
            identity.identity_id,
            input.tokenHash,
            input.expiresInMinutes,
        ]);
        return {
            status: "issued",
            identityId: identity.identity_id,
            email: identity.email_normalized,
            displayName: identity.display_name,
            expiresAt: asIso(inserted.rows[0].expires_at),
        };
    });
}

async function issueRolePinReset(input: Readonly<{
    userId: string;
    targetRole: RolePinTargetRole;
    tokenHash: string;
    expiresInMinutes: number;
    resendCooldownSeconds: number;
    maxRequestsPerHour: number;
}>): Promise<RecoveryIssueResult> {
    return withLocalPostgresTransaction(async (client) => {
        await client.query("SELECT lerniqa_lock_auth_user($1::uuid)", [input.userId]);
        const identityResult = await client.query<RecoveryIdentityRow>(`
            SELECT
                app_user.id AS user_id,
                identity.id AS identity_id,
                app_user.display_name,
                identity.email_normalized
            FROM users AS app_user
            JOIN account_identities AS identity
                ON identity.user_id = app_user.id
                AND identity.provider = 'email'
                AND identity.revoked_at IS NULL
                AND identity.verified_at IS NOT NULL
            WHERE app_user.id = $1
                AND app_user.status = 'active'
                AND EXISTS (
                    SELECT 1
                    FROM user_roles AS role
                    WHERE role.user_id = app_user.id
                        AND role.role = $2
                        AND role.revoked_at IS NULL
                )
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
        `, [input.userId, input.targetRole]);
        const identity = identityResult.rows[0];
        if (!identity) return { status: "suppressed" };

        const rate = await recoveryRateLimit(client, {
            userId: identity.user_id,
            purpose: "role_pin_reset",
            targetRole: input.targetRole,
            resendCooldownSeconds: input.resendCooldownSeconds,
        });
        if (rate.recent || rate.hourly_count >= input.maxRequestsPerHour) {
            return { status: "suppressed" };
        }

        await client.query(`
            UPDATE verification_challenges
            SET consumed_at = transaction_timestamp()
            WHERE user_id = $1
                AND purpose = 'role_pin_reset'
                AND target_role = $2
                AND consumed_at IS NULL
        `, [identity.user_id, input.targetRole]);
        const inserted = await client.query<{ expires_at: Date | string }>(`
            INSERT INTO verification_challenges (
                id, user_id, account_identity_id, purpose, target_role, token_hash, expires_at
            )
            VALUES (
                $1, $2, $3, 'role_pin_reset', $4, $5,
                transaction_timestamp() + ($6::integer * interval '1 minute')
            )
            RETURNING expires_at
        `, [
            randomUUID(),
            identity.user_id,
            identity.identity_id,
            input.targetRole,
            input.tokenHash,
            input.expiresInMinutes,
        ]);
        return {
            status: "issued",
            identityId: identity.identity_id,
            email: identity.email_normalized,
            displayName: identity.display_name,
            expiresAt: asIso(inserted.rows[0].expires_at),
        };
    });
}

async function consumePasswordReset(input: Readonly<{
    tokenHash: string;
    expectedUserId: string;
    expectedIdentityId: string;
    passwordHash: string;
}>): Promise<RecoveryConsumeResult> {
    return withLocalPostgresTransaction(async (client) => {
        const ownerResult = await client.query<ChallengeOwnerRow>(`
            SELECT user_id, account_identity_id, target_role
            FROM verification_challenges
            WHERE token_hash = $1
                AND user_id = $2
                AND account_identity_id = $3
                AND purpose = 'password_reset'
            LIMIT 1
        `, [input.tokenHash, input.expectedUserId, input.expectedIdentityId]);
        const owner = ownerResult.rows[0];
        if (!owner) return { status: "invalid" };

        await client.query("SELECT lerniqa_lock_auth_user($1::uuid)", [owner.user_id]);
        const challengeResult = await client.query<LockedChallengeRow>(`
            SELECT
                challenge.user_id,
                identity.id AS identity_id,
                challenge.target_role,
                challenge.expires_at <= transaction_timestamp() AS expired,
                challenge.consumed_at
            FROM verification_challenges AS challenge
            JOIN users AS app_user
                ON app_user.id = challenge.user_id
                AND app_user.status = 'active'
            JOIN account_identities AS identity
                ON identity.id = challenge.account_identity_id
                AND identity.user_id = challenge.user_id
                AND identity.provider = 'email'
                AND identity.revoked_at IS NULL
            WHERE challenge.token_hash = $1
                AND challenge.user_id = $2
                AND challenge.account_identity_id = $3
                AND challenge.purpose = 'password_reset'
                AND (
                    SELECT count(*)
                    FROM account_identities AS active_identity
                    WHERE active_identity.user_id = challenge.user_id
                        AND active_identity.provider = 'email'
                        AND active_identity.revoked_at IS NULL
                ) = 1
            ORDER BY identity.created_at, identity.id
            LIMIT 1
            FOR UPDATE OF challenge, app_user, identity
        `, [input.tokenHash, input.expectedUserId, input.expectedIdentityId]);
        const challenge = challengeResult.rows[0];
        if (!challenge || challenge.consumed_at !== null) return { status: "invalid" };
        if (challenge.expired) {
            await client.query(`
                UPDATE verification_challenges
                SET attempt_count = LEAST(attempt_count + 1, 32767)
                WHERE token_hash = $1
            `, [input.tokenHash]);
            return { status: "expired" };
        }

        await client.query(`
            UPDATE account_identities
            SET password_hash = $1
            WHERE id = $2
        `, [input.passwordHash, challenge.identity_id]);
        await client.query(`
            UPDATE users
            SET updated_at = transaction_timestamp()
            WHERE id = $1
        `, [challenge.user_id]);
        await client.query(`
            UPDATE verification_challenges
            SET
                consumed_at = transaction_timestamp(),
                attempt_count = LEAST(
                    attempt_count + CASE WHEN token_hash = $2 THEN 1 ELSE 0 END,
                    32767
                )
            WHERE user_id = $1
                AND purpose = 'password_reset'
                AND consumed_at IS NULL
        `, [challenge.user_id, input.tokenHash]);
        await client.query(`
            UPDATE auth_sessions
            SET revoked_at = COALESCE(revoked_at, transaction_timestamp())
            WHERE user_id = $1
                AND revoked_at IS NULL
        `, [challenge.user_id]);
        return {
            status: "completed",
            affectedUserId: challenge.user_id,
        };
    });
}

async function consumeRolePinReset(input: Readonly<{
    tokenHash: string;
    expectedUserId: string;
    expectedIdentityId: string;
    expectedTargetRole: RolePinTargetRole;
    newPin: string;
    pinHash: string;
}>): Promise<RecoveryConsumeResult> {
    return withLocalPostgresTransaction(async (client) => {
        const ownerResult = await client.query<ChallengeOwnerRow>(`
            SELECT user_id, account_identity_id, target_role
            FROM verification_challenges
            WHERE token_hash = $1
                AND user_id = $2
                AND account_identity_id = $3
                AND target_role = $4
                AND purpose = 'role_pin_reset'
            LIMIT 1
        `, [
            input.tokenHash,
            input.expectedUserId,
            input.expectedIdentityId,
            input.expectedTargetRole,
        ]);
        const owner = ownerResult.rows[0];
        if (!owner?.target_role) return { status: "invalid" };

        await client.query("SELECT lerniqa_lock_auth_user($1::uuid)", [owner.user_id]);
        const challengeResult = await client.query<LockedChallengeRow>(`
            SELECT
                challenge.user_id,
                identity.id AS identity_id,
                challenge.target_role,
                challenge.expires_at <= transaction_timestamp() AS expired,
                challenge.consumed_at
            FROM verification_challenges AS challenge
            JOIN users AS app_user
                ON app_user.id = challenge.user_id
                AND app_user.status = 'active'
            JOIN account_identities AS identity
                ON identity.id = challenge.account_identity_id
                AND identity.user_id = challenge.user_id
                AND identity.provider = 'email'
                AND identity.revoked_at IS NULL
                AND identity.verified_at IS NOT NULL
            WHERE challenge.token_hash = $1
                AND challenge.user_id = $2
                AND challenge.account_identity_id = $3
                AND challenge.target_role = $4
                AND challenge.purpose = 'role_pin_reset'
                AND challenge.target_role IN ('parent', 'tutor')
                AND EXISTS (
                    SELECT 1
                    FROM user_roles AS role
                    WHERE role.user_id = challenge.user_id
                        AND role.role = challenge.target_role
                        AND role.revoked_at IS NULL
                )
                AND (
                    SELECT count(*)
                    FROM account_identities AS active_identity
                    WHERE active_identity.user_id = challenge.user_id
                        AND active_identity.provider = 'email'
                        AND active_identity.revoked_at IS NULL
                ) = 1
            ORDER BY identity.created_at, identity.id
            LIMIT 1
            FOR UPDATE OF challenge, app_user, identity
        `, [
            input.tokenHash,
            input.expectedUserId,
            input.expectedIdentityId,
            input.expectedTargetRole,
        ]);
        const challenge = challengeResult.rows[0];
        if (
            !challenge
            || challenge.consumed_at !== null
            || (challenge.target_role !== "parent" && challenge.target_role !== "tutor")
        ) return { status: "invalid" };
        if (challenge.expired) {
            await client.query(`
                UPDATE verification_challenges
                SET attempt_count = LEAST(attempt_count + 1, 32767)
                WHERE token_hash = $1
            `, [input.tokenHash]);
            return { status: "expired" };
        }

        const credentialResult = await client.query<{ pin_hash: string }>(`
            SELECT pin_hash
            FROM role_pin_credentials
            WHERE user_id = $1
                AND role = $2
            LIMIT 1
            FOR UPDATE
        `, [challenge.user_id, challenge.target_role]);
        const currentHash = credentialResult.rows[0]?.pin_hash;
        if (currentHash && await verifyRolePin(input.newPin, currentHash)) {
            throw new AccountRecoveryError(
                "ROLE_PIN_UNCHANGED",
                "新的角色 PIN 不可與目前的 PIN 相同。",
                409,
            );
        }

        await client.query(`
            INSERT INTO role_pin_credentials (
                id, user_id, role, pin_hash, failed_attempts, locked_until, updated_at
            )
            VALUES ($1, $2, $3, $4, 0, NULL, transaction_timestamp())
            ON CONFLICT (user_id, role)
            DO UPDATE SET
                pin_hash = EXCLUDED.pin_hash,
                failed_attempts = 0,
                locked_until = NULL,
                updated_at = transaction_timestamp()
        `, [randomUUID(), challenge.user_id, challenge.target_role, input.pinHash]);
        await client.query(`
            UPDATE verification_challenges
            SET
                consumed_at = transaction_timestamp(),
                attempt_count = LEAST(
                    attempt_count + CASE WHEN token_hash = $3 THEN 1 ELSE 0 END,
                    32767
                )
            WHERE user_id = $1
                AND purpose = 'role_pin_reset'
                AND target_role = $2
                AND consumed_at IS NULL
        `, [challenge.user_id, challenge.target_role, input.tokenHash]);
        await client.query(`
            UPDATE auth_sessions
            SET revoked_at = COALESCE(revoked_at, transaction_timestamp())
            WHERE user_id = $1
                AND active_role = $2
                AND revoked_at IS NULL
        `, [challenge.user_id, challenge.target_role]);
        return {
            status: "completed",
            affectedUserId: challenge.user_id,
            targetRole: challenge.target_role,
        };
    });
}

async function cancelChallenge(input: Readonly<{
    tokenHash: string;
    purpose: "password_reset" | "role_pin_reset";
}>): Promise<void> {
    await withLocalPostgresTransaction(async (client) => {
        await client.query(`
            UPDATE verification_challenges
            SET consumed_at = COALESCE(consumed_at, transaction_timestamp())
            WHERE token_hash = $1
                AND purpose = $2
        `, [input.tokenHash, input.purpose]);
    });
}

export const localPostgresAccountRecoveryRepository: AccountRecoveryRepository = {
    preflightPasswordReset,
    issuePasswordReset,
    consumePasswordReset,
    preflightRolePinReset,
    issueRolePinReset,
    consumeRolePinReset,
    cancel: cancelChallenge,
};
