UPDATE book_versions AS book
SET name = CASE publisher.code
    WHEN 'hanlin' THEN '翰林版'
    WHEN 'kangxuan' THEN '康軒版'
END
FROM publishers AS publisher, subjects AS subject
WHERE publisher.id = book.publisher_id
    AND subject.id = book.subject_id
    AND book.name = '第一冊'
    AND (
        (publisher.code = 'hanlin' AND subject.code IN ('chinese', 'english'))
        OR (publisher.code = 'kangxuan' AND subject.code IN ('math', 'biology'))
    )
    AND EXISTS (
        SELECT 1
        FROM curriculum_units AS volume
        WHERE volume.book_version_id = book.id
            AND volume.unit_type = 'volume'
            AND volume.name = '第一冊'
    );

UPDATE source_document_classification_candidates AS candidate
SET raw_value = book.name
FROM book_versions AS book
WHERE book.id = candidate.book_version_id
    AND candidate.dimension = 'book_version'
    AND candidate.raw_value = '第一冊'
    AND book.name IN ('翰林版', '康軒版');

INSERT INTO schema_migrations (version, name)
VALUES ('0016', 'book_version_volume_boundary');
