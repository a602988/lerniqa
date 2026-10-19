BEGIN;

DROP TRIGGER question_revision_source_evidence_integrity_check
    ON question_revision_source_evidence;
DROP FUNCTION lerniqa_validate_question_source_evidence();

DROP TRIGGER source_document_blocks_integrity_check
    ON source_document_blocks;
DROP FUNCTION lerniqa_validate_source_document_block();

DROP TRIGGER source_document_pages_integrity_check
    ON source_document_pages;
DROP FUNCTION lerniqa_validate_source_document_page();

DROP TRIGGER source_processing_runs_integrity_check
    ON source_document_processing_runs;
DROP FUNCTION lerniqa_validate_source_processing_run();

DROP TRIGGER source_catalog_profiles_integrity_check
    ON source_document_catalog_profiles;
DROP FUNCTION lerniqa_validate_source_catalog_profile();

DROP TABLE question_revision_source_evidence;
DROP TABLE source_document_blocks;
DROP TABLE source_document_pages;
DROP TABLE source_document_processing_runs;
DROP TABLE source_document_catalog_profiles;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM assets
        WHERE purpose = 'source_page'
    ) THEN
        RAISE EXCEPTION '回滾 0020 前必須先處理 source_page assets';
    END IF;
END;
$$;

ALTER TABLE assets
    DROP CONSTRAINT assets_purpose_check,
    DROP CONSTRAINT assets_private_purpose_check,
    ADD CONSTRAINT assets_purpose_check
        CHECK (
            purpose IN (
                'question_content',
                'source_document',
                'handwriting',
                'answer_attachment',
                'learner_avatar',
                'page_crop'
            )
        ),
    ADD CONSTRAINT assets_private_purpose_check
        CHECK (
            purpose NOT IN ('handwriting', 'answer_attachment', 'learner_avatar')
            OR sensitivity = 'private'
        );

DELETE FROM schema_migrations WHERE version = '0020';

COMMIT;
