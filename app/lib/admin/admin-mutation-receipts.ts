import { randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";

import type { AdminQueryRunner } from "./admin-auth.ts";
import { AdminApiError } from "./admin-types.ts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const IDEMPOTENCY_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPERATION_PATTERN = /^[a-z][a-z0-9_:-]{0,79}$/u;

export interface AdminMutationReceiptRequest {
    actorUserId: string;
    /** Stable operation namespace, stored as `admin_mutation_receipts.operation`. */
    operation: string;
    key: string;
    payloadFingerprint: string;
    requestId: string;
}

export interface AdminMutationReceiptMetadata {
    targetType: string;
    targetId: string;
    auditLogId: string;
    responseStatus: number;
}

export interface AdminMutationReceiptCompletion<Result> {
    result: Result;
    receipt: AdminMutationReceiptMetadata;
}

export interface AdminMutationIdempotency {
    execute<Result>(
        runner: AdminQueryRunner,
        request: AdminMutationReceiptRequest,
        operation: () => Promise<AdminMutationReceiptCompletion<Result>>,
    ): Promise<Result>;
}

export interface AdminMutationReceiptIdGenerator {
    next(): string;
}

interface ReceiptRow extends QueryResultRow {
    id: string;
    operation: string;
    request_fingerprint: string;
    request_id: string;
    status: "pending" | "completed";
    replay_result: unknown;
}

interface ReturnedIdRow extends QueryResultRow {
    id: string;
}

const defaultIds: AdminMutationReceiptIdGenerator = { next: randomUUID };

function conflict(): AdminApiError {
    return new AdminApiError(
        "CONFLICT",
        "相同冪等鍵不可搭配不同的管理操作或內容。",
        409,
    );
}

function assertRequest(request: Readonly<AdminMutationReceiptRequest>): void {
    if (
        !UUID_PATTERN.test(request.actorUserId)
        || !IDEMPOTENCY_UUID_PATTERN.test(request.key)
        || !SHA256_PATTERN.test(request.payloadFingerprint)
        || !OPERATION_PATTERN.test(request.operation)
        || typeof request.requestId !== "string"
        || request.requestId.length < 1
        || request.requestId.length > 120
        || /[\u0000-\u001f\u007f]/u.test(request.requestId)
    ) {
        throw new AdminApiError(
            "INVALID_INPUT",
            "管理操作的冪等證據格式不正確。",
            422,
        );
    }
}

function assertCompletion<Result>(
    completion: AdminMutationReceiptCompletion<Result>,
): void {
    const { receipt } = completion;
    if (
        typeof completion.result !== "object"
        || completion.result === null
        || Array.isArray(completion.result)
        || typeof receipt.targetType !== "string"
        || receipt.targetType.length < 1
        || receipt.targetType.length > 60
        || !UUID_PATTERN.test(receipt.targetId)
        || !UUID_PATTERN.test(receipt.auditLogId)
        || !Number.isSafeInteger(receipt.responseStatus)
        || receipt.responseStatus < 200
        || receipt.responseStatus > 299
    ) {
        throw new AdminApiError(
            "INTERNAL_ERROR",
            "管理操作完成資料格式不正確。",
            500,
        );
    }
}

/**
 * PostgreSQL-backed replay protection shared by every admin mutation domain.
 *
 * The caller owns the surrounding transaction. No fallback store exists: a
 * receipt insert, business write, audit row and completion update either all
 * commit together or all roll back together.
 */
export class PostgresAdminMutationReceipts implements AdminMutationIdempotency {
    private readonly ids: AdminMutationReceiptIdGenerator;

    constructor(ids: AdminMutationReceiptIdGenerator = defaultIds) {
        this.ids = ids;
    }

    async execute<Result>(
        runner: AdminQueryRunner,
        request: AdminMutationReceiptRequest,
        operation: () => Promise<AdminMutationReceiptCompletion<Result>>,
    ): Promise<Result> {
        assertRequest(request);
        const receiptId = this.ids.next();
        if (!UUID_PATTERN.test(receiptId)) {
            throw new AdminApiError("INTERNAL_ERROR", "無法建立管理操作收據。", 500);
        }

        const inserted = await runner.query<ReturnedIdRow>(`
            INSERT INTO admin_mutation_receipts (
                id,
                actor_user_id,
                operation,
                idempotency_key,
                request_fingerprint,
                request_id,
                status,
                created_at
            )
            VALUES (
                $1::uuid,
                $2::uuid,
                $3::varchar,
                $4::uuid,
                $5::varchar,
                $6::varchar,
                'pending',
                transaction_timestamp()
            )
            ON CONFLICT (actor_user_id, operation, idempotency_key) DO NOTHING
            RETURNING id
        `, [
            receiptId,
            request.actorUserId,
            request.operation,
            request.key,
            request.payloadFingerprint,
            request.requestId,
        ]);

        if (!inserted.rows[0]?.id) {
            const existing = await runner.query<ReceiptRow>(`
                SELECT
                    id,
                    operation,
                    request_fingerprint,
                    request_id,
                    status,
                    replay_result
                FROM admin_mutation_receipts
                WHERE actor_user_id = $1::uuid
                    AND operation = $2::varchar
                    AND idempotency_key = $3::uuid
                FOR UPDATE
            `, [request.actorUserId, request.operation, request.key]);
            const row = existing.rows[0];
            if (!row) {
                throw new AdminApiError(
                    "CONFLICT",
                    "管理操作收據正由其他請求處理，請重新提交。",
                    409,
                );
            }
            if (
                row.operation !== request.operation
                || row.request_fingerprint !== request.payloadFingerprint
            ) {
                throw conflict();
            }
            if (
                row.status !== "completed"
                || typeof row.replay_result !== "object"
                || row.replay_result === null
                || Array.isArray(row.replay_result)
            ) {
                throw new AdminApiError(
                    "CONFLICT",
                    "管理操作仍在處理，請稍後重新整理。",
                    409,
                );
            }
            return row.replay_result as Result;
        }

        const completion = await operation();
        assertCompletion(completion);
        const completed = await runner.query<ReturnedIdRow>(`
            UPDATE admin_mutation_receipts
            SET
                status = 'completed',
                target_type = $2::varchar,
                target_id = $3::uuid,
                admin_audit_log_id = $4::uuid,
                replay_result = $5::jsonb,
                completed_at = transaction_timestamp()
            WHERE id = $1::uuid
                AND status = 'pending'
            RETURNING id
        `, [
            receiptId,
            completion.receipt.targetType,
            completion.receipt.targetId,
            completion.receipt.auditLogId,
            JSON.stringify(completion.result),
        ]);
        if (!completed.rows[0]?.id) {
            throw new AdminApiError(
                "CONFLICT",
                "管理操作收據未完成，請重新提交。",
                409,
            );
        }
        return completion.result;
    }
}

export const adminMutationReceipts = new PostgresAdminMutationReceipts();
