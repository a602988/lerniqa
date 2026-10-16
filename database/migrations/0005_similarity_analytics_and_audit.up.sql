BEGIN;

-- Account-owned catalog entries use the same ownership contract as questions,
-- subjects, topics, and knowledge points. Existing catalog rows are system data.
ALTER TABLE curriculum_units
    ADD COLUMN origin varchar(20) NOT NULL DEFAULT 'system',
    ADD COLUMN owner_user_id uuid REFERENCES users(id);

ALTER TABLE curriculum_units
    ALTER COLUMN origin DROP DEFAULT,
    ADD CONSTRAINT curriculum_units_origin_check
        CHECK (origin IN ('system', 'account')),
    ADD CONSTRAINT curriculum_units_owner_check
        CHECK (
            (origin = 'system' AND owner_user_id IS NULL)
            OR (origin = 'account' AND owner_user_id IS NOT NULL)
        );

CREATE INDEX curriculum_units_owner_status_index
    ON curriculum_units(owner_user_id, status)
    WHERE origin = 'account';

ALTER TABLE source_categories
    ADD COLUMN origin varchar(20) NOT NULL DEFAULT 'system',
    ADD COLUMN owner_user_id uuid REFERENCES users(id);

ALTER TABLE source_categories
    ALTER COLUMN origin DROP DEFAULT,
    ADD CONSTRAINT source_categories_origin_check
        CHECK (origin IN ('system', 'account')),
    ADD CONSTRAINT source_categories_owner_check
        CHECK (
            (origin = 'system' AND owner_user_id IS NULL)
            OR (origin = 'account' AND owner_user_id IS NOT NULL)
        );

CREATE INDEX source_categories_owner_status_index
    ON source_categories(owner_user_id, status)
    WHERE origin = 'account';

-- Exam level parentage is already constrained to one program by a composite
-- foreign key. Reject longer ancestry cycles that the self-parent CHECK misses.
DO $$
BEGIN
    IF EXISTS (
        WITH RECURSIVE ancestry (
            start_id,
            current_id,
            parent_level_id,
            visited_ids,
            has_cycle
        ) AS (
            SELECT
                id,
                id,
                parent_level_id,
                ARRAY[id]::uuid[],
                false
            FROM exam_program_levels

            UNION ALL

            SELECT
                ancestry.start_id,
                parent.id,
                parent.parent_level_id,
                ancestry.visited_ids || parent.id,
                parent.id = ANY(ancestry.visited_ids)
            FROM ancestry
            JOIN exam_program_levels AS parent
                ON parent.id = ancestry.parent_level_id
            WHERE NOT ancestry.has_cycle
        )
        SELECT 1
        FROM ancestry
        WHERE has_cycle
    ) THEN
        RAISE EXCEPTION 'existing exam program level ancestry contains a cycle'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_validate_exam_program_level_ancestry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        WITH RECURSIVE ancestry (
            current_id,
            parent_level_id,
            visited_ids,
            has_cycle
        ) AS (
            SELECT
                id,
                parent_level_id,
                ARRAY[id]::uuid[],
                false
            FROM exam_program_levels
            WHERE id = NEW.id

            UNION ALL

            SELECT
                parent.id,
                parent.parent_level_id,
                ancestry.visited_ids || parent.id,
                parent.id = ANY(ancestry.visited_ids)
            FROM ancestry
            JOIN exam_program_levels AS parent
                ON parent.id = ancestry.parent_level_id
            WHERE NOT ancestry.has_cycle
        )
        SELECT 1
        FROM ancestry
        WHERE has_cycle
    ) THEN
        RAISE EXCEPTION '考試級別的上層關係不可形成循環'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER exam_program_levels_ancestry_check
AFTER INSERT OR UPDATE OF parent_level_id ON exam_program_levels
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_exam_program_level_ancestry();

-- Aliases are global catalog aliases and may only point at system subjects.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM subject_aliases AS alias
        JOIN subjects AS subject ON subject.id = alias.subject_id
        WHERE subject.origin <> 'system'
    ) THEN
        RAISE EXCEPTION 'an existing subject alias points at an account subject'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_validate_subject_alias_subject()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM subjects
        WHERE id = NEW.subject_id
            AND origin = 'system'
    ) THEN
        RAISE EXCEPTION '科目別名只能屬於系統科目'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER subject_aliases_system_subject_check
BEFORE INSERT OR UPDATE OF subject_id ON subject_aliases
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_subject_alias_subject();

CREATE FUNCTION lerniqa_validate_subject_aliases_after_origin_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM subjects AS subject
        JOIN subject_aliases AS alias ON alias.subject_id = subject.id
        WHERE subject.id = NEW.id
            AND subject.origin <> 'system'
    ) THEN
        RAISE EXCEPTION '已有別名的系統科目不可改為帳號自訂科目'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER subjects_aliases_origin_check
AFTER UPDATE OF origin ON subjects
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_subject_aliases_after_origin_change();

-- Applied seed evidence is an immutable deployment record. Superseding keeps
-- the original application timestamp so catalog provenance remains auditable.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM seed_manifests
        WHERE status = 'superseded'
            AND applied_at IS NULL
    ) THEN
        RAISE EXCEPTION 'an existing superseded seed manifest has no applied_at evidence'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

ALTER TABLE seed_manifests
    DROP CONSTRAINT seed_manifests_applied_at_check,
    ADD CONSTRAINT seed_manifests_applied_at_check
        CHECK (
            (
                status IN ('applied', 'superseded')
                AND applied_at IS NOT NULL
            )
            OR (
                status IN ('pending', 'failed')
                AND applied_at IS NULL
            )
        );

CREATE FUNCTION lerniqa_protect_seed_manifest_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status NOT IN ('pending', 'failed') THEN
            RAISE EXCEPTION '種子版本必須先以 pending 或 failed 建立後才能標記為 applied'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('applied', 'superseded') THEN
            RAISE EXCEPTION '已套用或已取代的種子版本證據不可刪除'
                USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.status = 'applied' THEN
        IF NEW IS NOT DISTINCT FROM OLD THEN
            RETURN NEW;
        END IF;

        IF NEW.status = 'superseded'
            AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION '已套用的種子版本只能保留證據後轉為 superseded'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status = 'superseded' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION '已取代的種子版本證據不可覆寫'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status IN ('pending', 'failed')
        AND NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
            (OLD.status = 'pending' AND NEW.status IN ('applied', 'failed'))
            OR (OLD.status = 'failed' AND NEW.status = 'pending')
        ) THEN
            RAISE EXCEPTION '種子版本狀態轉換必須依 pending、applied、failed 與 superseded 流程'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.status = 'pending' AND NEW.status = 'applied' THEN
            NEW.applied_at := transaction_timestamp();
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER seed_manifests_evidence_immutable
BEFORE INSERT OR UPDATE OR DELETE ON seed_manifests
FOR EACH ROW
EXECUTE FUNCTION lerniqa_protect_seed_manifest_evidence();

-- A general attachment has a distinct purpose so that answer uploads cannot be
-- confused with published question content or another learner's avatar.
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

-- 0004 allowed a general private asset to be attached to an answer before the
-- dedicated purpose existed. Reclassify only unambiguous, already-clean legacy
-- attachments. Ambiguous or unsafe assets require an operator decision.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM assets AS asset
        WHERE EXISTS (
            SELECT 1
            FROM answer_part_assets AS answer_asset
            WHERE answer_asset.asset_id = asset.id
                AND answer_asset.asset_role = 'attachment'
        )
        AND (
            asset.sensitivity IS DISTINCT FROM 'private'
            OR asset.scan_status IS DISTINCT FROM 'clean'
            OR asset.deleted_at IS NOT NULL
            OR EXISTS (
                SELECT 1 FROM learners
                WHERE avatar_asset_id = asset.id
            )
            OR EXISTS (
                SELECT 1 FROM question_content_blocks
                WHERE asset_id = asset.id
            )
            OR EXISTS (
                SELECT 1 FROM source_documents
                WHERE asset_id = asset.id
            )
            OR EXISTS (
                SELECT 1 FROM question_revision_sources
                WHERE crop_asset_id = asset.id
            )
            OR EXISTS (
                SELECT 1
                FROM answer_part_assets AS handwriting
                WHERE handwriting.asset_id = asset.id
                    AND handwriting.asset_role = 'handwriting'
            )
        )
    ) THEN
        RAISE EXCEPTION 'an existing answer attachment is unsafe or shared with another asset purpose'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

UPDATE assets AS asset
SET purpose = 'answer_attachment'
WHERE EXISTS (
    SELECT 1
    FROM answer_part_assets AS answer_asset
    WHERE answer_asset.asset_id = asset.id
        AND answer_asset.asset_role = 'attachment'
)
AND asset.purpose <> 'answer_attachment';

CREATE FUNCTION lerniqa_asset_reference_is_valid(
    referenced_asset_id uuid,
    allowed_purposes varchar[],
    require_private boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM assets AS asset
        WHERE asset.id = referenced_asset_id
            AND asset.purpose = ANY(allowed_purposes)
            AND (NOT require_private OR asset.sensitivity = 'private')
            AND asset.scan_status = 'clean'
            AND asset.deleted_at IS NULL
    );
$$;

-- Refuse an unsafe upgrade. A scanner or operator must explicitly make an
-- existing asset clean; the migration never converts pending assets to clean.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM learners AS learner
        WHERE learner.avatar_asset_id IS NOT NULL
            AND NOT lerniqa_asset_reference_is_valid(
                learner.avatar_asset_id,
                ARRAY['learner_avatar']::varchar[],
                true
            )
    ) THEN
        RAISE EXCEPTION 'existing learner avatar asset is not clean, active, private learner_avatar data'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM question_content_blocks AS block
        WHERE block.asset_id IS NOT NULL
            AND NOT lerniqa_asset_reference_is_valid(
                block.asset_id,
                CASE
                    WHEN block.content_type = 'page_crop'
                        THEN ARRAY['page_crop']::varchar[]
                    ELSE ARRAY['question_content']::varchar[]
                END,
                false
            )
    ) THEN
        RAISE EXCEPTION 'existing question content references an unsafe asset'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM source_documents AS document
        WHERE document.asset_id IS NOT NULL
            AND NOT lerniqa_asset_reference_is_valid(
                document.asset_id,
                ARRAY['source_document']::varchar[],
                false
            )
    ) THEN
        RAISE EXCEPTION 'existing source document references an unsafe asset'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM question_revision_sources AS source
        WHERE source.crop_asset_id IS NOT NULL
            AND NOT lerniqa_asset_reference_is_valid(
                source.crop_asset_id,
                ARRAY['page_crop']::varchar[],
                false
            )
    ) THEN
        RAISE EXCEPTION 'existing revision source references an unsafe crop asset'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM answer_part_assets AS answer_asset
        WHERE NOT lerniqa_asset_reference_is_valid(
            answer_asset.asset_id,
            CASE answer_asset.asset_role
                WHEN 'handwriting' THEN ARRAY['handwriting']::varchar[]
                WHEN 'attachment' THEN ARRAY['answer_attachment']::varchar[]
                ELSE ARRAY[]::varchar[]
            END,
            true
        )
    ) THEN
        RAISE EXCEPTION 'existing answer attachment references an unsafe or incompatible asset'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_validate_learner_avatar_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.avatar_asset_id IS NOT NULL
        AND NOT lerniqa_asset_reference_is_valid(
            NEW.avatar_asset_id,
            ARRAY['learner_avatar']::varchar[],
            true
        ) THEN
        RAISE EXCEPTION '學習者代表圖片必須引用 clean、未刪除且 private 的 learner_avatar 檔案'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER learners_avatar_asset_check
BEFORE INSERT OR UPDATE OF avatar_asset_id ON learners
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_learner_avatar_asset();

CREATE FUNCTION lerniqa_validate_question_content_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.asset_id IS NOT NULL
        AND NOT lerniqa_asset_reference_is_valid(
            NEW.asset_id,
            CASE
                WHEN NEW.content_type = 'page_crop'
                    THEN ARRAY['page_crop']::varchar[]
                ELSE ARRAY['question_content']::varchar[]
            END,
            false
        ) THEN
        RAISE EXCEPTION '題目內容只能引用用途相容、clean 且未刪除的檔案'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER question_content_blocks_asset_check
BEFORE INSERT OR UPDATE OF asset_id, content_type ON question_content_blocks
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_question_content_asset();

CREATE OR REPLACE FUNCTION lerniqa_validate_source_document_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.asset_id IS NOT NULL
        AND NOT lerniqa_asset_reference_is_valid(
            NEW.asset_id,
            ARRAY['source_document']::varchar[],
            false
        ) THEN
        RAISE EXCEPTION '來源文件只能引用 clean 且未刪除的 source_document 檔案'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION lerniqa_validate_revision_source_crop()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.crop_asset_id IS NOT NULL
        AND NOT lerniqa_asset_reference_is_valid(
            NEW.crop_asset_id,
            ARRAY['page_crop']::varchar[],
            false
        ) THEN
        RAISE EXCEPTION '題目來源裁切圖只能引用 clean 且未刪除的 page_crop 檔案'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION lerniqa_validate_answer_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.asset_role = 'handwriting'
        AND NOT lerniqa_asset_reference_is_valid(
            NEW.asset_id,
            ARRAY['handwriting']::varchar[],
            true
        ) THEN
        RAISE EXCEPTION '手寫作答只能引用 clean、未刪除且 private 的 handwriting 檔案'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.asset_role = 'attachment'
        AND NOT lerniqa_asset_reference_is_valid(
            NEW.asset_id,
            ARRAY['answer_attachment']::varchar[],
            true
        ) THEN
        RAISE EXCEPTION '作答附件只能引用 clean、未刪除且 private 的 answer_attachment 檔案'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION lerniqa_validate_asset_reference_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM learners
        WHERE avatar_asset_id = OLD.id
    ) AND (
        NEW.purpose <> 'learner_avatar'
        OR NEW.sensitivity <> 'private'
        OR NEW.scan_status <> 'clean'
        OR NEW.deleted_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION '被學習者代表圖片引用的檔案必須維持有效'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1 FROM source_documents
        WHERE asset_id = OLD.id
    ) AND (
        NEW.purpose <> 'source_document'
        OR NEW.scan_status <> 'clean'
        OR NEW.deleted_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION '被來源文件引用的檔案必須維持有效'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1 FROM question_revision_sources
        WHERE crop_asset_id = OLD.id
    ) AND (
        NEW.purpose <> 'page_crop'
        OR NEW.scan_status <> 'clean'
        OR NEW.deleted_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION '被題目來源裁切引用的檔案必須維持有效'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM question_content_blocks AS block
        WHERE block.asset_id = OLD.id
            AND (
                (block.content_type = 'page_crop' AND NEW.purpose <> 'page_crop')
                OR (block.content_type IN ('image', 'audio') AND NEW.purpose <> 'question_content')
                OR NEW.scan_status <> 'clean'
                OR NEW.deleted_at IS NOT NULL
            )
    ) THEN
        RAISE EXCEPTION '被題目內容引用的檔案必須維持有效'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM answer_part_assets AS answer_asset
        WHERE answer_asset.asset_id = OLD.id
            AND (
                NEW.storage_key IS DISTINCT FROM OLD.storage_key
                OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
                OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
                OR NEW.width IS DISTINCT FROM OLD.width
                OR NEW.height IS DISTINCT FROM OLD.height
                OR NEW.checksum IS DISTINCT FROM OLD.checksum
                OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
                OR NEW.created_at IS DISTINCT FROM OLD.created_at
                OR
                (answer_asset.asset_role = 'handwriting' AND NEW.purpose <> 'handwriting')
                OR (
                    answer_asset.asset_role = 'attachment'
                    AND NEW.purpose <> 'answer_attachment'
                )
                OR NEW.sensitivity <> 'private'
                OR NEW.scan_status <> 'clean'
                OR NEW.deleted_at IS NOT NULL
            )
    ) THEN
        RAISE EXCEPTION '被作答引用的檔案必須維持有效'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER assets_reference_update_check
BEFORE UPDATE OF
    storage_key,
    mime_type,
    byte_size,
    width,
    height,
    checksum,
    purpose,
    sensitivity,
    scan_status,
    created_by_user_id,
    created_at,
    deleted_at
ON assets
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_asset_reference_update();

CREATE TABLE question_similarity_groups (
    id uuid PRIMARY KEY,
    name varchar(160),
    status varchar(20) NOT NULL DEFAULT 'pending',
    created_source varchar(20) NOT NULL,
    method_version varchar(80),
    created_by_user_id uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_by_user_id uuid REFERENCES users(id),
    confirmed_at timestamptz,
    CONSTRAINT question_similarity_groups_status_check
        CHECK (status IN ('pending', 'confirmed', 'inactive')),
    CONSTRAINT question_similarity_groups_source_check
        CHECK (created_source IN ('manual', 'rule', 'ai')),
    CONSTRAINT question_similarity_groups_method_check
        CHECK (created_source = 'manual' OR method_version IS NOT NULL),
    CONSTRAINT question_similarity_groups_confirmation_check
        CHECK (
            (status = 'confirmed' AND confirmed_by_user_id IS NOT NULL AND confirmed_at IS NOT NULL)
            OR (status = 'pending' AND confirmed_by_user_id IS NULL AND confirmed_at IS NULL)
            OR (
                status = 'inactive'
                AND confirmed_by_user_id IS NOT NULL
                AND confirmed_at IS NOT NULL
            )
        )
);

CREATE INDEX question_similarity_groups_status_index
    ON question_similarity_groups(status, created_at DESC);

CREATE TABLE question_similarity_candidates (
    id uuid PRIMARY KEY,
    left_question_revision_id uuid NOT NULL REFERENCES question_revisions(id),
    right_question_revision_id uuid NOT NULL REFERENCES question_revisions(id),
    method_key varchar(80) NOT NULL,
    method_version varchar(80) NOT NULL,
    similarity_score numeric(6,5),
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    status varchar(20) NOT NULL DEFAULT 'pending',
    reviewed_by_user_id uuid REFERENCES users(id),
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT question_similarity_candidates_pair_order_check
        CHECK (left_question_revision_id < right_question_revision_id),
    CONSTRAINT question_similarity_candidates_pair_method_unique
        UNIQUE (
            left_question_revision_id,
            right_question_revision_id,
            method_key,
            method_version
        ),
    CONSTRAINT question_similarity_candidates_score_check
        CHECK (similarity_score IS NULL OR similarity_score BETWEEN 0 AND 1),
    CONSTRAINT question_similarity_candidates_evidence_check
        CHECK (jsonb_typeof(evidence) = 'object'),
    CONSTRAINT question_similarity_candidates_status_check
        CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    CONSTRAINT question_similarity_candidates_review_check
        CHECK (
            (status = 'pending' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
            OR (
                status IN ('approved', 'rejected')
                AND reviewed_by_user_id IS NOT NULL
                AND reviewed_at IS NOT NULL
            )
            OR (
                status = 'expired'
                AND (reviewed_by_user_id IS NULL) = (reviewed_at IS NULL)
            )
        )
);

CREATE INDEX question_similarity_candidates_review_index
    ON question_similarity_candidates(status, similarity_score DESC);

CREATE INDEX question_similarity_candidates_right_revision_index
    ON question_similarity_candidates(right_question_revision_id, status);

CREATE FUNCTION lerniqa_validate_similarity_candidate_questions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM question_revisions AS left_revision
        JOIN question_revisions AS right_revision
            ON right_revision.question_id = left_revision.question_id
        WHERE left_revision.id = NEW.left_question_revision_id
            AND right_revision.id = NEW.right_question_revision_id
    ) THEN
        RAISE EXCEPTION '相近題候選的左右版本必須屬於不同題目'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER question_similarity_candidates_question_check
BEFORE INSERT OR UPDATE OF left_question_revision_id, right_question_revision_id
ON question_similarity_candidates
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_similarity_candidate_questions();

CREATE TABLE question_similarity_memberships (
    similarity_group_id uuid NOT NULL REFERENCES question_similarity_groups(id),
    question_id uuid NOT NULL REFERENCES questions(id),
    based_on_revision_id uuid NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    evidence jsonb,
    confidence numeric(4,3),
    reviewed_by_user_id uuid REFERENCES users(id),
    reviewed_at timestamptz,
    PRIMARY KEY (similarity_group_id, question_id),
    CONSTRAINT question_similarity_memberships_revision_fk
        FOREIGN KEY (based_on_revision_id, question_id)
        REFERENCES question_revisions(id, question_id),
    CONSTRAINT question_similarity_memberships_status_check
        CHECK (status IN ('pending', 'confirmed', 'rejected')),
    CONSTRAINT question_similarity_memberships_evidence_check
        CHECK (evidence IS NULL OR jsonb_typeof(evidence) = 'object'),
    CONSTRAINT question_similarity_memberships_confidence_check
        CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    CONSTRAINT question_similarity_memberships_review_check
        CHECK (
            (status = 'pending' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
            OR (
                status IN ('confirmed', 'rejected')
                AND reviewed_by_user_id IS NOT NULL
                AND reviewed_at IS NOT NULL
            )
        )
);

CREATE INDEX question_similarity_memberships_question_index
    ON question_similarity_memberships(question_id, status);

CREATE FUNCTION lerniqa_validate_similarity_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'confirmed' AND NOT EXISTS (
        SELECT 1
        FROM question_similarity_groups
        WHERE id = NEW.similarity_group_id
            AND status = 'confirmed'
    ) THEN
        RAISE EXCEPTION '已確認的相近題成員必須屬於已確認群組'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER question_similarity_memberships_group_check
BEFORE INSERT OR UPDATE OF similarity_group_id, status ON question_similarity_memberships
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_similarity_membership();

CREATE TABLE question_generation_relations (
    source_question_id uuid NOT NULL REFERENCES questions(id),
    generated_question_id uuid NOT NULL REFERENCES questions(id),
    method_version varchar(80) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source_question_id, generated_question_id),
    CONSTRAINT question_generation_relations_distinct_check
        CHECK (source_question_id <> generated_question_id)
);

-- Similar-review queue rows can now point at a reviewed group. The CHECK
-- constraints keep the discriminator and its one matching foreign key aligned.
ALTER TABLE learner_practice_queue_items
    ADD COLUMN similarity_group_id uuid REFERENCES question_similarity_groups(id),
    DROP CONSTRAINT learner_practice_queue_items_match_basis_check,
    DROP CONSTRAINT learner_practice_queue_items_origin_check,
    ADD CONSTRAINT learner_practice_queue_items_match_basis_check
        CHECK (
            match_basis IS NULL
            OR match_basis IN (
                'confirmed_group',
                'same_topic',
                'same_knowledge_point',
                'same_unit',
                'same_subject'
            )
        ),
    ADD CONSTRAINT learner_practice_queue_items_origin_check
        CHECK (
            (
                reason = 'wrong_review'
                AND source_answer_part_result_id IS NOT NULL
                AND match_basis IS NULL
                AND num_nonnulls(
                    similarity_group_id,
                    matched_topic_id,
                    matched_knowledge_point_id,
                    matched_curriculum_unit_id,
                    matched_subject_id
                ) = 0
            )
            OR (
                reason = 'similar_review'
                AND source_answer_part_result_id IS NOT NULL
                AND (
                    (match_basis = 'confirmed_group' AND similarity_group_id IS NOT NULL)
                    OR (match_basis = 'same_topic' AND matched_topic_id IS NOT NULL)
                    OR (
                        match_basis = 'same_knowledge_point'
                        AND matched_knowledge_point_id IS NOT NULL
                    )
                    OR (match_basis = 'same_unit' AND matched_curriculum_unit_id IS NOT NULL)
                    OR (match_basis = 'same_subject' AND matched_subject_id IS NOT NULL)
                )
                AND num_nonnulls(
                    similarity_group_id,
                    matched_topic_id,
                    matched_knowledge_point_id,
                    matched_curriculum_unit_id,
                    matched_subject_id
                ) = 1
            )
            OR (
                reason IN ('manual', 'legacy_migration')
                AND match_basis IS NULL
                AND num_nonnulls(
                    similarity_group_id,
                    matched_topic_id,
                    matched_knowledge_point_id,
                    matched_curriculum_unit_id,
                    matched_subject_id
                ) = 0
                AND (reason = 'manual' OR source_answer_part_result_id IS NULL)
            )
        );

ALTER TABLE practice_session_item_origins
    ADD COLUMN similarity_group_id uuid REFERENCES question_similarity_groups(id),
    DROP CONSTRAINT practice_session_item_origins_match_basis_check,
    DROP CONSTRAINT practice_session_item_origins_basis_check,
    ADD CONSTRAINT practice_session_item_origins_match_basis_check
        CHECK (
            match_basis IS NULL
            OR match_basis IN (
                'confirmed_group',
                'same_topic',
                'same_knowledge_point',
                'same_unit',
                'same_subject'
            )
        ),
    ADD CONSTRAINT practice_session_item_origins_basis_check
        CHECK (
            (
                relation_kind = 'wrong_review'
                AND match_basis IS NULL
                AND num_nonnulls(
                    similarity_group_id,
                    matched_topic_id,
                    matched_knowledge_point_id,
                    matched_curriculum_unit_id,
                    matched_subject_id
                ) = 0
            )
            OR (
                relation_kind = 'similar_review'
                AND (
                    (match_basis = 'confirmed_group' AND similarity_group_id IS NOT NULL)
                    OR (match_basis = 'same_topic' AND matched_topic_id IS NOT NULL)
                    OR (
                        match_basis = 'same_knowledge_point'
                        AND matched_knowledge_point_id IS NOT NULL
                    )
                    OR (match_basis = 'same_unit' AND matched_curriculum_unit_id IS NOT NULL)
                    OR (match_basis = 'same_subject' AND matched_subject_id IS NOT NULL)
                )
                AND num_nonnulls(
                    similarity_group_id,
                    matched_topic_id,
                    matched_knowledge_point_id,
                    matched_curriculum_unit_id,
                    matched_subject_id
                ) = 1
            )
        );

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM practice_session_item_origins
        WHERE queue_item_id IS NOT NULL
        GROUP BY queue_item_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'an existing queue item is referenced by multiple session origins'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE UNIQUE INDEX practice_session_item_origins_queue_unique
    ON practice_session_item_origins(queue_item_id)
    WHERE queue_item_id IS NOT NULL;

-- Normalize the legacy state that 0004 allowed: an origin could exist while
-- its queue row was still pending and its session item used a non-origin reason.
-- The relation itself is authoritative, so this is a deterministic status and
-- discriminator backfill rather than fabricated provenance.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM practice_session_item_origins AS origin
        JOIN learner_practice_queue_items AS queue
            ON queue.id = origin.queue_item_id
        WHERE queue.status = 'removed'
    ) THEN
        RAISE EXCEPTION 'a removed queue item is already referenced by a session origin'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM practice_session_item_origins
        GROUP BY practice_session_item_id
        HAVING count(DISTINCT relation_kind) > 1
    ) THEN
        RAISE EXCEPTION 'one session item has conflicting origin relation kinds'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM practice_session_item_origins AS origin
        JOIN practice_session_items AS item
            ON item.id = origin.practice_session_item_id
        JOIN practice_sessions AS session
            ON session.id = item.practice_session_id
        JOIN answer_part_results AS result
            ON result.id = origin.source_answer_part_result_id
        JOIN answer_attempts AS attempt
            ON attempt.id = result.answer_attempt_id
        LEFT JOIN learner_practice_queue_items AS queue
            ON queue.id = origin.queue_item_id
        WHERE session.learner_id IS DISTINCT FROM attempt.learner_id
            OR (
                origin.relation_kind = 'wrong_review'
                AND (
                    item.question_id IS DISTINCT FROM (
                        SELECT source_item.question_id
                        FROM practice_session_items AS source_item
                        WHERE source_item.id = attempt.practice_session_item_id
                    )
                    OR item.question_revision_id IS DISTINCT FROM (
                        SELECT source_item.question_revision_id
                        FROM practice_session_items AS source_item
                        WHERE source_item.id = attempt.practice_session_item_id
                    )
                    OR item.question_part_id IS DISTINCT FROM result.question_part_id
                )
            )
            OR (
                origin.queue_item_id IS NOT NULL
                AND (
                    queue.id IS NULL
                    OR queue.learner_id IS DISTINCT FROM session.learner_id
                    OR queue.source_answer_part_result_id
                        IS DISTINCT FROM origin.source_answer_part_result_id
                    OR queue.reason IS DISTINCT FROM origin.relation_kind
                    OR queue.question_id IS DISTINCT FROM item.question_id
                    OR queue.question_revision_id IS DISTINCT FROM item.question_revision_id
                    OR queue.question_part_id IS DISTINCT FROM item.question_part_id
                    OR queue.match_basis IS DISTINCT FROM origin.match_basis
                    OR queue.similarity_group_id IS DISTINCT FROM origin.similarity_group_id
                    OR queue.matched_topic_id IS DISTINCT FROM origin.matched_topic_id
                    OR queue.matched_knowledge_point_id
                        IS DISTINCT FROM origin.matched_knowledge_point_id
                    OR queue.matched_curriculum_unit_id
                        IS DISTINCT FROM origin.matched_curriculum_unit_id
                    OR queue.matched_subject_id IS DISTINCT FROM origin.matched_subject_id
                )
            )
    ) THEN
        RAISE EXCEPTION 'existing session origin provenance is internally inconsistent'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

UPDATE learner_practice_queue_items AS queue
SET status = 'consumed',
    consumed_at = origin.created_at
FROM practice_session_item_origins AS origin
WHERE origin.queue_item_id = queue.id
    AND queue.status = 'pending';

UPDATE practice_session_items AS item
SET selection_reason = origin.relation_kind
FROM (
    SELECT practice_session_item_id, min(relation_kind) AS relation_kind
    FROM practice_session_item_origins
    GROUP BY practice_session_item_id
) AS origin
WHERE origin.practice_session_item_id = item.id
    AND item.selection_reason IS DISTINCT FROM origin.relation_kind;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM learner_practice_queue_items AS queue
        WHERE queue.status = 'consumed'
            AND queue.reason IN ('wrong_review', 'similar_review')
            AND NOT EXISTS (
                SELECT 1
                FROM practice_session_item_origins AS origin
                WHERE origin.queue_item_id = queue.id
            )
    ) THEN
        RAISE EXCEPTION 'an existing consumed review queue item has no session origin'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_similarity_match_is_valid(
    source_result_id uuid,
    target_question_id uuid,
    target_revision_id uuid,
    selected_match_basis varchar,
    selected_similarity_group_id uuid,
    selected_topic_id uuid,
    selected_knowledge_point_id uuid,
    selected_curriculum_unit_id uuid,
    selected_subject_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    source_question_id uuid;
    source_revision_id uuid;
    source_current_result varchar(20);
BEGIN
    SELECT item.question_id, item.question_revision_id, result.current_result
    INTO source_question_id, source_revision_id, source_current_result
    FROM answer_part_results AS result
    JOIN answer_attempts AS attempt ON attempt.id = result.answer_attempt_id
    JOIN practice_session_items AS item ON item.id = attempt.practice_session_item_id
    WHERE result.id = source_result_id;

    IF source_question_id IS NULL OR source_current_result <> 'wrong' THEN
        RETURN false;
    END IF;

    CASE selected_match_basis
        WHEN 'confirmed_group' THEN
            RETURN selected_similarity_group_id IS NOT NULL
                AND EXISTS (
                    SELECT 1
                    FROM question_similarity_groups AS similarity_group
                    WHERE similarity_group.id = selected_similarity_group_id
                        AND similarity_group.status = 'confirmed'
                )
                AND EXISTS (
                    SELECT 1
                    FROM question_similarity_memberships AS membership
                    WHERE membership.similarity_group_id = selected_similarity_group_id
                        AND membership.question_id = source_question_id
                        AND membership.based_on_revision_id = source_revision_id
                        AND membership.status = 'confirmed'
                )
                AND EXISTS (
                    SELECT 1
                    FROM question_similarity_memberships AS membership
                    WHERE membership.similarity_group_id = selected_similarity_group_id
                        AND membership.question_id = target_question_id
                        AND membership.based_on_revision_id = target_revision_id
                        AND membership.status = 'confirmed'
                );

        WHEN 'same_topic' THEN
            RETURN selected_topic_id IS NOT NULL
                AND EXISTS (
                    SELECT 1 FROM question_revision_topics
                    WHERE question_revision_id = source_revision_id
                        AND topic_id = selected_topic_id
                )
                AND EXISTS (
                    SELECT 1 FROM question_revision_topics
                    WHERE question_revision_id = target_revision_id
                        AND topic_id = selected_topic_id
                );

        WHEN 'same_knowledge_point' THEN
            RETURN selected_knowledge_point_id IS NOT NULL
                AND EXISTS (
                    SELECT 1 FROM question_revision_knowledge_points
                    WHERE question_revision_id = source_revision_id
                        AND knowledge_point_id = selected_knowledge_point_id
                )
                AND EXISTS (
                    SELECT 1 FROM question_revision_knowledge_points
                    WHERE question_revision_id = target_revision_id
                        AND knowledge_point_id = selected_knowledge_point_id
                );

        WHEN 'same_unit' THEN
            RETURN selected_curriculum_unit_id IS NOT NULL
                AND EXISTS (
                    SELECT 1 FROM question_revision_units
                    WHERE question_revision_id = source_revision_id
                        AND curriculum_unit_id = selected_curriculum_unit_id
                )
                AND EXISTS (
                    SELECT 1 FROM question_revision_units
                    WHERE question_revision_id = target_revision_id
                        AND curriculum_unit_id = selected_curriculum_unit_id
                );

        WHEN 'same_subject' THEN
            RETURN selected_subject_id IS NOT NULL
                AND EXISTS (
                    SELECT 1 FROM question_revisions
                    WHERE id = source_revision_id
                        AND subject_id = selected_subject_id
                )
                AND EXISTS (
                    SELECT 1 FROM question_revisions
                    WHERE id = target_revision_id
                        AND question_id = target_question_id
                        AND subject_id = selected_subject_id
                );

        ELSE
            RETURN false;
    END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION lerniqa_validate_queue_item_learner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.source_answer_part_result_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM answer_part_results AS result
        JOIN answer_attempts AS attempt ON attempt.id = result.answer_attempt_id
        WHERE result.id = NEW.source_answer_part_result_id
            AND attempt.learner_id = NEW.learner_id
    ) THEN
        RAISE EXCEPTION '後續練習來源作答必須屬於同一學習者'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.reason = 'wrong_review' AND NOT EXISTS (
        SELECT 1
        FROM answer_part_results AS result
        JOIN answer_attempts AS attempt ON attempt.id = result.answer_attempt_id
        JOIN practice_session_items AS item ON item.id = attempt.practice_session_item_id
        WHERE result.id = NEW.source_answer_part_result_id
            AND result.current_result = 'wrong'
            AND item.question_id = NEW.question_id
            AND item.question_revision_id = NEW.question_revision_id
            AND result.question_part_id = NEW.question_part_id
    ) THEN
        RAISE EXCEPTION '錯題複習目標必須等於來源答錯的小題與固定版本'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.reason = 'similar_review'
        AND NOT lerniqa_similarity_match_is_valid(
            NEW.source_answer_part_result_id,
            NEW.question_id,
            NEW.question_revision_id,
            NEW.match_basis,
            NEW.similarity_group_id,
            NEW.matched_topic_id,
            NEW.matched_knowledge_point_id,
            NEW.matched_curriculum_unit_id,
            NEW.matched_subject_id
        ) THEN
        RAISE EXCEPTION '相近題複習依據必須同時符合來源與目標的實際分類或已確認群組'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER learner_practice_queue_items_learner_check
    ON learner_practice_queue_items;

CREATE TRIGGER learner_practice_queue_items_learner_check
BEFORE INSERT OR UPDATE OF
    learner_id,
    question_id,
    question_revision_id,
    question_part_id,
    reason,
    source_answer_part_result_id,
    match_basis,
    similarity_group_id,
    matched_topic_id,
    matched_knowledge_point_id,
    matched_curriculum_unit_id,
    matched_subject_id
ON learner_practice_queue_items
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_queue_item_learner();

CREATE OR REPLACE FUNCTION lerniqa_validate_answer_attempt_learner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM 1
    FROM practice_session_items AS item
    JOIN practice_sessions AS session ON session.id = item.practice_session_id
    WHERE item.id = NEW.practice_session_item_id
        AND session.learner_id = NEW.learner_id
    FOR SHARE OF item, session;

    IF NOT FOUND THEN
        RAISE EXCEPTION '作答學習者必須與練習工作階段相同'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

-- 0004 validated provenance only when an answer was written. Refuse an
-- upgrade if a session or item was subsequently moved and now contradicts
-- its durable answer history.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM answer_attempts AS attempt
        JOIN practice_session_items AS item
            ON item.id = attempt.practice_session_item_id
        JOIN practice_sessions AS session
            ON session.id = item.practice_session_id
        WHERE attempt.learner_id IS DISTINCT FROM session.learner_id
            OR EXISTS (
                SELECT 1
                FROM answer_part_results AS result
                JOIN question_parts AS part ON part.id = result.question_part_id
                WHERE result.answer_attempt_id = attempt.id
                    AND (
                        part.question_revision_id IS DISTINCT FROM item.question_revision_id
                        OR (
                            item.question_part_id IS NOT NULL
                            AND result.question_part_id IS DISTINCT FROM item.question_part_id
                        )
                    )
            )
    ) THEN
        RAISE EXCEPTION 'existing answer history conflicts with its practice session provenance'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_protect_consumed_practice_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_TABLE_NAME = 'learner_practice_queue_items' THEN
        IF EXISTS (
            SELECT 1
            FROM practice_session_item_origins
            WHERE queue_item_id = OLD.id
        ) AND (
            NEW.learner_id IS DISTINCT FROM OLD.learner_id
            OR NEW.question_id IS DISTINCT FROM OLD.question_id
            OR NEW.question_revision_id IS DISTINCT FROM OLD.question_revision_id
            OR NEW.question_part_id IS DISTINCT FROM OLD.question_part_id
            OR NEW.reason IS DISTINCT FROM OLD.reason
            OR NEW.source_answer_part_result_id IS DISTINCT FROM OLD.source_answer_part_result_id
            OR NEW.match_basis IS DISTINCT FROM OLD.match_basis
            OR NEW.similarity_group_id IS DISTINCT FROM OLD.similarity_group_id
            OR NEW.matched_topic_id IS DISTINCT FROM OLD.matched_topic_id
            OR NEW.matched_knowledge_point_id IS DISTINCT FROM OLD.matched_knowledge_point_id
            OR NEW.matched_curriculum_unit_id IS DISTINCT FROM OLD.matched_curriculum_unit_id
            OR NEW.matched_subject_id IS DISTINCT FROM OLD.matched_subject_id
            OR NEW.status IS DISTINCT FROM OLD.status
            OR NEW.consumed_at IS DISTINCT FROM OLD.consumed_at
        ) THEN
            RAISE EXCEPTION '已建立練習來源的佇列追溯欄位不可覆寫'
                USING ERRCODE = '23514';
        END IF;
    ELSIF TG_TABLE_NAME = 'practice_session_items' THEN
        IF (
            EXISTS (
                SELECT 1
                FROM practice_session_item_origins
                WHERE practice_session_item_id = OLD.id
            )
            OR EXISTS (
                SELECT 1
                FROM answer_attempts
                WHERE practice_session_item_id = OLD.id
            )
        ) AND (
            NEW.practice_session_id IS DISTINCT FROM OLD.practice_session_id
            OR
            NEW.question_id IS DISTINCT FROM OLD.question_id
            OR NEW.question_revision_id IS DISTINCT FROM OLD.question_revision_id
            OR NEW.question_part_id IS DISTINCT FROM OLD.question_part_id
            OR NEW.selection_reason IS DISTINCT FROM OLD.selection_reason
        ) THEN
            RAISE EXCEPTION '已有來源追溯的練習項目不可改寫題目或選入原因'
                USING ERRCODE = '23514';
        END IF;
    ELSIF TG_TABLE_NAME = 'practice_sessions' THEN
        IF NEW.learner_id IS DISTINCT FROM OLD.learner_id
            AND EXISTS (
                SELECT 1
                FROM practice_session_items AS item
                WHERE item.practice_session_id = OLD.id
                    AND (
                        EXISTS (
                            SELECT 1
                            FROM practice_session_item_origins AS origin
                            WHERE origin.practice_session_item_id = item.id
                        )
                        OR EXISTS (
                            SELECT 1
                            FROM answer_attempts AS attempt
                            WHERE attempt.practice_session_item_id = item.id
                        )
                    )
            ) THEN
            RAISE EXCEPTION '已有來源追溯或作答的練習工作階段不可改換學習者'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER learner_practice_queue_items_provenance_immutable
BEFORE UPDATE ON learner_practice_queue_items
FOR EACH ROW
EXECUTE FUNCTION lerniqa_protect_consumed_practice_provenance();

CREATE TRIGGER practice_session_items_provenance_immutable
BEFORE UPDATE OF
    practice_session_id,
    question_id,
    question_revision_id,
    question_part_id,
    selection_reason
ON practice_session_items
FOR EACH ROW
EXECUTE FUNCTION lerniqa_protect_consumed_practice_provenance();

CREATE TRIGGER practice_sessions_provenance_immutable
BEFORE UPDATE OF learner_id ON practice_sessions
FOR EACH ROW
EXECUTE FUNCTION lerniqa_protect_consumed_practice_provenance();

CREATE OR REPLACE FUNCTION lerniqa_validate_session_item_origin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    session_learner_id uuid;
    item_question_id uuid;
    item_revision_id uuid;
    item_part_id uuid;
    item_selection_reason varchar(30);
    source_learner_id uuid;
    source_result varchar(20);
    source_question_id uuid;
    source_revision_id uuid;
    source_part_id uuid;
    queue_row learner_practice_queue_items%ROWTYPE;
BEGIN
    SELECT
        session.learner_id,
        item.question_id,
        item.question_revision_id,
        item.question_part_id,
        item.selection_reason
    INTO
        session_learner_id,
        item_question_id,
        item_revision_id,
        item_part_id,
        item_selection_reason
    FROM practice_session_items AS item
    JOIN practice_sessions AS session ON session.id = item.practice_session_id
    WHERE item.id = NEW.practice_session_item_id;

    SELECT
        attempt.learner_id,
        result.current_result,
        source_item.question_id,
        source_item.question_revision_id,
        result.question_part_id
    INTO
        source_learner_id,
        source_result,
        source_question_id,
        source_revision_id,
        source_part_id
    FROM answer_part_results AS result
    JOIN answer_attempts AS attempt ON attempt.id = result.answer_attempt_id
    JOIN practice_session_items AS source_item
        ON source_item.id = attempt.practice_session_item_id
    WHERE result.id = NEW.source_answer_part_result_id;

    IF session_learner_id IS DISTINCT FROM source_learner_id THEN
        RAISE EXCEPTION '練習來源作答必須屬於同一學習者'
            USING ERRCODE = '23514';
    END IF;

    IF item_selection_reason IS DISTINCT FROM NEW.relation_kind THEN
        RAISE EXCEPTION '練習項目的選入原因必須與來源追溯關係一致'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.relation_kind = 'wrong_review' AND (
        source_result IS DISTINCT FROM 'wrong'
        OR item_question_id IS DISTINCT FROM source_question_id
        OR item_revision_id IS DISTINCT FROM source_revision_id
        OR item_part_id IS DISTINCT FROM source_part_id
    ) THEN
        RAISE EXCEPTION '錯題練習來源與練習項目的題目、版本或小題不一致'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.relation_kind = 'similar_review'
        AND NOT lerniqa_similarity_match_is_valid(
            NEW.source_answer_part_result_id,
            item_question_id,
            item_revision_id,
            NEW.match_basis,
            NEW.similarity_group_id,
            NEW.matched_topic_id,
            NEW.matched_knowledge_point_id,
            NEW.matched_curriculum_unit_id,
            NEW.matched_subject_id
        ) THEN
        RAISE EXCEPTION '相近題練習來源與練習項目的比對依據不成立'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.queue_item_id IS NOT NULL THEN
        SELECT *
        INTO queue_row
        FROM learner_practice_queue_items
        WHERE id = NEW.queue_item_id;

        IF NOT FOUND
            OR queue_row.learner_id IS DISTINCT FROM session_learner_id
            OR queue_row.status <> 'consumed'
            OR queue_row.consumed_at IS NULL
            OR queue_row.source_answer_part_result_id IS DISTINCT FROM NEW.source_answer_part_result_id
            OR queue_row.reason IS DISTINCT FROM NEW.relation_kind
            OR queue_row.question_id IS DISTINCT FROM item_question_id
            OR queue_row.question_revision_id IS DISTINCT FROM item_revision_id
            OR queue_row.question_part_id IS DISTINCT FROM item_part_id
            OR queue_row.match_basis IS DISTINCT FROM NEW.match_basis
            OR queue_row.similarity_group_id IS DISTINCT FROM NEW.similarity_group_id
            OR queue_row.matched_topic_id IS DISTINCT FROM NEW.matched_topic_id
            OR queue_row.matched_knowledge_point_id IS DISTINCT FROM NEW.matched_knowledge_point_id
            OR queue_row.matched_curriculum_unit_id IS DISTINCT FROM NEW.matched_curriculum_unit_id
            OR queue_row.matched_subject_id IS DISTINCT FROM NEW.matched_subject_id THEN
            RAISE EXCEPTION '練習來源與消耗的後續練習項目不一致'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER practice_session_item_origins_consistency_check
    ON practice_session_item_origins;

CREATE TRIGGER practice_session_item_origins_consistency_check
BEFORE INSERT ON practice_session_item_origins
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_session_item_origin();

CREATE FUNCTION lerniqa_validate_consumed_queue_origin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM learner_practice_queue_items AS queue
        WHERE queue.id = NEW.id
            AND queue.status = 'consumed'
            AND queue.reason IN ('wrong_review', 'similar_review')
            AND NOT EXISTS (
                SELECT 1
                FROM practice_session_item_origins AS origin
                WHERE origin.queue_item_id = queue.id
            )
    ) THEN
        RAISE EXCEPTION '已消耗的錯題或相近題佇列項目必須有唯一來源追溯'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER learner_practice_queue_items_consumed_origin_check
AFTER INSERT OR UPDATE ON learner_practice_queue_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_consumed_queue_origin();

CREATE FUNCTION lerniqa_reject_origin_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '練習來源追溯是 append-only，不可修改或刪除'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER practice_session_item_origins_append_only
BEFORE UPDATE OR DELETE ON practice_session_item_origins
FOR EACH ROW
EXECUTE FUNCTION lerniqa_reject_origin_mutation();

CREATE TABLE learner_question_stats (
    learner_id uuid NOT NULL REFERENCES learners(id),
    question_id uuid NOT NULL REFERENCES questions(id),
    total_attempts integer NOT NULL DEFAULT 0,
    graded_attempts integer NOT NULL DEFAULT 0,
    correct_attempts integer NOT NULL DEFAULT 0,
    wrong_attempts integer NOT NULL DEFAULT 0,
    pending_attempts integer NOT NULL DEFAULT 0,
    first_attempted_at timestamptz,
    last_attempted_at timestamptz,
    last_result varchar(20),
    last_revision_id uuid,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (learner_id, question_id),
    CONSTRAINT learner_question_stats_last_revision_fk
        FOREIGN KEY (last_revision_id, question_id)
        REFERENCES question_revisions(id, question_id),
    CONSTRAINT learner_question_stats_counts_check
        CHECK (
            total_attempts >= 0
            AND graded_attempts >= 0
            AND correct_attempts >= 0
            AND wrong_attempts >= 0
            AND pending_attempts >= 0
            AND graded_attempts = correct_attempts + wrong_attempts
            AND total_attempts = graded_attempts + pending_attempts
        ),
    CONSTRAINT learner_question_stats_last_result_check
        CHECK (last_result IS NULL OR last_result IN ('correct', 'wrong', 'pending')),
    CONSTRAINT learner_question_stats_attempt_time_check
        CHECK (
            (
                total_attempts = 0
                AND first_attempted_at IS NULL
                AND last_attempted_at IS NULL
                AND last_result IS NULL
                AND last_revision_id IS NULL
            )
            OR (
                total_attempts > 0
                AND first_attempted_at IS NOT NULL
                AND last_attempted_at IS NOT NULL
                AND first_attempted_at <= last_attempted_at
                AND last_result IS NOT NULL
                AND last_revision_id IS NOT NULL
            )
        )
);

CREATE INDEX learner_question_stats_recent_wrong_index
    ON learner_question_stats(learner_id, last_result, last_attempted_at DESC);

CREATE TABLE learner_part_stats (
    learner_id uuid NOT NULL REFERENCES learners(id),
    question_part_id uuid NOT NULL REFERENCES question_parts(id),
    total_attempts integer NOT NULL DEFAULT 0,
    correct_attempts integer NOT NULL DEFAULT 0,
    wrong_attempts integer NOT NULL DEFAULT 0,
    pending_attempts integer NOT NULL DEFAULT 0,
    last_result varchar(20),
    last_attempted_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (learner_id, question_part_id),
    CONSTRAINT learner_part_stats_counts_check
        CHECK (
            total_attempts >= 0
            AND correct_attempts >= 0
            AND wrong_attempts >= 0
            AND pending_attempts >= 0
            AND total_attempts = correct_attempts + wrong_attempts + pending_attempts
        ),
    CONSTRAINT learner_part_stats_last_result_check
        CHECK (last_result IS NULL OR last_result IN ('correct', 'wrong', 'pending')),
    CONSTRAINT learner_part_stats_attempt_time_check
        CHECK (
            (total_attempts = 0 AND last_result IS NULL AND last_attempted_at IS NULL)
            OR (total_attempts > 0 AND last_result IS NOT NULL AND last_attempted_at IS NOT NULL)
        )
);

CREATE INDEX learner_part_stats_recent_wrong_index
    ON learner_part_stats(learner_id, last_result, last_attempted_at DESC);

CREATE TABLE learner_similarity_group_stats (
    learner_id uuid NOT NULL REFERENCES learners(id),
    similarity_group_id uuid NOT NULL REFERENCES question_similarity_groups(id),
    attempted_question_count integer NOT NULL DEFAULT 0,
    correct_question_count integer NOT NULL DEFAULT 0,
    wrong_question_count integer NOT NULL DEFAULT 0,
    is_mastered boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (learner_id, similarity_group_id),
    CONSTRAINT learner_similarity_group_stats_counts_check
        CHECK (
            attempted_question_count >= 0
            AND correct_question_count >= 0
            AND wrong_question_count >= 0
            AND correct_question_count + wrong_question_count <= attempted_question_count
        ),
    CONSTRAINT learner_similarity_group_stats_mastery_check
        CHECK (is_mastered = (correct_question_count >= 2))
);

CREATE FUNCTION lerniqa_validate_similarity_group_stats_group()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM question_similarity_groups
        WHERE id = NEW.similarity_group_id
            AND status = 'confirmed'
    ) THEN
        RAISE EXCEPTION '相近題掌握統計只能引用當下已確認的相近題群組'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER learner_similarity_group_stats_group_check
BEFORE INSERT OR UPDATE OF similarity_group_id ON learner_similarity_group_stats
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_similarity_group_stats_group();

CREATE TABLE learner_daily_stats (
    stat_date date NOT NULL,
    learner_id uuid NOT NULL REFERENCES learners(id),
    session_count integer NOT NULL DEFAULT 0,
    attempt_count integer NOT NULL DEFAULT 0,
    correct_part_count integer NOT NULL DEFAULT 0,
    wrong_part_count integer NOT NULL DEFAULT 0,
    pending_part_count integer NOT NULL DEFAULT 0,
    total_duration_seconds bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (stat_date, learner_id),
    CONSTRAINT learner_daily_stats_counts_check
        CHECK (
            session_count >= 0
            AND attempt_count >= 0
            AND correct_part_count >= 0
            AND wrong_part_count >= 0
            AND pending_part_count >= 0
            AND total_duration_seconds >= 0
        )
);

CREATE TABLE question_daily_stats (
    stat_date date NOT NULL,
    question_id uuid NOT NULL REFERENCES questions(id),
    question_revision_id uuid NOT NULL,
    total_attempts integer NOT NULL DEFAULT 0,
    unique_learner_count integer NOT NULL DEFAULT 0,
    wrong_learner_count integer NOT NULL DEFAULT 0,
    correct_attempts integer NOT NULL DEFAULT 0,
    wrong_attempts integer NOT NULL DEFAULT 0,
    pending_attempts integer NOT NULL DEFAULT 0,
    total_duration_seconds bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (stat_date, question_revision_id),
    CONSTRAINT question_daily_stats_revision_fk
        FOREIGN KEY (question_revision_id, question_id)
        REFERENCES question_revisions(id, question_id),
    CONSTRAINT question_daily_stats_counts_check
        CHECK (
            total_attempts >= 0
            AND unique_learner_count >= 0
            AND wrong_learner_count >= 0
            AND correct_attempts >= 0
            AND wrong_attempts >= 0
            AND pending_attempts >= 0
            AND total_duration_seconds >= 0
            AND total_attempts = correct_attempts + wrong_attempts + pending_attempts
            AND wrong_learner_count <= unique_learner_count
            AND unique_learner_count <= total_attempts
            AND wrong_learner_count <= wrong_attempts
        )
);

CREATE INDEX question_daily_stats_wrong_attempts_index
    ON question_daily_stats(stat_date, wrong_attempts DESC);

CREATE INDEX question_daily_stats_wrong_learners_index
    ON question_daily_stats(stat_date, wrong_learner_count DESC);

CREATE TABLE analytics_privacy_policies (
    id uuid PRIMARY KEY,
    policy_key varchar(80) NOT NULL,
    aggregation_scope varchar(30) NOT NULL,
    min_distinct_learners smallint NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'draft',
    effective_at timestamptz,
    created_by_user_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT analytics_privacy_policies_scope_check
        CHECK (aggregation_scope = 'platform'),
    CONSTRAINT analytics_privacy_policies_threshold_check
        CHECK (min_distinct_learners > 1),
    CONSTRAINT analytics_privacy_policies_status_check
        CHECK (status IN ('draft', 'active', 'retired')),
    CONSTRAINT analytics_privacy_policies_effective_check
        CHECK (status <> 'active' OR effective_at IS NOT NULL)
);

CREATE UNIQUE INDEX analytics_privacy_policies_active_unique
    ON analytics_privacy_policies(policy_key)
    WHERE status = 'active';

CREATE FUNCTION lerniqa_validate_privacy_policy_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('active', 'retired') THEN
            RAISE EXCEPTION '已生效或停用的統計隱私政策不可刪除'
                USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.status IN ('active', 'retired') AND (
        NEW.id IS DISTINCT FROM OLD.id
        OR NEW.policy_key IS DISTINCT FROM OLD.policy_key
        OR NEW.aggregation_scope IS DISTINCT FROM OLD.aggregation_scope
        OR NEW.min_distinct_learners IS DISTINCT FROM OLD.min_distinct_learners
        OR NEW.effective_at IS DISTINCT FROM OLD.effective_at
        OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR (
            OLD.status = 'active'
            AND NEW.status NOT IN ('active', 'retired')
        )
        OR (OLD.status = 'retired' AND NEW.status <> 'retired')
    ) THEN
        RAISE EXCEPTION '已生效政策只能由 active 轉為 retired；門檻變更必須建立新版本'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER analytics_privacy_policies_version_check
BEFORE UPDATE OR DELETE ON analytics_privacy_policies
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_privacy_policy_version();

CREATE TABLE analytics_outbox (
    id uuid PRIMARY KEY,
    event_type varchar(60) NOT NULL,
    source_record_id uuid NOT NULL,
    aggregate_key varchar(240) NOT NULL,
    occurred_at timestamptz NOT NULL,
    processed_at timestamptz,
    retry_count integer NOT NULL DEFAULT 0,
    last_error text,
    CONSTRAINT analytics_outbox_source_unique UNIQUE (event_type, source_record_id),
    CONSTRAINT analytics_outbox_retry_count_check CHECK (retry_count >= 0)
);

CREATE INDEX analytics_outbox_processing_index
    ON analytics_outbox(processed_at, occurred_at);

CREATE FUNCTION lerniqa_validate_analytics_outbox_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.event_type = 'answer_reviewed' THEN
            NEW.occurred_at := transaction_timestamp();
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.event_type IS DISTINCT FROM OLD.event_type
        OR NEW.source_record_id IS DISTINCT FROM OLD.source_record_id
        OR NEW.aggregate_key IS DISTINCT FROM OLD.aggregate_key
        OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at THEN
        RAISE EXCEPTION '統計 outbox 的事件身份與發生時間不可覆寫'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER analytics_outbox_history_check
BEFORE INSERT OR UPDATE ON analytics_outbox
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_analytics_outbox_history();

CREATE TABLE analytics_jobs (
    id uuid PRIMARY KEY,
    job_type varchar(30) NOT NULL,
    range_start date,
    range_end date,
    status varchar(20) NOT NULL DEFAULT 'queued',
    cursor jsonb,
    aggregation_version varchar(60) NOT NULL,
    started_at timestamptz,
    completed_at timestamptz,
    last_error text,
    CONSTRAINT analytics_jobs_type_check
        CHECK (job_type IN ('full_rebuild', 'date_range', 'refresh_view')),
    CONSTRAINT analytics_jobs_range_check
        CHECK (
            (
                job_type = 'date_range'
                AND range_start IS NOT NULL
                AND range_end IS NOT NULL
                AND range_end >= range_start
            )
            OR (
                job_type <> 'date_range'
                AND range_start IS NULL
                AND range_end IS NULL
            )
        ),
    CONSTRAINT analytics_jobs_status_check
        CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    CONSTRAINT analytics_jobs_cursor_check
        CHECK (cursor IS NULL OR jsonb_typeof(cursor) = 'object'),
    CONSTRAINT analytics_jobs_timing_check
        CHECK (
            (status = 'queued' AND started_at IS NULL AND completed_at IS NULL)
            OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL)
            OR (
                status IN ('completed', 'failed')
                AND started_at IS NOT NULL
                AND completed_at IS NOT NULL
                AND completed_at >= started_at
            )
        )
);

CREATE TABLE admin_audit_logs (
    id uuid PRIMARY KEY,
    actor_type varchar(30) NOT NULL,
    actor_user_id uuid REFERENCES users(id),
    action varchar(80) NOT NULL,
    target_type varchar(60) NOT NULL,
    target_id uuid,
    before_data jsonb,
    after_data jsonb,
    request_id varchar(120) NOT NULL,
    source_ip inet,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT admin_audit_logs_actor_check
        CHECK (
            (actor_type = 'user' AND actor_user_id IS NOT NULL)
            OR (
                actor_type IN ('bootstrap_admin', 'system_job')
                AND actor_user_id IS NULL
            )
        ),
    CONSTRAINT admin_audit_logs_before_data_check
        CHECK (before_data IS NULL OR jsonb_typeof(before_data) = 'object'),
    CONSTRAINT admin_audit_logs_after_data_check
        CHECK (after_data IS NULL OR jsonb_typeof(after_data) = 'object')
);

CREATE INDEX admin_audit_logs_target_index
    ON admin_audit_logs(target_type, target_id, created_at DESC);

CREATE INDEX admin_audit_logs_actor_index
    ON admin_audit_logs(actor_user_id, created_at DESC);

CREATE TABLE data_erasure_requests (
    id uuid PRIMARY KEY,
    requested_by_user_id uuid NOT NULL REFERENCES users(id),
    target_user_id uuid REFERENCES users(id),
    target_learner_id uuid REFERENCES learners(id),
    request_type varchar(30) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    reviewed_by_user_id uuid REFERENCES users(id),
    decision_reason text,
    result_summary jsonb,
    requested_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamptz,
    CONSTRAINT data_erasure_requests_target_check
        CHECK (num_nonnulls(target_user_id, target_learner_id) >= 1),
    CONSTRAINT data_erasure_requests_type_check
        CHECK (request_type IN ('account_closure', 'learner_erasure', 'asset_erasure')),
    CONSTRAINT data_erasure_requests_status_check
        CHECK (status IN ('pending', 'approved', 'processing', 'completed', 'rejected')),
    CONSTRAINT data_erasure_requests_review_check
        CHECK (
            (status = 'pending' AND reviewed_by_user_id IS NULL)
            OR (status <> 'pending' AND reviewed_by_user_id IS NOT NULL)
        ),
    CONSTRAINT data_erasure_requests_rejection_check
        CHECK (status <> 'rejected' OR decision_reason IS NOT NULL),
    CONSTRAINT data_erasure_requests_completion_check
        CHECK (
            (
                status = 'completed'
                AND completed_at IS NOT NULL
                AND completed_at >= requested_at
                AND result_summary IS NOT NULL
            )
            OR (status <> 'completed' AND completed_at IS NULL)
        ),
    CONSTRAINT data_erasure_requests_result_check
        CHECK (result_summary IS NULL OR jsonb_typeof(result_summary) = 'object')
);

CREATE INDEX data_erasure_requests_status_index
    ON data_erasure_requests(status, requested_at);

CREATE INDEX data_erasure_requests_target_user_index
    ON data_erasure_requests(target_user_id);

CREATE INDEX data_erasure_requests_target_learner_index
    ON data_erasure_requests(target_learner_id);

CREATE FUNCTION lerniqa_user_is_system_admin(candidate_user_id uuid)
RETURNS boolean
LANGUAGE sql
VOLATILE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM user_roles AS role
        JOIN users AS app_user ON app_user.id = role.user_id
        WHERE role.user_id = candidate_user_id
            AND role.role = 'system_admin'
            AND role.revoked_at IS NULL
            AND app_user.status = 'active'
    );
$$;

CREATE FUNCTION lerniqa_validate_privileged_record_actor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    privileged_user_id uuid;
BEGIN
    CASE TG_TABLE_NAME
        WHEN 'analytics_privacy_policies' THEN
            privileged_user_id := NEW.created_by_user_id;
        WHEN 'admin_audit_logs' THEN
            IF NEW.actor_type <> 'user' THEN
                RETURN NEW;
            END IF;
            privileged_user_id := NEW.actor_user_id;
        WHEN 'data_erasure_requests' THEN
            IF NEW.reviewed_by_user_id IS NULL THEN
                RETURN NEW;
            END IF;
            privileged_user_id := NEW.reviewed_by_user_id;
        ELSE
            RAISE EXCEPTION 'unsupported privileged record table: %', TG_TABLE_NAME;
    END CASE;

    IF NOT lerniqa_user_is_system_admin(privileged_user_id) THEN
        RAISE EXCEPTION '% requires an active system_admin user', TG_TABLE_NAME
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER analytics_privacy_policies_admin_check
BEFORE INSERT OR UPDATE OF created_by_user_id ON analytics_privacy_policies
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_privileged_record_actor();

CREATE TRIGGER admin_audit_logs_actor_role_check
BEFORE INSERT ON admin_audit_logs
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_privileged_record_actor();

CREATE TRIGGER data_erasure_requests_reviewer_role_check
BEFORE INSERT OR UPDATE OF reviewed_by_user_id ON data_erasure_requests
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_privileged_record_actor();

CREATE FUNCTION lerniqa_protect_data_erasure_request_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'pending' THEN
            RAISE EXCEPTION '資料刪除要求必須先以 pending 建立'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '資料刪除要求不可刪除'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
        OR NEW.target_user_id IS DISTINCT FROM OLD.target_user_id
        OR NEW.target_learner_id IS DISTINCT FROM OLD.target_learner_id
        OR NEW.request_type IS DISTINCT FROM OLD.request_type
        OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
        RAISE EXCEPTION '資料刪除要求的身份、目標、類型與提出時間不可覆寫'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status IN ('completed', 'rejected')
        AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION '已完成或已拒絕的資料刪除要求不可覆寫'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status <> 'pending'
        AND (
            NEW.reviewed_by_user_id IS DISTINCT FROM OLD.reviewed_by_user_id
            OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason
        ) THEN
        RAISE EXCEPTION '資料刪除要求離開 pending 後不可改寫審核者或決定原因'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
            (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected'))
            OR (OLD.status = 'approved' AND NEW.status = 'processing')
            OR (OLD.status = 'processing' AND NEW.status = 'completed')
        ) THEN
            RAISE EXCEPTION '資料刪除要求狀態轉換不符合核准、處理與完成流程'
                USING ERRCODE = '23514';
        END IF;

        IF NOT lerniqa_user_is_system_admin(NEW.reviewed_by_user_id) THEN
            RAISE EXCEPTION '資料刪除要求每次狀態推進都必須由有效 system_admin 審核'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER data_erasure_requests_history_check
BEFORE INSERT OR UPDATE OR DELETE ON data_erasure_requests
FOR EACH ROW
EXECUTE FUNCTION lerniqa_protect_data_erasure_request_history();

CREATE FUNCTION lerniqa_validate_data_erasure_completion_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM 'completed'
        OR OLD.status = 'completed' THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM admin_audit_logs AS audit
        WHERE audit.action = 'data_erasure_completed'
            AND audit.target_type = 'data_erasure_request'
            AND audit.target_id = NEW.id
            AND audit.actor_type = 'user'
            AND audit.actor_user_id = NEW.reviewed_by_user_id
            AND audit.created_at = transaction_timestamp()
            AND audit.before_data->>'status' = 'processing'
            AND audit.after_data->>'status' = 'completed'
            AND lerniqa_user_is_system_admin(audit.actor_user_id)
    ) THEN
        RAISE EXCEPTION '完成資料刪除要求必須在同一交易留下審核管理員稽核'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER data_erasure_requests_completion_audit_check
AFTER UPDATE OF status ON data_erasure_requests
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_data_erasure_completion_audit();

CREATE FUNCTION lerniqa_protect_user_role_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '角色授權與撤銷證據不可刪除'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT'
        AND num_nonnulls(
            NEW.revoked_by_type,
            NEW.revoked_by_user_id,
            NEW.revoked_at
        ) <> 0 THEN
        RAISE EXCEPTION '角色授權必須先以未撤銷狀態建立'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id
            OR NEW.user_id IS DISTINCT FROM OLD.user_id
            OR NEW.role IS DISTINCT FROM OLD.role
            OR NEW.granted_by_type IS DISTINCT FROM OLD.granted_by_type
            OR NEW.granted_by_user_id IS DISTINCT FROM OLD.granted_by_user_id
            OR NEW.granted_at IS DISTINCT FROM OLD.granted_at THEN
            RAISE EXCEPTION '角色授權對象、角色與授權證據不可覆寫'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.revoked_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION '已撤銷的角色授權不可恢復或覆寫'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.role = 'system_admin' THEN
        IF TG_OP = 'INSERT'
            AND NEW.granted_by_type = 'user'
            AND NOT lerniqa_user_is_system_admin(NEW.granted_by_user_id) THEN
            RAISE EXCEPTION 'system_admin 只能由有效 system_admin 帳號授予'
                USING ERRCODE = '23514';
        END IF;

        IF TG_OP = 'UPDATE'
            AND OLD.revoked_at IS NULL
            AND NEW.revoked_at IS NOT NULL
            AND NEW.revoked_by_type = 'user'
            AND NOT lerniqa_user_is_system_admin(NEW.revoked_by_user_id) THEN
            RAISE EXCEPTION 'system_admin 只能由有效 system_admin 帳號撤銷'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER user_roles_history_check
BEFORE INSERT OR UPDATE OR DELETE ON user_roles
FOR EACH ROW
EXECUTE FUNCTION lerniqa_protect_user_role_history();

CREATE FUNCTION lerniqa_validate_system_admin_role_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    required_action varchar(80);
    required_actor_type varchar(30);
    required_actor_user_id uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.role <> 'system_admin' THEN
            RETURN NULL;
        END IF;
        required_action := 'admin_role_granted';
        required_actor_type := NEW.granted_by_type;
        required_actor_user_id := NEW.granted_by_user_id;
    ELSIF OLD.role = 'system_admin'
        AND OLD.revoked_at IS NULL
        AND NEW.revoked_at IS NOT NULL THEN
        required_action := 'admin_role_revoked';
        required_actor_type := NEW.revoked_by_type;
        required_actor_user_id := NEW.revoked_by_user_id;
    ELSE
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM admin_audit_logs AS audit
        WHERE audit.action = required_action
            AND audit.target_type = 'user_role'
            AND audit.target_id = NEW.id
            AND audit.created_at = transaction_timestamp()
            AND audit.actor_type = required_actor_type
            AND audit.actor_user_id IS NOT DISTINCT FROM required_actor_user_id
    ) THEN
        RAISE EXCEPTION 'system_admin 授權或撤銷必須在同一交易留下相符管理員稽核'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER user_roles_system_admin_audit_check
AFTER INSERT OR UPDATE ON user_roles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_system_admin_role_audit();

CREATE FUNCTION lerniqa_reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; create a new record instead', TG_TABLE_NAME
        USING ERRCODE = '23514';
END;
$$;

CREATE FUNCTION lerniqa_set_transaction_created_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.created_at := transaction_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER answer_reviews_transaction_timestamp
BEFORE INSERT ON answer_reviews
FOR EACH ROW
EXECUTE FUNCTION lerniqa_set_transaction_created_at();

CREATE TRIGGER question_revision_reviews_transaction_timestamp
BEFORE INSERT ON question_revision_reviews
FOR EACH ROW
EXECUTE FUNCTION lerniqa_set_transaction_created_at();

CREATE TRIGGER admin_audit_logs_transaction_timestamp
BEFORE INSERT ON admin_audit_logs
FOR EACH ROW
EXECUTE FUNCTION lerniqa_set_transaction_created_at();

CREATE FUNCTION lerniqa_validate_answer_attempt_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '作答紀錄不可刪除'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.practice_session_item_id IS DISTINCT FROM OLD.practice_session_item_id
        OR NEW.learner_id IS DISTINCT FROM OLD.learner_id
        OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
        OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
        OR NEW.grading_source IS DISTINCT FROM OLD.grading_source
        OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
        OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
        RAISE EXCEPTION '作答的身份、原始判定來源與送出內容不可覆寫'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER answer_attempts_history_check
BEFORE UPDATE OR DELETE ON answer_attempts
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_answer_attempt_history();

CREATE TRIGGER answer_reviews_append_only
BEFORE UPDATE OR DELETE ON answer_reviews
FOR EACH ROW
EXECUTE FUNCTION lerniqa_reject_append_only_mutation();

CREATE TRIGGER question_revision_reviews_append_only
BEFORE UPDATE OR DELETE ON question_revision_reviews
FOR EACH ROW
EXECUTE FUNCTION lerniqa_reject_append_only_mutation();

CREATE TRIGGER admin_audit_logs_append_only
BEFORE UPDATE OR DELETE ON admin_audit_logs
FOR EACH ROW
EXECUTE FUNCTION lerniqa_reject_append_only_mutation();

CREATE FUNCTION lerniqa_validate_privacy_policy_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    final_status varchar(20);
    required_action varchar(80);
BEGIN
    SELECT status
    INTO final_status
    FROM analytics_privacy_policies
    WHERE id = NEW.id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF final_status = 'active'
        AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM final_status) THEN
        required_action := 'privacy_policy_enabled';
    ELSIF final_status = 'retired'
        AND TG_OP = 'UPDATE'
        AND OLD.status IS DISTINCT FROM final_status THEN
        required_action := 'privacy_policy_retired';
    ELSE
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM admin_audit_logs AS audit
        WHERE audit.action = required_action
            AND audit.target_type = 'analytics_privacy_policy'
            AND audit.target_id = NEW.id
            AND audit.created_at = transaction_timestamp()
    ) THEN
        RAISE EXCEPTION '統計隱私政策啟用或停用必須在同一交易寫入管理員稽核'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER analytics_privacy_policies_audit_check
AFTER INSERT OR UPDATE OF status ON analytics_privacy_policies
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_privacy_policy_audit();

CREATE FUNCTION lerniqa_validate_answer_part_result_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.initial_result IS DISTINCT FROM NEW.current_result THEN
            RAISE EXCEPTION '小題作答建立時 initial_result 必須等於 current_result'
                USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '小題作答結果不可刪除'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.answer_attempt_id IS DISTINCT FROM OLD.answer_attempt_id
        OR NEW.question_part_id IS DISTINCT FROM OLD.question_part_id
        OR NEW.answer_payload IS DISTINCT FROM OLD.answer_payload
        OR NEW.initial_result IS DISTINCT FROM OLD.initial_result THEN
        RAISE EXCEPTION '小題作答的來源、原始答案與初始判定不可覆寫'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER answer_part_results_history_check
BEFORE INSERT OR UPDATE OR DELETE ON answer_part_results
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_answer_part_result_history();

CREATE FUNCTION lerniqa_answer_attempt_expected_result(target_attempt_id uuid)
RETURNS varchar
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN count(*) = 0 THEN NULL
        WHEN bool_or(current_result = 'pending') THEN 'pending'::varchar
        WHEN bool_or(current_result = 'wrong') THEN 'wrong'::varchar
        ELSE 'correct'::varchar
    END
    FROM answer_part_results
    WHERE answer_attempt_id = target_attempt_id;
$$;

CREATE FUNCTION lerniqa_validate_answer_review_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    current_answer_result varchar(20);
    current_attempt_id uuid;
    latest_review_id uuid;
    latest_review_result varchar(20);
    current_overall_result varchar(20);
    expected_overall_result varchar(20);
BEGIN
    SELECT current_result, answer_attempt_id
    INTO current_answer_result, current_attempt_id
    FROM answer_part_results
    WHERE id = NEW.id;

    SELECT id, result
    INTO latest_review_id, latest_review_result
    FROM answer_reviews
    WHERE answer_part_result_id = NEW.id
        AND created_at = transaction_timestamp()
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    IF latest_review_id IS NULL
        OR latest_review_result IS DISTINCT FROM current_answer_result
        OR NOT EXISTS (
            SELECT 1
            FROM analytics_outbox
            WHERE event_type = 'answer_reviewed'
                AND source_record_id = latest_review_id
                AND occurred_at = transaction_timestamp()
        ) THEN
        RAISE EXCEPTION '人工改判必須在同一交易新增相符審核與 answer_reviewed outbox 事件'
            USING ERRCODE = '23514';
    END IF;

    SELECT overall_result
    INTO current_overall_result
    FROM answer_attempts
    WHERE id = current_attempt_id;

    expected_overall_result := lerniqa_answer_attempt_expected_result(current_attempt_id);

    IF current_overall_result IS DISTINCT FROM expected_overall_result THEN
        RAISE EXCEPTION '人工改判後的整題結果必須由各小題目前結果重算'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER answer_part_results_review_transaction_check
AFTER UPDATE OF current_result, grading_source ON answer_part_results
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_answer_review_transaction();

CREATE FUNCTION lerniqa_validate_answer_review_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM answer_part_results AS result
        WHERE result.id = NEW.answer_part_result_id
            AND result.current_result = NEW.result
            AND result.grading_source IN ('manual_review', 'ai_assisted_review')
    ) OR NOT EXISTS (
        SELECT 1
        FROM analytics_outbox AS event
        WHERE event.event_type = 'answer_reviewed'
            AND event.source_record_id = NEW.id
            AND event.occurred_at = transaction_timestamp()
    ) THEN
        RAISE EXCEPTION '新增作答審核必須在同一交易更新目前結果並寫入 answer_reviewed outbox'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER answer_reviews_transaction_check
AFTER INSERT ON answer_reviews
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_answer_review_insert();

CREATE FUNCTION lerniqa_validate_answer_attempt_overall_result()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    stored_overall_result varchar(20);
    expected_overall_result varchar(20);
BEGIN
    SELECT overall_result
    INTO stored_overall_result
    FROM answer_attempts
    WHERE id = NEW.id;

    expected_overall_result := lerniqa_answer_attempt_expected_result(NEW.id);

    IF expected_overall_result IS NOT NULL
        AND stored_overall_result IS DISTINCT FROM expected_overall_result THEN
        RAISE EXCEPTION '整題目前結果必須由各小題目前結果重算'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER answer_attempts_overall_result_check
AFTER UPDATE OF overall_result ON answer_attempts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_answer_attempt_overall_result();

CREATE FUNCTION lerniqa_validate_answer_part_attempt_overall_result()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    current_attempt_id uuid;
    stored_overall_result varchar(20);
    expected_overall_result varchar(20);
BEGIN
    SELECT answer_attempt_id
    INTO current_attempt_id
    FROM answer_part_results
    WHERE id = NEW.id;

    SELECT overall_result
    INTO stored_overall_result
    FROM answer_attempts
    WHERE id = current_attempt_id;

    expected_overall_result := lerniqa_answer_attempt_expected_result(current_attempt_id);

    IF expected_overall_result IS NOT NULL
        AND stored_overall_result IS DISTINCT FROM expected_overall_result THEN
        RAISE EXCEPTION '整題目前結果必須由各小題目前結果重算'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER answer_part_results_attempt_overall_check
AFTER INSERT OR UPDATE OF current_result ON answer_part_results
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_answer_part_attempt_overall_result();

-- A superseded revision remains part of the publication history. 0002 cleared
-- published_at for every non-current status, so an existing ambiguous row must
-- be repaired deliberately instead of inventing a historical timestamp here.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM question_revisions
        WHERE status = 'superseded'
            AND published_at IS NULL
    ) THEN
        RAISE EXCEPTION 'an existing superseded question revision has no publication timestamp'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

ALTER TABLE question_revisions
    DROP CONSTRAINT question_revisions_publish_check,
    ADD CONSTRAINT question_revisions_publish_check
        CHECK (
            (
                status IN ('published', 'superseded')
                AND published_at IS NOT NULL
            )
            OR (
                status IN ('draft', 'rejected')
                AND published_at IS NULL
            )
        );

-- System catalog revisions after the initial version must explain why the
-- content changed. Refuse ambiguous legacy rows instead of inventing notes.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM question_revisions AS revision
        JOIN questions AS question ON question.id = revision.question_id
        WHERE question.origin = 'system'
            AND revision.revision_number > 1
            AND NULLIF(btrim(revision.change_note), '') IS NULL
    ) THEN
        RAISE EXCEPTION 'an existing later system question revision has no change note'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_validate_system_revision_change_note()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_TABLE_NAME = 'question_revisions' THEN
        IF NEW.revision_number > 1
            AND NULLIF(btrim(NEW.change_note), '') IS NULL
            AND EXISTS (
                SELECT 1
                FROM questions
                WHERE id = NEW.question_id
                    AND origin = 'system'
            ) THEN
            RAISE EXCEPTION '系統題目的後續版本必須填寫修改原因'
                USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'questions' THEN
        IF EXISTS (
            SELECT 1
            FROM questions AS question
            JOIN question_revisions AS revision
                ON revision.question_id = question.id
            WHERE question.id = NEW.id
                AND question.origin = 'system'
                AND revision.revision_number > 1
                AND NULLIF(btrim(revision.change_note), '') IS NULL
        ) THEN
            RAISE EXCEPTION '含有空白修改原因的後續版本不可改為系統題目'
                USING ERRCODE = '23514';
        END IF;

        RETURN NULL;
    END IF;

    RAISE EXCEPTION 'unsupported system revision change-note table: %',
        TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER question_revisions_change_note_check
BEFORE INSERT OR UPDATE OF question_id, revision_number, change_note
ON question_revisions
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_system_revision_change_note();

-- Re-read final state so account -> system conversion may be paired with
-- change-note repairs in either statement order inside one transaction.
CREATE CONSTRAINT TRIGGER questions_system_revision_change_note_check
AFTER UPDATE OF origin ON questions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_system_revision_change_note();

-- Re-evaluate the question row at deferred-trigger time. Event NEW values can
-- be stale when a transaction performs a valid multi-step revision rollover.
CREATE OR REPLACE FUNCTION lerniqa_validate_current_revision_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    final_status varchar(20);
    final_revision_id uuid;
BEGIN
    SELECT status, current_revision_id
    INTO final_status, final_revision_id
    FROM questions
    WHERE id = NEW.id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF final_status = 'published' AND final_revision_id IS NULL THEN
        RAISE EXCEPTION '已發布題目必須指定目前版本'
            USING ERRCODE = '23514';
    END IF;

    IF final_revision_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM question_revisions
        WHERE id = final_revision_id
            AND question_id = NEW.id
            AND status = 'published'
    ) THEN
        RAISE EXCEPTION '目前題目版本必須是同一題的已發布版本'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER questions_current_revision_status_check ON questions;

CREATE CONSTRAINT TRIGGER questions_current_revision_status_check
AFTER INSERT OR UPDATE OF current_revision_id, status ON questions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_current_revision_status();

-- Existing published questions and all current-revision pointers must already
-- satisfy the stricter final-state invariant before the reverse trigger lands.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM questions AS question
        WHERE (
            question.status = 'published'
            AND question.current_revision_id IS NULL
        )
        OR (
            question.current_revision_id IS NOT NULL
            AND NOT EXISTS (
                SELECT 1
                FROM question_revisions AS revision
                WHERE revision.id = question.current_revision_id
                    AND revision.question_id = question.id
                    AND revision.status = 'published'
            )
        )
    ) THEN
        RAISE EXCEPTION 'an existing question has an invalid current revision'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_validate_revision_current_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    final_status varchar(20);
    final_question_id uuid;
BEGIN
    SELECT status, question_id
    INTO final_status, final_question_id
    FROM question_revisions
    WHERE id = NEW.id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM questions
        WHERE current_revision_id = NEW.id
            AND (
                final_status <> 'published'
                OR questions.id <> final_question_id
            )
    ) THEN
        RAISE EXCEPTION '目前題目版本在解除引用前必須維持 published 狀態且屬於同一題'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER question_revisions_current_status_check
AFTER UPDATE OF status, question_id ON question_revisions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_revision_current_status();

CREATE FUNCTION lerniqa_question_revision_is_frozen(candidate_revision_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM question_revisions
        WHERE id = candidate_revision_id
            AND status IN ('published', 'superseded')
    );
$$;

CREATE FUNCTION lerniqa_protect_frozen_question_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'draft' OR NEW.published_at IS NOT NULL THEN
            RAISE EXCEPTION '新題目版本必須先以 draft 建立'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('published', 'superseded') THEN
            RAISE EXCEPTION '已發布或已取代的題目版本不可刪除'
                USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.status NOT IN ('published', 'superseded') THEN
        IF NEW.status IS DISTINCT FROM OLD.status
            AND NOT (
                (OLD.status = 'draft' AND NEW.status IN ('published', 'rejected'))
                OR (OLD.status = 'rejected' AND NEW.status = 'draft')
            ) THEN
            RAISE EXCEPTION '題目版本狀態轉換不符合 draft、published、rejected、superseded 流程'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW IS NOT DISTINCT FROM OLD THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'published'
        AND NEW.status = 'superseded'
        AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION '已發布或已取代的題目版本不可原地修改'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER question_revisions_frozen_check
BEFORE INSERT OR UPDATE OR DELETE ON question_revisions
FOR EACH ROW
EXECUTE FUNCTION lerniqa_protect_frozen_question_revision();

CREATE FUNCTION lerniqa_validate_system_revision_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    stable_question_origin varchar(20);
    revision_creator_user_id uuid;
    required_decision varchar(20);
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NULL;
    END IF;

    SELECT question.origin, revision.created_by_user_id
    INTO stable_question_origin, revision_creator_user_id
    FROM question_revisions AS revision
    JOIN questions AS question ON question.id = revision.question_id
    WHERE revision.id = NEW.id;

    IF stable_question_origin <> 'system' THEN
        RETURN NULL;
    END IF;

    required_decision := CASE
        WHEN OLD.status = 'draft' AND NEW.status = 'rejected' THEN 'rejected'
        ELSE 'approved'
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM question_revision_reviews AS review
        WHERE review.question_revision_id = NEW.id
            AND review.decision = required_decision
            AND review.from_status = OLD.status
            AND review.to_status = NEW.status
            AND review.created_at = transaction_timestamp()
            AND (
                review.reviewer_type = 'bootstrap_admin'
                OR (
                    review.reviewer_type = 'user'
                    AND lerniqa_user_is_system_admin(review.reviewer_user_id)
                    AND review.reviewer_user_id
                        IS DISTINCT FROM revision_creator_user_id
                )
            )
            AND EXISTS (
                SELECT 1
                FROM admin_audit_logs AS audit
                WHERE audit.action = 'system_question_revision_status_changed'
                    AND audit.target_type = 'question_revision'
                    AND audit.target_id = NEW.id
                    AND audit.created_at = transaction_timestamp()
                    AND audit.before_data->>'status' = OLD.status
                    AND audit.after_data->>'status' = NEW.status
                    AND (
                        (
                            review.reviewer_type = 'bootstrap_admin'
                            AND audit.actor_type = 'bootstrap_admin'
                            AND audit.actor_user_id IS NULL
                        )
                        OR (
                            review.reviewer_type = 'user'
                            AND audit.actor_type = 'user'
                            AND audit.actor_user_id = review.reviewer_user_id
                        )
                    )
            )
    ) THEN
        RAISE EXCEPTION '系統題目版本的發布或取代必須在同一交易留下有效管理員審核與相符稽核'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER question_revisions_review_check
AFTER UPDATE OF status ON question_revisions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_system_revision_review();

CREATE FUNCTION lerniqa_protect_frozen_revision_child()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    old_revision_id uuid;
    new_revision_id uuid;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        old_revision_id := OLD.question_revision_id;
        IF lerniqa_question_revision_is_frozen(old_revision_id) THEN
            RAISE EXCEPTION '已發布或已取代版本的內容、答案、分類與來源不可修改'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP <> 'DELETE' THEN
        new_revision_id := NEW.question_revision_id;
        IF new_revision_id IS DISTINCT FROM old_revision_id
            AND lerniqa_question_revision_is_frozen(new_revision_id) THEN
            RAISE EXCEPTION '不可新增內容、答案、分類或來源至已發布或已取代版本'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION lerniqa_protect_frozen_revision_part_child()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    old_revision_id uuid;
    new_revision_id uuid;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        SELECT question_revision_id
        INTO old_revision_id
        FROM question_parts
        WHERE id = OLD.question_part_id;

        IF lerniqa_question_revision_is_frozen(old_revision_id) THEN
            RAISE EXCEPTION '已發布或已取代版本的選項與答案不可修改'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP <> 'DELETE' THEN
        SELECT question_revision_id
        INTO new_revision_id
        FROM question_parts
        WHERE id = NEW.question_part_id;

        IF new_revision_id IS DISTINCT FROM old_revision_id
            AND lerniqa_question_revision_is_frozen(new_revision_id) THEN
            RAISE EXCEPTION '不可新增選項或答案至已發布或已取代版本'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER question_parts_frozen_revision_check
BEFORE INSERT OR UPDATE OR DELETE ON question_parts
FOR EACH ROW EXECUTE FUNCTION lerniqa_protect_frozen_revision_child();

CREATE TRIGGER question_content_blocks_frozen_revision_check
BEFORE INSERT OR UPDATE OR DELETE ON question_content_blocks
FOR EACH ROW EXECUTE FUNCTION lerniqa_protect_frozen_revision_child();

CREATE TRIGGER question_revision_units_frozen_revision_check
BEFORE INSERT OR UPDATE OR DELETE ON question_revision_units
FOR EACH ROW EXECUTE FUNCTION lerniqa_protect_frozen_revision_child();

CREATE TRIGGER question_revision_topics_frozen_revision_check
BEFORE INSERT OR UPDATE OR DELETE ON question_revision_topics
FOR EACH ROW EXECUTE FUNCTION lerniqa_protect_frozen_revision_child();

CREATE TRIGGER question_revision_knowledge_points_frozen_revision_check
BEFORE INSERT OR UPDATE OR DELETE ON question_revision_knowledge_points
FOR EACH ROW EXECUTE FUNCTION lerniqa_protect_frozen_revision_child();

CREATE TRIGGER question_revision_curriculum_codes_frozen_revision_check
BEFORE INSERT OR UPDATE OR DELETE ON question_revision_curriculum_codes
FOR EACH ROW EXECUTE FUNCTION lerniqa_protect_frozen_revision_child();

CREATE TRIGGER question_revision_filter_values_frozen_revision_check
BEFORE INSERT OR UPDATE OR DELETE ON question_revision_filter_values
FOR EACH ROW EXECUTE FUNCTION lerniqa_protect_frozen_revision_child();

CREATE TRIGGER question_revision_sources_frozen_revision_check
BEFORE INSERT OR UPDATE OR DELETE ON question_revision_sources
FOR EACH ROW EXECUTE FUNCTION lerniqa_protect_frozen_revision_child();

CREATE TRIGGER question_options_frozen_revision_check
BEFORE INSERT OR UPDATE OR DELETE ON question_options
FOR EACH ROW EXECUTE FUNCTION lerniqa_protect_frozen_revision_part_child();

CREATE TRIGGER question_answers_frozen_revision_check
BEFORE INSERT OR UPDATE OR DELETE ON question_answers
FOR EACH ROW EXECUTE FUNCTION lerniqa_protect_frozen_revision_part_child();

-- Session validation and permission revocation must serialize on the same
-- account key. Without this transaction lock, concurrent transactions can
-- each validate against the other's old snapshot and commit an invalid active
-- session after a role/access revocation or account suspension.
CREATE FUNCTION lerniqa_auth_user_lock_key(candidate_user_id uuid)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
    SELECT hashtextextended('lerniqa-auth-user:' || candidate_user_id::text, 0);
$$;

CREATE FUNCTION lerniqa_lock_auth_user(candidate_user_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
STRICT
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        lerniqa_auth_user_lock_key(candidate_user_id)
    );
END;
$$;

CREATE FUNCTION lerniqa_lock_auth_change_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    candidate_user_ids uuid[];
    locked_user_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'users' THEN
        IF TG_OP = 'DELETE' THEN
            candidate_user_ids := ARRAY[OLD.id]::uuid[];
        ELSIF TG_OP = 'INSERT' THEN
            candidate_user_ids := ARRAY[NEW.id]::uuid[];
        ELSE
            candidate_user_ids := ARRAY[OLD.id, NEW.id]::uuid[];
        END IF;
    ELSIF TG_TABLE_NAME = 'user_roles' THEN
        IF TG_OP = 'DELETE' THEN
            candidate_user_ids := ARRAY[
                OLD.user_id,
                OLD.granted_by_user_id,
                OLD.revoked_by_user_id
            ]::uuid[];
        ELSIF TG_OP = 'INSERT' THEN
            candidate_user_ids := ARRAY[
                NEW.user_id,
                NEW.granted_by_user_id,
                NEW.revoked_by_user_id
            ]::uuid[];
        ELSE
            candidate_user_ids := ARRAY[
                OLD.user_id,
                OLD.granted_by_user_id,
                OLD.revoked_by_user_id,
                NEW.user_id,
                NEW.granted_by_user_id,
                NEW.revoked_by_user_id
            ]::uuid[];
        END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN
            candidate_user_ids := ARRAY[OLD.user_id]::uuid[];
        ELSIF TG_OP = 'INSERT' THEN
            candidate_user_ids := ARRAY[NEW.user_id]::uuid[];
        ELSE
            candidate_user_ids := ARRAY[OLD.user_id, NEW.user_id]::uuid[];
        END IF;
    END IF;

    FOR locked_user_id IN
        SELECT DISTINCT candidate_id
        FROM unnest(candidate_user_ids) AS candidate(candidate_id)
        WHERE candidate_id IS NOT NULL
        ORDER BY candidate_id
    LOOP
        PERFORM lerniqa_lock_auth_user(locked_user_id);
    END LOOP;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER user_roles_auth_user_lock
BEFORE INSERT OR UPDATE OR DELETE ON user_roles
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_auth_change_user();

CREATE TRIGGER learner_access_auth_user_lock
BEFORE INSERT OR UPDATE OR DELETE ON learner_access
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_auth_change_user();

CREATE TRIGGER users_auth_user_lock
BEFORE UPDATE OF status ON users
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_auth_change_user();

CREATE FUNCTION lerniqa_auth_session_is_valid(
    session_user_id uuid,
    session_role varchar,
    session_learner_id uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM user_roles AS role
        JOIN users AS app_user ON app_user.id = role.user_id
        WHERE role.user_id = session_user_id
            AND role.role = session_role
            AND role.revoked_at IS NULL
            AND app_user.status = 'active'
    )
    AND (
        session_learner_id IS NULL
        OR EXISTS (
            SELECT 1
            FROM learner_access AS access
            WHERE access.user_id = session_user_id
                AND access.learner_id = session_learner_id
                AND access.accepted_at IS NOT NULL
                AND access.revoked_at IS NULL
        )
    );
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM auth_sessions AS session
        WHERE session.revoked_at IS NULL
            AND session.expires_at > CURRENT_TIMESTAMP
            AND NOT lerniqa_auth_session_is_valid(
                session.user_id,
                session.active_role,
                session.active_learner_id
            )
    ) THEN
        RAISE EXCEPTION 'an existing active auth session has no valid role or learner access'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_validate_auth_session()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    locked_user_id uuid;
BEGIN
    FOR locked_user_id IN
        SELECT DISTINCT candidate_id
        FROM unnest(
            CASE
                WHEN TG_OP = 'UPDATE'
                    THEN ARRAY[OLD.user_id, NEW.user_id]::uuid[]
                ELSE ARRAY[NEW.user_id]::uuid[]
            END
        ) AS candidate(candidate_id)
        WHERE candidate_id IS NOT NULL
        ORDER BY candidate_id
    LOOP
        PERFORM lerniqa_lock_auth_user(locked_user_id);
    END LOOP;

    IF NEW.revoked_at IS NULL THEN
        IF NEW.expires_at <= CURRENT_TIMESTAMP THEN
            RAISE EXCEPTION '未撤銷的登入工作階段到期時間必須晚於目前時間'
                USING ERRCODE = '23514';
        END IF;

        IF NOT lerniqa_auth_session_is_valid(
                NEW.user_id,
                NEW.active_role,
                NEW.active_learner_id
            ) THEN
            RAISE EXCEPTION '有效登入工作階段必須使用啟用帳號、有效角色與已接受的學習者權限'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER auth_sessions_access_check
BEFORE INSERT OR UPDATE ON auth_sessions
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_auth_session();

CREATE FUNCTION lerniqa_validate_sessions_after_access_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    old_user_id uuid;
    new_user_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'users' THEN
        IF TG_OP <> 'INSERT' THEN
            old_user_id := OLD.id;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            new_user_id := NEW.id;
        END IF;
    ELSE
        IF TG_OP <> 'INSERT' THEN
            old_user_id := OLD.user_id;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            new_user_id := NEW.user_id;
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM auth_sessions AS session
        WHERE session.revoked_at IS NULL
            AND session.expires_at > CURRENT_TIMESTAMP
            AND session.user_id IN (old_user_id, new_user_id)
            AND NOT lerniqa_auth_session_is_valid(
                session.user_id,
                session.active_role,
                session.active_learner_id
            )
    ) THEN
        RAISE EXCEPTION '角色或學習者權限異動使有效登入工作階段失效；請在同一交易撤銷工作階段'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER user_roles_auth_sessions_check
AFTER INSERT OR UPDATE OR DELETE ON user_roles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_sessions_after_access_change();

CREATE CONSTRAINT TRIGGER learner_access_auth_sessions_check
AFTER INSERT OR UPDATE OR DELETE ON learner_access
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_sessions_after_access_change();

CREATE CONSTRAINT TRIGGER users_auth_sessions_check
AFTER UPDATE OF status ON users
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_sessions_after_access_change();

-- Difficulty rows can be inserted in either order inside a transaction, but
-- the final enabled plan must have a non-empty mix totalling exactly 100.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM practice_plans AS plan
        LEFT JOIN practice_plan_difficulty_mix AS mix
            ON mix.practice_plan_id = plan.id
        WHERE plan.difficulty_mix_enabled
        GROUP BY plan.id
        HAVING count(mix.difficulty_level_id) = 0
            OR sum(mix.percentage) <> 100
    ) THEN
        RAISE EXCEPTION 'an existing enabled difficulty mix is empty or does not total 100'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_practice_plan_difficulty_mix_is_valid(plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT NOT EXISTS (
        SELECT 1
        FROM practice_plans
        WHERE id = plan_id
            AND difficulty_mix_enabled
    ) OR EXISTS (
        SELECT 1
        FROM practice_plan_difficulty_mix
        WHERE practice_plan_id = plan_id
        GROUP BY practice_plan_id
        HAVING count(*) > 0 AND sum(percentage) = 100
    );
$$;

CREATE FUNCTION lerniqa_validate_practice_plan_difficulty_mix()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    old_plan_id uuid;
    new_plan_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'practice_plans' THEN
        IF TG_OP <> 'INSERT' THEN
            old_plan_id := OLD.id;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            new_plan_id := NEW.id;
        END IF;
    ELSE
        IF TG_OP <> 'INSERT' THEN
            old_plan_id := OLD.practice_plan_id;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            new_plan_id := NEW.practice_plan_id;
        END IF;
    END IF;

    IF old_plan_id IS NOT NULL
        AND NOT lerniqa_practice_plan_difficulty_mix_is_valid(old_plan_id) THEN
        RAISE EXCEPTION '啟用難易度比例的練習計畫必須有比例且合計為 100'
            USING ERRCODE = '23514';
    END IF;

    IF new_plan_id IS NOT NULL
        AND new_plan_id IS DISTINCT FROM old_plan_id
        AND NOT lerniqa_practice_plan_difficulty_mix_is_valid(new_plan_id) THEN
        RAISE EXCEPTION '啟用難易度比例的練習計畫必須有比例且合計為 100'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER practice_plans_difficulty_mix_check
AFTER INSERT OR UPDATE OF difficulty_mix_enabled ON practice_plans
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_practice_plan_difficulty_mix();

CREATE CONSTRAINT TRIGGER practice_plan_difficulty_mix_total_check
AFTER INSERT OR UPDATE OR DELETE ON practice_plan_difficulty_mix
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_practice_plan_difficulty_mix();

INSERT INTO schema_migrations (version, name)
VALUES ('0005', 'similarity_analytics_and_audit');

COMMIT;
