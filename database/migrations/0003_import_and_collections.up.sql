BEGIN;

CREATE TABLE source_documents (
    id uuid PRIMARY KEY,
    owner_user_id uuid REFERENCES users(id),
    asset_id uuid REFERENCES assets(id),
    input_type varchar(20) NOT NULL,
    original_file_name varchar(255),
    pasted_text text,
    document_title varchar(300),
    status varchar(20) NOT NULL DEFAULT 'uploaded',
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT source_documents_input_type_check CHECK (input_type IN ('image', 'pdf', 'text')),
    CONSTRAINT source_documents_input_check
        CHECK (
            (input_type = 'text' AND pasted_text IS NOT NULL AND asset_id IS NULL)
            OR (input_type IN ('image', 'pdf') AND asset_id IS NOT NULL AND pasted_text IS NULL)
        ),
    CONSTRAINT source_documents_status_check
        CHECK (status IN ('uploaded', 'processing', 'ready', 'failed', 'archived'))
);

CREATE FUNCTION lerniqa_validate_source_document_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.asset_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM assets
        WHERE id = NEW.asset_id
            AND purpose = 'source_document'
    ) THEN
        RAISE EXCEPTION '來源文件只能引用 source_document 用途的檔案'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER source_documents_asset_purpose_check
BEFORE INSERT OR UPDATE OF asset_id ON source_documents
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_source_document_asset();

CREATE TABLE source_document_classification_candidates (
    id uuid PRIMARY KEY,
    source_document_id uuid NOT NULL REFERENCES source_documents(id),
    dimension varchar(30) NOT NULL,
    raw_value text NOT NULL,
    publisher_id uuid REFERENCES publishers(id),
    subject_id uuid REFERENCES subjects(id),
    grade_id uuid REFERENCES grades(id),
    semester_id uuid REFERENCES semesters(id),
    book_version_id uuid REFERENCES book_versions(id),
    exam_program_id uuid REFERENCES exam_programs(id),
    exam_program_level_id uuid REFERENCES exam_program_levels(id),
    curriculum_unit_id uuid REFERENCES curriculum_units(id),
    curriculum_code_id uuid REFERENCES curriculum_codes(id),
    source_category_id uuid REFERENCES source_categories(id),
    parser_version varchar(80) NOT NULL,
    confidence numeric(5,4),
    review_status varchar(20) NOT NULL DEFAULT 'pending',
    reviewed_by_user_id uuid REFERENCES users(id),
    reviewed_at timestamptz,
    CONSTRAINT source_document_candidates_dimension_check
        CHECK (
            dimension IN (
                'publisher',
                'subject',
                'grade',
                'semester',
                'book_version',
                'exam_program',
                'exam_level',
                'unit',
                'curriculum_code',
                'source_category'
            )
        ),
    CONSTRAINT source_document_candidates_single_target_check
        CHECK (
            num_nonnulls(
                publisher_id,
                subject_id,
                grade_id,
                semester_id,
                book_version_id,
                exam_program_id,
                exam_program_level_id,
                curriculum_unit_id,
                curriculum_code_id,
                source_category_id
            ) <= 1
        ),
    CONSTRAINT source_document_candidates_target_dimension_check
        CHECK (
            num_nonnulls(
                publisher_id,
                subject_id,
                grade_id,
                semester_id,
                book_version_id,
                exam_program_id,
                exam_program_level_id,
                curriculum_unit_id,
                curriculum_code_id,
                source_category_id
            ) = 0
            OR (dimension = 'publisher' AND publisher_id IS NOT NULL)
            OR (dimension = 'subject' AND subject_id IS NOT NULL)
            OR (dimension = 'grade' AND grade_id IS NOT NULL)
            OR (dimension = 'semester' AND semester_id IS NOT NULL)
            OR (dimension = 'book_version' AND book_version_id IS NOT NULL)
            OR (dimension = 'exam_program' AND exam_program_id IS NOT NULL)
            OR (dimension = 'exam_level' AND exam_program_level_id IS NOT NULL)
            OR (dimension = 'unit' AND curriculum_unit_id IS NOT NULL)
            OR (dimension = 'curriculum_code' AND curriculum_code_id IS NOT NULL)
            OR (dimension = 'source_category' AND source_category_id IS NOT NULL)
        ),
    CONSTRAINT source_document_candidates_confidence_check
        CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    CONSTRAINT source_document_candidates_review_status_check
        CHECK (review_status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT source_document_candidates_review_check
        CHECK (
            (
                review_status = 'pending'
                AND reviewed_by_user_id IS NULL
                AND reviewed_at IS NULL
            )
            OR (
                review_status IN ('approved', 'rejected')
                AND reviewed_by_user_id IS NOT NULL
                AND reviewed_at IS NOT NULL
            )
        ),
    CONSTRAINT source_document_candidates_approved_target_check
        CHECK (
            review_status <> 'approved'
            OR num_nonnulls(
                publisher_id,
                subject_id,
                grade_id,
                semester_id,
                book_version_id,
                exam_program_id,
                exam_program_level_id,
                curriculum_unit_id,
                curriculum_code_id,
                source_category_id
            ) = 1
        )
);

CREATE INDEX source_document_candidates_review_index
    ON source_document_classification_candidates(source_document_id, review_status, dimension);

CREATE TABLE import_batches (
    id uuid PRIMARY KEY,
    question_bank_id uuid NOT NULL REFERENCES question_banks(id),
    learner_id uuid REFERENCES learners(id),
    created_by_user_id uuid NOT NULL REFERENCES users(id),
    status varchar(20) NOT NULL DEFAULT 'draft',
    idempotency_key varchar(120) NOT NULL,
    recognizer_version varchar(80),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_at timestamptz,
    CONSTRAINT import_batches_idempotency_unique UNIQUE (created_by_user_id, idempotency_key),
    CONSTRAINT import_batches_status_check
        CHECK (status IN ('draft', 'recognizing', 'review', 'confirmed', 'failed', 'cancelled')),
    CONSTRAINT import_batches_confirmed_check
        CHECK (
            (status = 'confirmed' AND confirmed_at IS NOT NULL)
            OR (status <> 'confirmed' AND confirmed_at IS NULL)
        )
);

CREATE TABLE import_batch_documents (
    import_batch_id uuid NOT NULL REFERENCES import_batches(id),
    source_document_id uuid NOT NULL REFERENCES source_documents(id),
    position integer NOT NULL,
    PRIMARY KEY (import_batch_id, source_document_id),
    CONSTRAINT import_batch_documents_position_unique UNIQUE (import_batch_id, position),
    CONSTRAINT import_batch_documents_position_check CHECK (position >= 0)
);

CREATE TABLE import_items (
    id uuid PRIMARY KEY,
    import_batch_id uuid NOT NULL,
    source_document_id uuid NOT NULL,
    source_page integer,
    source_question_number varchar(80),
    source_order integer NOT NULL,
    draft_payload jsonb NOT NULL,
    recognition_confidence numeric(4,3),
    review_status varchar(20) NOT NULL DEFAULT 'pending',
    question_id uuid REFERENCES questions(id),
    question_revision_id uuid,
    reviewed_by_user_id uuid REFERENCES users(id),
    reviewed_at timestamptz,
    CONSTRAINT import_items_identity_source_revision_unique
        UNIQUE (id, source_document_id, question_revision_id),
    CONSTRAINT import_items_batch_order_unique UNIQUE (import_batch_id, source_order),
    CONSTRAINT import_items_batch_document_fk
        FOREIGN KEY (import_batch_id, source_document_id)
        REFERENCES import_batch_documents(import_batch_id, source_document_id),
    CONSTRAINT import_items_question_revision_fk
        FOREIGN KEY (question_revision_id, question_id)
        REFERENCES question_revisions(id, question_id),
    CONSTRAINT import_items_source_page_check CHECK (source_page IS NULL OR source_page > 0),
    CONSTRAINT import_items_source_order_check CHECK (source_order >= 0),
    CONSTRAINT import_items_payload_check CHECK (jsonb_typeof(draft_payload) = 'object'),
    CONSTRAINT import_items_confidence_check
        CHECK (recognition_confidence IS NULL OR recognition_confidence BETWEEN 0 AND 1),
    CONSTRAINT import_items_review_status_check
        CHECK (review_status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT import_items_review_check
        CHECK (
            (
                review_status = 'pending'
                AND reviewed_by_user_id IS NULL
                AND reviewed_at IS NULL
            )
            OR (
                review_status IN ('approved', 'rejected')
                AND reviewed_by_user_id IS NOT NULL
                AND reviewed_at IS NOT NULL
            )
        ),
    CONSTRAINT import_items_question_link_check
        CHECK (
            (question_id IS NULL AND question_revision_id IS NULL)
            OR (question_id IS NOT NULL AND question_revision_id IS NOT NULL)
        )
);

CREATE TABLE question_revision_sources (
    id uuid PRIMARY KEY,
    question_revision_id uuid NOT NULL REFERENCES question_revisions(id),
    source_document_id uuid NOT NULL REFERENCES source_documents(id),
    import_item_id uuid,
    source_page integer,
    source_question_number varchar(80),
    crop_asset_id uuid REFERENCES assets(id),
    is_primary boolean NOT NULL DEFAULT true,
    CONSTRAINT question_revision_sources_import_item_fk
        FOREIGN KEY (import_item_id, source_document_id, question_revision_id)
        REFERENCES import_items(id, source_document_id, question_revision_id),
    CONSTRAINT question_revision_sources_page_check CHECK (source_page IS NULL OR source_page > 0)
);

CREATE UNIQUE INDEX question_revision_sources_primary_unique
    ON question_revision_sources(question_revision_id)
    WHERE is_primary = true;

CREATE INDEX question_revision_sources_document_index
    ON question_revision_sources(source_document_id, question_revision_id);

CREATE FUNCTION lerniqa_validate_revision_source_crop()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.crop_asset_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM assets
        WHERE id = NEW.crop_asset_id
            AND purpose = 'page_crop'
    ) THEN
        RAISE EXCEPTION '題目來源裁切圖只能引用 page_crop 用途的檔案'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER question_revision_sources_crop_purpose_check
BEFORE INSERT OR UPDATE OF crop_asset_id ON question_revision_sources
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_revision_source_crop();

ALTER TABLE question_identifiers
    DROP CONSTRAINT question_identifiers_type_check,
    DROP CONSTRAINT question_identifiers_scope_check,
    ADD COLUMN source_document_id uuid REFERENCES source_documents(id),
    ADD CONSTRAINT question_identifiers_type_check
        CHECK (identifier_type IN ('legacy', 'publisher_question', 'source_document_question')),
    ADD CONSTRAINT question_identifiers_scope_check
        CHECK (
            (
                identifier_type = 'legacy'
                AND publisher_id IS NULL
                AND book_version_id IS NULL
                AND source_document_id IS NULL
            )
            OR (
                identifier_type = 'publisher_question'
                AND publisher_id IS NOT NULL
                AND source_document_id IS NULL
            )
            OR (
                identifier_type = 'source_document_question'
                AND publisher_id IS NULL
                AND book_version_id IS NULL
                AND source_document_id IS NOT NULL
            )
        );

CREATE UNIQUE INDEX question_identifiers_source_document_unique
    ON question_identifiers(source_document_id, normalized_value)
    WHERE identifier_type = 'source_document_question';

CREATE TABLE question_collections (
    id uuid PRIMARY KEY,
    learner_id uuid NOT NULL REFERENCES learners(id),
    name varchar(100) NOT NULL,
    created_by_user_id uuid NOT NULL REFERENCES users(id),
    lock_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at timestamptz,
    CONSTRAINT question_collections_lock_version_check CHECK (lock_version > 0)
);

CREATE UNIQUE INDEX question_collections_active_name_unique
    ON question_collections(learner_id, name)
    WHERE archived_at IS NULL;

CREATE TABLE question_collection_items (
    collection_id uuid NOT NULL REFERENCES question_collections(id),
    question_id uuid NOT NULL REFERENCES questions(id),
    added_by_user_id uuid NOT NULL REFERENCES users(id),
    added_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (collection_id, question_id)
);

CREATE INDEX question_collection_items_question_index
    ON question_collection_items(question_id, collection_id);

INSERT INTO schema_migrations (version, name)
VALUES ('0003', 'import_and_collections');

COMMIT;
