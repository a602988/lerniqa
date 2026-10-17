UPDATE source_document_classification_candidates AS candidate
SET raw_value = '第一冊'
FROM book_versions AS book
WHERE book.id = candidate.book_version_id
    AND candidate.dimension = 'book_version'
    AND candidate.raw_value IN ('翰林版', '康軒版')
    AND book.name IN ('翰林版', '康軒版');

UPDATE book_versions AS book
SET name = '第一冊'
FROM publishers AS publisher, subjects AS subject
WHERE publisher.id = book.publisher_id
    AND subject.id = book.subject_id
    AND (
        (publisher.code = 'hanlin' AND subject.code IN ('chinese', 'english') AND book.name = '翰林版')
        OR (publisher.code = 'kangxuan' AND subject.code IN ('math', 'biology') AND book.name = '康軒版')
    )
    AND EXISTS (
        SELECT 1
        FROM curriculum_units AS volume
        WHERE volume.book_version_id = book.id
            AND volume.unit_type = 'volume'
            AND volume.name = '第一冊'
    );

DELETE FROM schema_migrations
WHERE version = '0016' AND name = 'book_version_volume_boundary';
