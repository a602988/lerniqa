BEGIN;

-- Refuse to install the deferred integrity checks on top of inconsistent data.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM question_answers AS answer
        JOIN question_parts AS part ON part.id = answer.question_part_id
        WHERE part.answer_mode IN ('single_choice', 'multiple_choice', 'boolean')
            AND answer.answer_key IS NOT NULL
            AND NOT EXISTS (
                SELECT 1
                FROM question_options AS option
                WHERE option.question_part_id = answer.question_part_id
                    AND option.option_key = answer.answer_key
            )
    ) THEN
        RAISE EXCEPTION 'existing choice answer key does not belong to its question part options'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM source_documents AS document
        LEFT JOIN assets AS asset ON asset.id = document.asset_id
        WHERE document.status = 'ready'
            AND document.input_type = 'document'
            AND (
                asset.id IS NULL
                OR asset.purpose IS DISTINCT FROM 'source_document'
                OR asset.sensitivity IS DISTINCT FROM 'private'
                OR asset.scan_status IS DISTINCT FROM 'clean'
                OR asset.deleted_at IS NOT NULL
                OR asset.mime_type IS DISTINCT FROM
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            )
    ) THEN
        RAISE EXCEPTION 'existing ready Word source document references an unsafe or incompatible asset'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_assert_choice_answer_options(candidate_part_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    IF candidate_part_id IS NULL THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM question_parts AS part
        JOIN question_answers AS answer ON answer.question_part_id = part.id
        WHERE part.id = candidate_part_id
            AND part.answer_mode IN ('single_choice', 'multiple_choice', 'boolean')
            AND answer.answer_key IS NOT NULL
            AND NOT EXISTS (
                SELECT 1
                FROM question_options AS option
                WHERE option.question_part_id = answer.question_part_id
                    AND option.option_key = answer.answer_key
            )
    ) THEN
        RAISE EXCEPTION '選擇題的答案鍵必須屬於同一小題的選項'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_validate_choice_answer_options()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    previous_part_id uuid;
    current_part_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'question_parts' THEN
        IF TG_OP <> 'INSERT' THEN
            previous_part_id := OLD.id;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            current_part_id := NEW.id;
        END IF;
    ELSE
        IF TG_OP <> 'INSERT' THEN
            previous_part_id := OLD.question_part_id;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            current_part_id := NEW.question_part_id;
        END IF;
    END IF;

    PERFORM lerniqa_assert_choice_answer_options(previous_part_id);
    IF current_part_id IS DISTINCT FROM previous_part_id THEN
        PERFORM lerniqa_assert_choice_answer_options(current_part_id);
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER question_answers_choice_option_check
AFTER INSERT OR UPDATE OR DELETE ON question_answers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_choice_answer_options();

CREATE CONSTRAINT TRIGGER question_options_choice_answer_check
AFTER INSERT OR UPDATE OR DELETE ON question_options
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_choice_answer_options();

CREATE CONSTRAINT TRIGGER question_parts_choice_answer_check
AFTER INSERT OR UPDATE OR DELETE ON question_parts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_choice_answer_options();

CREATE FUNCTION lerniqa_assert_ready_document_asset(candidate_document_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    IF candidate_document_id IS NULL THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM source_documents AS document
        LEFT JOIN assets AS asset ON asset.id = document.asset_id
        WHERE document.id = candidate_document_id
            AND document.status = 'ready'
            AND document.input_type = 'document'
            AND (
                asset.id IS NULL
                OR asset.purpose IS DISTINCT FROM 'source_document'
                OR asset.sensitivity IS DISTINCT FROM 'private'
                OR asset.scan_status IS DISTINCT FROM 'clean'
                OR asset.deleted_at IS NOT NULL
                OR asset.mime_type IS DISTINCT FROM
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            )
    ) THEN
        RAISE EXCEPTION '已就緒的 Word 來源文件只能引用 private、clean、未刪除的 DOCX source_document 資產'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_validate_ready_document_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    previous_document_id uuid;
    current_document_id uuid;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        previous_document_id := OLD.id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        current_document_id := NEW.id;
    END IF;

    PERFORM lerniqa_assert_ready_document_asset(previous_document_id);
    IF current_document_id IS DISTINCT FROM previous_document_id THEN
        PERFORM lerniqa_assert_ready_document_asset(current_document_id);
    END IF;

    RETURN NULL;
END;
$$;

CREATE FUNCTION lerniqa_validate_ready_document_asset_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    previous_asset_id uuid;
    current_asset_id uuid;
    referenced_document record;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        previous_asset_id := OLD.id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        current_asset_id := NEW.id;
    END IF;

    FOR referenced_document IN
        SELECT document.id
        FROM source_documents AS document
        WHERE document.asset_id = previous_asset_id
            OR document.asset_id = current_asset_id
    LOOP
        PERFORM lerniqa_assert_ready_document_asset(referenced_document.id);
    END LOOP;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER source_documents_ready_document_asset_check
AFTER INSERT OR UPDATE OR DELETE ON source_documents
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_ready_document_asset();

CREATE CONSTRAINT TRIGGER assets_ready_document_reference_check
AFTER INSERT OR UPDATE OR DELETE ON assets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_ready_document_asset_update();

INSERT INTO schema_migrations (version, name)
VALUES ('0007', 'practice_answer_integrity');

COMMIT;
