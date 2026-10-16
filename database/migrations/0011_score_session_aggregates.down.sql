BEGIN;

DROP TRIGGER assets_pending_object_cleanup_immutable ON assets;
DROP FUNCTION lerniqa_protect_asset_pending_object_cleanup();
DROP TRIGGER asset_object_cleanup_jobs_history_check
    ON asset_object_cleanup_jobs;
DROP FUNCTION lerniqa_validate_asset_object_cleanup_job();
DROP TABLE asset_object_cleanup_jobs;

-- A schema rollback cannot complete an external object deletion. Remove only
-- the migration-generated audit rows so 0010's exact schema/data rollback
-- guard remains usable; the asset itself stays disabled via deleted_at. Never
-- use this DDL down as the operational rollback for a database with pending
-- object jobs--drain and audit those jobs before changing the schema instead.
DROP TRIGGER admin_audit_logs_append_only ON admin_audit_logs;
DELETE FROM admin_audit_logs
WHERE action = 'asset_object_cleanup_queued'
    AND target_type = 'asset'
    AND after_data ->> 'reason' = 'legacy_score_detail_purge';
CREATE TRIGGER admin_audit_logs_append_only
BEFORE UPDATE OR DELETE ON admin_audit_logs
FOR EACH ROW
EXECUTE FUNCTION lerniqa_reject_append_only_mutation();

DROP TRIGGER practice_session_items_score_receipt_immutable
    ON practice_session_items;
DROP TRIGGER practice_sessions_score_receipt_immutable
    ON practice_sessions;
DROP FUNCTION lerniqa_protect_score_receipt_provenance();

DROP TRIGGER practice_score_receipts_aggregate_consistency
    ON practice_score_receipts;
DROP TRIGGER practice_session_items_score_aggregate_consistency
    ON practice_session_items;
DROP TRIGGER practice_sessions_score_aggregate_consistency
    ON practice_sessions;
DROP FUNCTION lerniqa_validate_score_session_aggregate();
DROP FUNCTION lerniqa_assert_score_session_aggregate(uuid);

ALTER TABLE practice_sessions
DROP CONSTRAINT practice_sessions_score_aggregate_check;

DROP TRIGGER practice_score_receipts_append_only
    ON practice_score_receipts;
DROP FUNCTION lerniqa_reject_score_receipt_mutation();
DROP TRIGGER analytics_outbox_score_receipt_check ON analytics_outbox;
DROP FUNCTION lerniqa_reject_score_receipt_outbox();
DROP TRIGGER answer_attempts_score_detail_check ON answer_attempts;
DROP FUNCTION lerniqa_reject_score_answer_detail();
DROP TRIGGER practice_score_receipts_provenance_check
    ON practice_score_receipts;
DROP FUNCTION lerniqa_validate_score_receipt();
DROP TABLE practice_score_receipts;

ALTER TABLE practice_sessions
DROP COLUMN score_pending_count,
DROP COLUMN score_wrong_count,
DROP COLUMN score_correct_count,
DROP COLUMN score_answered_count,
DROP COLUMN score_total_count;

-- Legacy score answer detail removed by the forward privacy migration cannot
-- be recreated on rollback. Likewise, an asset disabled by 0011 stays
-- logically deleted. This is a schema rollback for isolated verification, not
-- a data-restoration or external-object rollback.
DELETE FROM schema_migrations WHERE version = '0011';

COMMIT;
