import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import type { ImportQuestionDraft } from "./question-import-contract.ts";
import { QuestionImportStoreError, replaceQuestionDraftItemsBySource } from "./question-import-persistence.ts";
import type { QuestionSourceRole, QuestionSourceRoleSource } from "./question-source-role.ts";

type QueryClient = Pick<PoolClient, "query">;

export interface QuestionSourceProcessingTarget {
    batchId: string;
    documents: QuestionSourceProcessingDocument[];
    sourceTitle: string;
}

export interface QuestionSourceProcessingDocument {
    assetId: string;
    byteSize: number;
    checksum: string;
    fileName: string;
    mimeType: string;
    position: number;
    role: QuestionSourceRole;
    roleConfidence: number | null;
    roleReason: string | null;
    roleSource: QuestionSourceRoleSource;
    sourceDocumentId: string;
    storageKey: string;
}

export interface ProcessedPageAsset {
    byteSize: number;
    checksum: string;
    height: number;
    id: string;
    mimeType: "image/png";
    mode: "bw" | "color" | "gray" | "handwriting-mask" | "handwriting-removed";
    sourceDocumentId: string;
    page: number;
    storageKey: string;
    width: number;
}

export interface ProcessedQuestionAsset {
    byteSize: number;
    checksum: string;
    height: number;
    id: string;
    mimeType: "image/png";
    storageKey: string;
    width: number;
}

export interface ProcessedPageDraft {
    cornerConfidence: number;
    corners: Array<{ x: number; y: number }>;
    dewarped: boolean;
    documentPosition: number;
    fileName: string;
    ocr: Array<{
        bounds: { height: number; left: number; top: number; width: number };
        confidence: number;
        text: string;
    }>;
    ocrText: string;
    page: number;
    role: Exclude<QuestionSourceRole, "auto">;
    sourceDocumentId: string;
    source: { height: number; width: number };
    warnings: string[];
}

interface ProcessingRow extends QueryResultRow {
    asset_id: string;
    batch_id: string;
    byte_size: string;
    checksum: string;
    mime_type: string;
    original_file_name: string;
    position: number;
    role_confidence: string | number | null;
    role_reason: string | null;
    role_source: QuestionSourceRoleSource;
    source_title: string;
    source_document_id: string;
    status: string;
    storage_key: string;
    document_role: QuestionSourceRole;
}

export async function beginQuestionSourceProcessing(
    client: QueryClient,
    batchId: string,
    userId: string,
): Promise<QuestionSourceProcessingTarget> {
    const result = await client.query<ProcessingRow>(`
        SELECT batch.id AS batch_id,
               batch.status,
               document.id AS source_document_id,
               asset.id AS asset_id,
               asset.storage_key,
               asset.mime_type,
               asset.byte_size,
               asset.checksum,
               document.document_title AS source_title,
               document.original_file_name,
               link.position,
               link.document_role,
               link.role_source,
               link.role_confidence,
               link.role_reason
        FROM import_batches AS batch
        JOIN import_batch_documents AS link
          ON link.import_batch_id = batch.id
        JOIN source_documents AS document ON document.id = link.source_document_id
        JOIN assets AS asset ON asset.id = document.asset_id
        WHERE batch.id = $1
          AND batch.created_by_user_id = $2
          AND asset.created_by_user_id = $2
          AND asset.deleted_at IS NULL
          AND asset.purpose = 'source_document'
        ORDER BY link.position
        FOR UPDATE OF batch, document, asset, link
    `, [batchId, userId]);
    const first = result.rows[0];
    if (!first) throw new QuestionImportStoreError("IMPORT_SOURCE_BATCH_NOT_FOUND", "找不到這次掃描匯入。", 404);
    if (first.status === "confirmed" || first.status === "cancelled") {
        throw new QuestionImportStoreError("IMPORT_SOURCE_BATCH_CLOSED", "這次掃描已結束，不能重新處理。", 409);
    }
    if (first.status === "recognizing") {
        throw new QuestionImportStoreError("IMPORT_SOURCE_BATCH_BUSY", "這次掃描正在處理。", 409);
    }
    await client.query("UPDATE import_batches SET status = 'recognizing' WHERE id = $1", [batchId]);
    await client.query("UPDATE source_documents SET status = 'processing' WHERE id = ANY($1::uuid[])", [result.rows.map((row) => row.source_document_id)]);
    return {
        batchId: first.batch_id,
        documents: result.rows.map((row) => ({
            assetId: row.asset_id,
            byteSize: Number(row.byte_size),
            checksum: row.checksum,
            fileName: row.original_file_name ?? row.source_title,
            mimeType: row.mime_type,
            position: row.position,
            role: row.document_role,
            roleConfidence: row.role_confidence === null ? null : Number(row.role_confidence),
            roleReason: row.role_reason,
            roleSource: row.role_source,
            sourceDocumentId: row.source_document_id,
            storageKey: row.storage_key,
        })),
        sourceTitle: result.rows.length === 1 ? first.source_title : `${first.source_title} 等 ${result.rows.length} 個檔案`,
    };
}

export async function completeQuestionSourceProcessing(
    client: QueryClient,
    target: QuestionSourceProcessingTarget,
    processorVersion: string,
    pages: ProcessedPageDraft[],
    assets: ProcessedPageAsset[],
    questionAssets: ProcessedQuestionAsset[],
    questions: Array<{ question: ImportQuestionDraft; sourceDocumentId: string }>,
    userId: string,
): Promise<void> {
    for (const asset of [...assets, ...questionAssets]) {
        const inserted = await client.query(`
            INSERT INTO assets(
                id, storage_key, mime_type, byte_size, width, height, checksum,
                purpose, sensitivity, scan_status, created_by_user_id
            ) VALUES($1,$2,$3,$4,$5,$6,$7,'page_crop','private','clean',$8)
            ON CONFLICT(id) DO NOTHING
            RETURNING id
        `, [asset.id, asset.storageKey, asset.mimeType, asset.byteSize, asset.width, asset.height, asset.checksum, userId]);
        if (!inserted.rowCount) {
            const existing = await client.query(`
                SELECT 1 FROM assets
                WHERE id = $1 AND storage_key = $2 AND checksum = $3
                  AND created_by_user_id = $4 AND purpose = 'page_crop'
                  AND scan_status = 'clean' AND deleted_at IS NULL
            `, [asset.id, asset.storageKey, asset.checksum, userId]);
            if (!existing.rowCount) {
                throw new QuestionImportStoreError("IMPORT_ASSET_CONFLICT", "掃描結果的資產識別碼發生衝突。", 409);
            }
        }
    }
    if (questions.length) {
        await replaceQuestionDraftItemsBySource(client, target.batchId, questions);
    }
    else {
        await client.query("DELETE FROM import_items WHERE import_batch_id = $1 AND review_status = 'pending'", [target.batchId]);
    }
    if (!questions.length) {
        for (const [position, page] of pages.entries()) {
            const pageAssets = Object.fromEntries(assets
                .filter((asset) => asset.sourceDocumentId === page.sourceDocumentId && asset.page === page.page)
                .map((asset) => [asset.mode, asset.id]));
            await client.query(`
                INSERT INTO import_items(
                    id, import_batch_id, source_document_id, source_page, source_order,
                    draft_payload, recognition_confidence, review_status
                ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,'pending')
            `, [
                randomUUID(),
                target.batchId,
                    page.sourceDocumentId,
                page.page,
                position,
                JSON.stringify({ schemaVersion: 1, processorVersion, page, assets: pageAssets }),
                page.ocr.length ? page.ocr.reduce((sum, line) => sum + line.confidence, 0) / page.ocr.length : null,
            ]);
        }
    }
    await client.query("UPDATE assets SET scan_status = 'clean' WHERE id = ANY($1::uuid[])", [target.documents.map((document) => document.assetId)]);
    await client.query("UPDATE source_documents SET status = 'ready' WHERE id = ANY($1::uuid[])", [target.documents.map((document) => document.sourceDocumentId)]);
    await client.query("UPDATE import_batches SET status = 'review', recognizer_version = $2 WHERE id = $1", [target.batchId, processorVersion]);
}

export async function applyQuestionSourceRoleAnalysis(
    client: QueryClient,
    batchId: string,
    roles: Array<{
        confidence: number;
        reason: string;
        role: Exclude<QuestionSourceRole, "auto">;
        sourceDocumentId: string;
    }>,
): Promise<void> {
    for (const source of roles) {
        const result = await client.query(`
            UPDATE import_batch_documents
            SET document_role = $3,
                role_source = 'ai',
                role_confidence = $4,
                role_reason = $5
            WHERE import_batch_id = $1
              AND source_document_id = $2
              AND document_role = 'auto'
              AND role_source = 'pending'
        `, [batchId, source.sourceDocumentId, source.role, source.confidence, source.reason]);
        if (result.rowCount !== 1) {
            throw new QuestionImportStoreError("IMPORT_SOURCE_ROLE_CHANGED", "來源圖片用途在分析期間已變更，請重新執行分析。", 409);
        }
    }
}

export async function findQuestionImportAsset(
    client: QueryClient,
    assetId: string,
    userId: string,
): Promise<{ byteSize: number; checksum: string; mimeType: string; storageKey: string } | null> {
    const result = await client.query<{
        byte_size: string;
        checksum: string;
        mime_type: string;
        storage_key: string;
    } & QueryResultRow>(`
        SELECT byte_size, checksum, mime_type, storage_key
        FROM assets
        WHERE id = $1
          AND created_by_user_id = $2
          AND purpose IN ('source_document', 'page_crop', 'question_content')
          AND scan_status = 'clean'
          AND deleted_at IS NULL
    `, [assetId, userId]);
    const asset = result.rows[0];
    return asset ? { byteSize: Number(asset.byte_size), checksum: asset.checksum, mimeType: asset.mime_type, storageKey: asset.storage_key } : null;
}
