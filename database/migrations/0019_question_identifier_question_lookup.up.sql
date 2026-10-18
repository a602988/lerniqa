BEGIN;

CREATE INDEX question_identifiers_preferred_lookup_index
    ON question_identifiers (
        question_id,
        (CASE identifier_type WHEN 'publisher_question' THEN 0 ELSE 1 END),
        value
    );

INSERT INTO schema_migrations (version, name)
VALUES ('0019', 'question_identifier_question_lookup');

COMMIT;
