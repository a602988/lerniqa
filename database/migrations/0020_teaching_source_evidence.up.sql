BEGIN;

ALTER TABLE assets
    DROP CONSTRAINT assets_purpose_check,
    DROP CONSTRAINT assets_private_purpose_check,
    ADD CONSTRAINT assets_purpose_check
        CHECK (
            purpose IN (
                'question_content',
                'source_document',
                'source_page',
                'handwriting',
                'answer_attachment',
                'learner_avatar',
                'page_crop'
            )
        ),
    ADD CONSTRAINT assets_private_purpose_check
        CHECK (
            purpose NOT IN (
                'source_page',
                'handwriting',
                'answer_attachment',
                'learner_avatar'
            )
            OR sensitivity = 'private'
        );

CREATE TABLE source_document_catalog_profiles (
    source_document_id uuid PRIMARY KEY REFERENCES source_documents(id),
    academic_year smallint NOT NULL,
    grade_id uuid NOT NULL REFERENCES grades(id),
    subject_id uuid NOT NULL REFERENCES subjects(id),
    semester_id uuid NOT NULL REFERENCES semesters(id),
    book_version_id uuid NOT NULL,
    volume_unit_id uuid NOT NULL REFERENCES curriculum_units(id),
    review_status varchar(20) NOT NULL DEFAULT 'pending',
    reviewed_by_user_id uuid REFERENCES users(id),
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT source_catalog_profiles_year_check
        CHECK (academic_year BETWEEN 1 AND 999),
    CONSTRAINT source_catalog_profiles_book_subject_fk
        FOREIGN KEY (book_version_id, subject_id)
        REFERENCES book_versions(id, subject_id),
    CONSTRAINT source_catalog_profiles_status_check
        CHECK (review_status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT source_catalog_profiles_review_check
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
    CONSTRAINT source_catalog_profiles_review_time_check
        CHECK (reviewed_at IS NULL OR reviewed_at >= created_at)
);

CREATE INDEX source_catalog_profiles_catalog_index
    ON source_document_catalog_profiles(
        academic_year,
        grade_id,
        subject_id,
        semester_id,
        book_version_id,
        review_status
    );

CREATE TABLE source_document_processing_runs (
    id uuid PRIMARY KEY,
    source_document_id uuid NOT NULL REFERENCES source_documents(id),
    input_checksum varchar(128) NOT NULL,
    settings_checksum varchar(128) NOT NULL,
    parser_version varchar(80) NOT NULL,
    ocr_engine varchar(80) NOT NULL,
    ocr_model varchar(160) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    error_code varchar(80),
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT source_processing_runs_identity_unique
        UNIQUE (
            source_document_id,
            input_checksum,
            settings_checksum,
            parser_version
        ),
    CONSTRAINT source_processing_runs_text_check
        CHECK (
            btrim(input_checksum) <> ''
            AND btrim(settings_checksum) <> ''
            AND btrim(parser_version) <> ''
            AND btrim(ocr_engine) <> ''
            AND btrim(ocr_model) <> ''
        ),
    CONSTRAINT source_processing_runs_status_check
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT source_processing_runs_state_check
        CHECK (
            (
                status = 'pending'
                AND started_at IS NULL
                AND completed_at IS NULL
                AND error_code IS NULL
            )
            OR (
                status = 'processing'
                AND started_at IS NOT NULL
                AND completed_at IS NULL
                AND error_code IS NULL
            )
            OR (
                status = 'completed'
                AND started_at IS NOT NULL
                AND completed_at IS NOT NULL
                AND error_code IS NULL
            )
            OR (
                status = 'failed'
                AND completed_at IS NOT NULL
                AND error_code IS NOT NULL
                AND btrim(error_code) <> ''
            )
        ),
    CONSTRAINT source_processing_runs_time_check
        CHECK (
            started_at IS NULL
            OR completed_at IS NULL
            OR completed_at >= started_at
        )
);

CREATE INDEX source_processing_runs_status_index
    ON source_document_processing_runs(source_document_id, status, created_at);

CREATE TABLE source_document_pages (
    id uuid PRIMARY KEY,
    source_document_id uuid NOT NULL REFERENCES source_documents(id),
    pdf_page_number integer NOT NULL,
    printed_page_number integer NOT NULL,
    curriculum_unit_id uuid REFERENCES curriculum_units(id),
    asset_id uuid NOT NULL UNIQUE REFERENCES assets(id),
    width integer NOT NULL,
    height integer NOT NULL,
    render_version varchar(80) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT source_document_pages_pdf_unique
        UNIQUE (source_document_id, pdf_page_number),
    CONSTRAINT source_document_pages_printed_unique
        UNIQUE (source_document_id, printed_page_number),
    CONSTRAINT source_document_pages_number_check
        CHECK (pdf_page_number > 0 AND printed_page_number > 0),
    CONSTRAINT source_document_pages_size_check
        CHECK (width > 0 AND height > 0),
    CONSTRAINT source_document_pages_render_check
        CHECK (btrim(render_version) <> '')
);

CREATE INDEX source_document_pages_unit_index
    ON source_document_pages(curriculum_unit_id, source_document_id, pdf_page_number);

CREATE TABLE source_document_blocks (
    id uuid PRIMARY KEY,
    source_document_page_id uuid NOT NULL REFERENCES source_document_pages(id),
    processing_run_id uuid NOT NULL REFERENCES source_document_processing_runs(id),
    position integer NOT NULL,
    block_type varchar(30) NOT NULL,
    bounds_left numeric(7,6) NOT NULL,
    bounds_top numeric(7,6) NOT NULL,
    bounds_width numeric(7,6) NOT NULL,
    bounds_height numeric(7,6) NOT NULL,
    raw_text text NOT NULL,
    corrected_text text,
    ocr_engine varchar(80) NOT NULL,
    ocr_version varchar(80) NOT NULL,
    ocr_model varchar(160) NOT NULL,
    confidence numeric(7,6),
    review_status varchar(20) NOT NULL DEFAULT 'pending',
    reviewed_by_user_id uuid REFERENCES users(id),
    reviewed_at timestamptz,
    revoked_by_user_id uuid REFERENCES users(id),
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT source_document_blocks_run_position_unique
        UNIQUE (processing_run_id, source_document_page_id, position),
    CONSTRAINT source_document_blocks_position_check CHECK (position >= 0),
    CONSTRAINT source_document_blocks_type_check
        CHECK (
            block_type IN (
                'heading',
                'body',
                'annotation',
                'translation',
                'diagram',
                'exercise',
                'answer_explanation',
                'other'
            )
        ),
    CONSTRAINT source_document_blocks_bounds_check
        CHECK (
            bounds_left BETWEEN 0 AND 1
            AND bounds_top BETWEEN 0 AND 1
            AND bounds_width > 0
            AND bounds_width <= 1
            AND bounds_height > 0
            AND bounds_height <= 1
            AND bounds_left + bounds_width <= 1
            AND bounds_top + bounds_height <= 1
        ),
    CONSTRAINT source_document_blocks_text_check
        CHECK (
            btrim(raw_text) <> ''
            AND (corrected_text IS NULL OR btrim(corrected_text) <> '')
            AND btrim(ocr_engine) <> ''
            AND btrim(ocr_version) <> ''
            AND btrim(ocr_model) <> ''
        ),
    CONSTRAINT source_document_blocks_confidence_check
        CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    CONSTRAINT source_document_blocks_status_check
        CHECK (review_status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT source_document_blocks_review_check
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
    CONSTRAINT source_document_blocks_review_time_check
        CHECK (reviewed_at IS NULL OR reviewed_at >= created_at),
    CONSTRAINT source_document_blocks_revoke_check
        CHECK (
            (revoked_by_user_id IS NULL AND revoked_at IS NULL)
            OR (
                review_status = 'approved'
                AND revoked_by_user_id IS NOT NULL
                AND revoked_at IS NOT NULL
                AND revoked_at >= reviewed_at
            )
        )
);

CREATE INDEX source_document_blocks_page_status_index
    ON source_document_blocks(
        source_document_page_id,
        review_status,
        revoked_at,
        position
    );

CREATE TABLE question_revision_source_evidence (
    id uuid PRIMARY KEY,
    question_revision_id uuid NOT NULL REFERENCES question_revisions(id),
    source_document_block_id uuid NOT NULL REFERENCES source_document_blocks(id),
    evidence_role varchar(30) NOT NULL,
    position smallint NOT NULL DEFAULT 0,
    review_status varchar(20) NOT NULL DEFAULT 'pending',
    linked_by_user_id uuid NOT NULL REFERENCES users(id),
    reviewed_by_user_id uuid REFERENCES users(id),
    reviewed_at timestamptz,
    revoked_by_user_id uuid REFERENCES users(id),
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT question_revision_source_evidence_identity_unique
        UNIQUE (
            question_revision_id,
            source_document_block_id,
            evidence_role
        ),
    CONSTRAINT question_revision_source_evidence_role_check
        CHECK (
            evidence_role IN (
                'concept',
                'passage',
                'annotation',
                'translation',
                'option_reason',
                'answer_reason',
                'image'
            )
        ),
    CONSTRAINT question_revision_source_evidence_position_check
        CHECK (position >= 0),
    CONSTRAINT question_revision_source_evidence_status_check
        CHECK (review_status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT question_revision_source_evidence_review_check
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
    CONSTRAINT question_revision_source_evidence_review_time_check
        CHECK (reviewed_at IS NULL OR reviewed_at >= created_at),
    CONSTRAINT question_revision_source_evidence_revoke_check
        CHECK (
            (revoked_by_user_id IS NULL AND revoked_at IS NULL)
            OR (
                review_status = 'approved'
                AND revoked_by_user_id IS NOT NULL
                AND revoked_at IS NOT NULL
                AND revoked_at >= reviewed_at
            )
        )
);

CREATE INDEX question_revision_source_evidence_revision_index
    ON question_revision_source_evidence(
        question_revision_id,
        review_status,
        revoked_at,
        position
    );

CREATE INDEX question_revision_source_evidence_block_index
    ON question_revision_source_evidence(source_document_block_id, review_status);

CREATE FUNCTION lerniqa_validate_source_catalog_profile()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.review_status <> 'pending' THEN
        RAISE EXCEPTION '教材目錄範圍必須先建立為 pending'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.review_status <> 'pending' THEN
            RAISE EXCEPTION '已完成審核的教材目錄範圍不可覆寫'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.source_document_id <> OLD.source_document_id
            OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION '教材目錄範圍身分欄位不可覆寫'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM book_versions AS book
        WHERE book.id = NEW.book_version_id
            AND book.subject_id = NEW.subject_id
            AND book.grade_id = NEW.grade_id
    ) THEN
        RAISE EXCEPTION '教材版本與年級、科目不一致'
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM curriculum_units AS volume
        WHERE volume.id = NEW.volume_unit_id
            AND volume.unit_type = 'volume'
            AND volume.subject_id = NEW.subject_id
            AND volume.grade_id = NEW.grade_id
            AND volume.semester_id = NEW.semester_id
            AND volume.book_version_id = NEW.book_version_id
    ) THEN
        RAISE EXCEPTION '教材冊次與正式教材目錄不一致'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.review_status IN ('approved', 'rejected')
        AND NOT lerniqa_user_is_system_admin(NEW.reviewed_by_user_id) THEN
        RAISE EXCEPTION '教材目錄範圍只能由有效 system_admin 審核'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.review_status = 'approved' AND NOT EXISTS (
        SELECT 1
        FROM source_documents AS document
        JOIN assets AS asset ON asset.id = document.asset_id
        WHERE document.id = NEW.source_document_id
            AND document.status = 'ready'
            AND asset.purpose = 'source_document'
            AND asset.sensitivity = 'private'
            AND asset.scan_status = 'clean'
            AND asset.deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION '核准教材目錄範圍前，來源文件必須是可用的 private clean asset'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER source_catalog_profiles_integrity_check
BEFORE INSERT OR UPDATE ON source_document_catalog_profiles
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_source_catalog_profile();

CREATE FUNCTION lerniqa_validate_source_processing_run()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status <> 'pending' THEN
        RAISE EXCEPTION '教材處理批次必須先建立為 pending'
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM source_documents AS document
        JOIN assets AS asset ON asset.id = document.asset_id
        WHERE document.id = NEW.source_document_id
            AND asset.checksum = NEW.input_checksum
            AND asset.purpose = 'source_document'
            AND asset.deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION '教材處理批次 checksum 與來源文件不一致'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id <> OLD.id
            OR NEW.source_document_id <> OLD.source_document_id
            OR NEW.input_checksum <> OLD.input_checksum
            OR NEW.settings_checksum <> OLD.settings_checksum
            OR NEW.parser_version <> OLD.parser_version
            OR NEW.ocr_engine <> OLD.ocr_engine
            OR NEW.ocr_model <> OLD.ocr_model
            OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION '教材處理批次身分欄位不可覆寫'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.status IN ('completed', 'failed') THEN
            RAISE EXCEPTION '已結束的教材處理批次不可覆寫'
                USING ERRCODE = '23514';
        END IF;

        IF NOT (
            (OLD.status = 'pending' AND NEW.status IN ('processing', 'failed'))
            OR (
                OLD.status = 'processing'
                AND NEW.status IN ('processing', 'completed', 'failed')
            )
        ) THEN
            RAISE EXCEPTION '教材處理批次狀態轉換無效'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER source_processing_runs_integrity_check
BEFORE INSERT OR UPDATE ON source_document_processing_runs
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_source_processing_run();

CREATE FUNCTION lerniqa_validate_source_document_page()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM assets AS asset
        WHERE asset.id = NEW.asset_id
            AND asset.purpose = 'source_page'
            AND asset.sensitivity = 'private'
            AND asset.scan_status = 'clean'
            AND asset.deleted_at IS NULL
            AND asset.mime_type LIKE 'image/%'
            AND asset.width = NEW.width
            AND asset.height = NEW.height
    ) THEN
        RAISE EXCEPTION '教材頁面必須引用尺寸相符的 private clean source_page 影像'
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM source_document_catalog_profiles AS profile
        WHERE profile.source_document_id = NEW.source_document_id
    ) THEN
        RAISE EXCEPTION '教材頁面必須先建立來源文件的目錄範圍'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.curriculum_unit_id IS NOT NULL AND NOT EXISTS (
        WITH RECURSIVE unit_tree AS (
            SELECT unit.id, unit.parent_unit_id
            FROM curriculum_units AS unit
            JOIN source_document_catalog_profiles AS profile
                ON profile.source_document_id = NEW.source_document_id
            WHERE unit.id = NEW.curriculum_unit_id
                AND unit.subject_id = profile.subject_id
                AND unit.grade_id = profile.grade_id
                AND unit.semester_id = profile.semester_id
                AND unit.book_version_id = profile.book_version_id

            UNION

            SELECT parent.id, parent.parent_unit_id
            FROM curriculum_units AS parent
            JOIN unit_tree AS child ON child.parent_unit_id = parent.id
        )
        SELECT 1
        FROM unit_tree
        JOIN source_document_catalog_profiles AS profile
            ON profile.source_document_id = NEW.source_document_id
        WHERE unit_tree.id = profile.volume_unit_id
    ) THEN
        RAISE EXCEPTION '教材頁面課次不屬於來源文件的冊次'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id <> OLD.id
            OR NEW.source_document_id <> OLD.source_document_id
            OR NEW.pdf_page_number <> OLD.pdf_page_number
            OR NEW.printed_page_number <> OLD.printed_page_number
            OR NEW.asset_id <> OLD.asset_id
            OR NEW.width <> OLD.width
            OR NEW.height <> OLD.height
            OR NEW.render_version <> OLD.render_version
            OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION '教材頁面來源與渲染身分不可覆寫'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.curriculum_unit_id IS DISTINCT FROM OLD.curriculum_unit_id
            AND EXISTS (
                SELECT 1
                FROM source_document_blocks AS block
                WHERE block.source_document_page_id = OLD.id
                    AND block.review_status = 'approved'
            ) THEN
            RAISE EXCEPTION '已有核准區塊的教材頁面不可更換課次'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER source_document_pages_integrity_check
BEFORE INSERT OR UPDATE ON source_document_pages
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_source_document_page();

CREATE FUNCTION lerniqa_validate_source_document_block()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.review_status <> 'pending' THEN
        RAISE EXCEPTION '教材 OCR 區塊必須先建立為 pending'
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM source_document_pages AS page
        JOIN source_document_processing_runs AS run
            ON run.id = NEW.processing_run_id
            AND run.source_document_id = page.source_document_id
        WHERE page.id = NEW.source_document_page_id
            AND run.ocr_engine = NEW.ocr_engine
            AND run.ocr_model = NEW.ocr_model
            AND run.status IN ('processing', 'completed')
    ) THEN
        RAISE EXCEPTION '教材 OCR 區塊與頁面、處理批次或模型身分不一致'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id <> OLD.id
            OR NEW.source_document_page_id <> OLD.source_document_page_id
            OR NEW.processing_run_id <> OLD.processing_run_id
            OR NEW.position <> OLD.position
            OR NEW.raw_text <> OLD.raw_text
            OR NEW.ocr_engine <> OLD.ocr_engine
            OR NEW.ocr_version <> OLD.ocr_version
            OR NEW.ocr_model <> OLD.ocr_model
            OR NEW.confidence IS DISTINCT FROM OLD.confidence
            OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION '教材 OCR 原始結果與身分欄位不可覆寫'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.review_status <> 'pending' THEN
            IF NEW.review_status <> OLD.review_status
                OR NEW.block_type <> OLD.block_type
                OR NEW.bounds_left <> OLD.bounds_left
                OR NEW.bounds_top <> OLD.bounds_top
                OR NEW.bounds_width <> OLD.bounds_width
                OR NEW.bounds_height <> OLD.bounds_height
                OR NEW.corrected_text IS DISTINCT FROM OLD.corrected_text
                OR NEW.reviewed_by_user_id <> OLD.reviewed_by_user_id
                OR NEW.reviewed_at <> OLD.reviewed_at THEN
                RAISE EXCEPTION '已完成審核的教材 OCR 區塊不可覆寫'
                    USING ERRCODE = '23514';
            END IF;
        END IF;

        IF OLD.review_status = 'pending'
            AND NEW.review_status NOT IN ('pending', 'approved', 'rejected') THEN
            RAISE EXCEPTION '教材 OCR 區塊狀態轉換無效'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.revoked_at IS NOT NULL
            AND (
                NEW.revoked_at <> OLD.revoked_at
                OR NEW.revoked_by_user_id <> OLD.revoked_by_user_id
            ) THEN
            RAISE EXCEPTION '教材 OCR 區塊撤回證據不可覆寫'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.review_status IN ('approved', 'rejected')
        AND NOT lerniqa_user_is_system_admin(NEW.reviewed_by_user_id) THEN
        RAISE EXCEPTION '教材 OCR 區塊只能由有效 system_admin 審核'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.review_status = 'approved' AND NOT EXISTS (
        SELECT 1
        FROM source_document_processing_runs AS run
        WHERE run.id = NEW.processing_run_id
            AND run.status = 'completed'
    ) THEN
        RAISE EXCEPTION '處理批次完成後才能核准教材 OCR 區塊'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.revoked_at IS NOT NULL
        AND NOT lerniqa_user_is_system_admin(NEW.revoked_by_user_id) THEN
        RAISE EXCEPTION '教材 OCR 區塊只能由有效 system_admin 撤回'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER source_document_blocks_integrity_check
BEFORE INSERT OR UPDATE ON source_document_blocks
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_source_document_block();

CREATE FUNCTION lerniqa_validate_question_source_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.review_status <> 'pending' THEN
            RAISE EXCEPTION '題目教材證據必須先建立為 pending'
                USING ERRCODE = '23514';
        END IF;

        IF NOT lerniqa_user_is_system_admin(NEW.linked_by_user_id) THEN
            RAISE EXCEPTION '題目教材證據只能由有效 system_admin 建立'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM question_revisions AS revision
        JOIN source_document_blocks AS block
            ON block.id = NEW.source_document_block_id
        JOIN source_document_pages AS page
            ON page.id = block.source_document_page_id
        JOIN source_document_catalog_profiles AS profile
            ON profile.source_document_id = page.source_document_id
        WHERE revision.id = NEW.question_revision_id
            AND revision.subject_id = profile.subject_id
            AND revision.grade_id = profile.grade_id
            AND revision.semester_id = profile.semester_id
            AND revision.book_version_id = profile.book_version_id
    ) THEN
        RAISE EXCEPTION '題目版本與教材證據的年級、科目、學期或版本不一致'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id <> OLD.id
            OR NEW.question_revision_id <> OLD.question_revision_id
            OR NEW.source_document_block_id <> OLD.source_document_block_id
            OR NEW.evidence_role <> OLD.evidence_role
            OR NEW.linked_by_user_id <> OLD.linked_by_user_id
            OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION '題目教材證據的來源身分不可覆寫'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.review_status <> 'pending' THEN
            IF NEW.review_status <> OLD.review_status
                OR NEW.position <> OLD.position
                OR NEW.reviewed_by_user_id <> OLD.reviewed_by_user_id
                OR NEW.reviewed_at <> OLD.reviewed_at THEN
                RAISE EXCEPTION '已完成審核的題目教材證據不可覆寫'
                    USING ERRCODE = '23514';
            END IF;
        END IF;

        IF OLD.revoked_at IS NOT NULL
            AND (
                NEW.revoked_at <> OLD.revoked_at
                OR NEW.revoked_by_user_id <> OLD.revoked_by_user_id
            ) THEN
            RAISE EXCEPTION '題目教材證據的撤回紀錄不可覆寫'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.review_status IN ('approved', 'rejected')
        AND NOT lerniqa_user_is_system_admin(NEW.reviewed_by_user_id) THEN
        RAISE EXCEPTION '題目教材證據只能由有效 system_admin 審核'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.review_status = 'approved' AND NOT EXISTS (
        SELECT 1
        FROM source_document_blocks AS block
        JOIN source_document_pages AS page
            ON page.id = block.source_document_page_id
        JOIN source_document_catalog_profiles AS profile
            ON profile.source_document_id = page.source_document_id
        WHERE block.id = NEW.source_document_block_id
            AND block.review_status = 'approved'
            AND block.revoked_at IS NULL
            AND profile.review_status = 'approved'
    ) THEN
        RAISE EXCEPTION '核准題目教材證據只能引用有效的已核准教材區塊與目錄範圍'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.revoked_at IS NOT NULL
        AND NOT lerniqa_user_is_system_admin(NEW.revoked_by_user_id) THEN
        RAISE EXCEPTION '題目教材證據只能由有效 system_admin 撤回'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER question_revision_source_evidence_integrity_check
BEFORE INSERT OR UPDATE ON question_revision_source_evidence
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_question_source_evidence();

INSERT INTO schema_migrations (version, name)
VALUES ('0020', 'teaching_source_evidence');

COMMIT;
