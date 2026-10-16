BEGIN;

DROP TRIGGER assets_ready_document_reference_check ON assets;
DROP TRIGGER source_documents_ready_document_asset_check ON source_documents;
DROP TRIGGER question_parts_choice_answer_check ON question_parts;
DROP TRIGGER question_options_choice_answer_check ON question_options;
DROP TRIGGER question_answers_choice_option_check ON question_answers;

DROP FUNCTION lerniqa_validate_ready_document_asset_update();
DROP FUNCTION lerniqa_validate_ready_document_asset();
DROP FUNCTION lerniqa_assert_ready_document_asset(uuid);
DROP FUNCTION lerniqa_validate_choice_answer_options();
DROP FUNCTION lerniqa_assert_choice_answer_options(uuid);

DELETE FROM schema_migrations WHERE version = '0007';

COMMIT;
