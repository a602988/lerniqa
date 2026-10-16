BEGIN;

CREATE TABLE schema_migrations (
    version varchar(20) PRIMARY KEY,
    name varchar(160) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id uuid PRIMARY KEY,
    display_name varchar(80) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at timestamptz,
    CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended', 'closed'))
);

CREATE TABLE account_identities (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    provider varchar(30) NOT NULL,
    provider_subject varchar(255) NOT NULL,
    email_normalized varchar(320),
    password_hash text,
    verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at timestamptz,
    CONSTRAINT account_identities_provider_check
        CHECK (provider IN ('email', 'google', 'line', 'facebook')),
    CONSTRAINT account_identities_email_credentials_check
        CHECK (
            (provider = 'email' AND email_normalized IS NOT NULL AND password_hash IS NOT NULL)
            OR (provider <> 'email' AND password_hash IS NULL)
        ),
    CONSTRAINT account_identities_provider_subject_unique UNIQUE (provider, provider_subject),
    CONSTRAINT account_identities_email_unique UNIQUE (email_normalized)
);

CREATE TABLE verification_challenges (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    purpose varchar(30) NOT NULL,
    target_role varchar(30),
    token_hash text NOT NULL UNIQUE,
    attempt_count smallint NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT verification_challenges_purpose_check
        CHECK (purpose IN ('email_verify', 'password_reset', 'role_pin_reset', 'sensitive_action')),
    CONSTRAINT verification_challenges_target_role_check
        CHECK (
            (purpose = 'role_pin_reset' AND target_role IN ('parent', 'tutor'))
            OR (purpose <> 'role_pin_reset' AND target_role IS NULL)
        ),
    CONSTRAINT verification_challenges_attempt_count_check CHECK (attempt_count >= 0)
);

CREATE TABLE user_roles (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    role varchar(30) NOT NULL,
    granted_by_type varchar(30) NOT NULL,
    granted_by_user_id uuid REFERENCES users(id),
    granted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_by_type varchar(30),
    revoked_by_user_id uuid REFERENCES users(id),
    revoked_at timestamptz,
    CONSTRAINT user_roles_role_check
        CHECK (role IN ('parent', 'learner', 'tutor', 'system_admin')),
    CONSTRAINT user_roles_granted_by_check
        CHECK (
            (granted_by_type = 'user' AND granted_by_user_id IS NOT NULL)
            OR (granted_by_type = 'bootstrap_admin' AND granted_by_user_id IS NULL)
        ),
    CONSTRAINT user_roles_revoked_by_check
        CHECK (
            (revoked_at IS NULL AND revoked_by_type IS NULL AND revoked_by_user_id IS NULL)
            OR (
                revoked_at IS NOT NULL
                AND (
                    (revoked_by_type = 'user' AND revoked_by_user_id IS NOT NULL)
                    OR (revoked_by_type = 'bootstrap_admin' AND revoked_by_user_id IS NULL)
                )
            )
        )
);

CREATE UNIQUE INDEX user_roles_active_unique
    ON user_roles(user_id, role)
    WHERE revoked_at IS NULL;

CREATE TABLE role_pin_credentials (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    role varchar(30) NOT NULL,
    pin_hash text NOT NULL,
    failed_attempts smallint NOT NULL DEFAULT 0,
    locked_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT role_pin_credentials_role_check CHECK (role IN ('parent', 'tutor')),
    CONSTRAINT role_pin_credentials_failed_attempts_check CHECK (failed_attempts >= 0),
    CONSTRAINT role_pin_credentials_user_role_unique UNIQUE (user_id, role)
);

CREATE TABLE grades (
    id uuid PRIMARY KEY,
    stage varchar(20) NOT NULL,
    code varchar(30) NOT NULL UNIQUE,
    name varchar(40) NOT NULL,
    sort_order smallint NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT grades_stage_check CHECK (stage IN ('elementary', 'junior_high')),
    CONSTRAINT grades_status_check CHECK (status IN ('active', 'inactive')),
    CONSTRAINT grades_sort_order_check CHECK (sort_order >= 0)
);

CREATE TABLE semesters (
    id uuid PRIMARY KEY,
    code varchar(20) NOT NULL UNIQUE,
    name varchar(40) NOT NULL,
    sort_order smallint NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT semesters_status_check CHECK (status IN ('active', 'inactive')),
    CONSTRAINT semesters_sort_order_check CHECK (sort_order >= 0)
);

CREATE TABLE publishers (
    id uuid PRIMARY KEY,
    code varchar(40) NOT NULL UNIQUE,
    name varchar(80) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT publishers_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE subjects (
    id uuid PRIMARY KEY,
    code varchar(60) NOT NULL UNIQUE,
    name varchar(80) NOT NULL,
    normalized_name varchar(80) NOT NULL,
    parent_subject_id uuid REFERENCES subjects(id),
    subject_kind varchar(20) NOT NULL DEFAULT 'leaf',
    origin varchar(20) NOT NULL,
    owner_user_id uuid REFERENCES users(id),
    status varchar(20) NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT subjects_parent_check CHECK (parent_subject_id IS NULL OR parent_subject_id <> id),
    CONSTRAINT subjects_kind_check CHECK (subject_kind IN ('group', 'leaf')),
    CONSTRAINT subjects_origin_check CHECK (origin IN ('system', 'account')),
    CONSTRAINT subjects_owner_check
        CHECK (
            (origin = 'system' AND owner_user_id IS NULL)
            OR (origin = 'account' AND owner_user_id IS NOT NULL AND subject_kind = 'leaf')
        ),
    CONSTRAINT subjects_status_check CHECK (status IN ('active', 'inactive', 'archived'))
);

CREATE UNIQUE INDEX subjects_system_name_unique
    ON subjects(normalized_name)
    WHERE origin = 'system';

CREATE UNIQUE INDEX subjects_account_name_unique
    ON subjects(owner_user_id, normalized_name)
    WHERE origin = 'account';

CREATE TABLE subject_aliases (
    id uuid PRIMARY KEY,
    subject_id uuid NOT NULL REFERENCES subjects(id),
    alias varchar(80) NOT NULL,
    normalized_alias varchar(80) NOT NULL UNIQUE,
    status varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT subject_aliases_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE grade_subjects (
    grade_id uuid NOT NULL REFERENCES grades(id),
    subject_id uuid NOT NULL REFERENCES subjects(id),
    is_default boolean NOT NULL DEFAULT false,
    sort_order smallint NOT NULL,
    active_from date,
    active_until date,
    PRIMARY KEY (grade_id, subject_id),
    CONSTRAINT grade_subjects_sort_order_check CHECK (sort_order >= 0),
    CONSTRAINT grade_subjects_active_range_check
        CHECK (active_until IS NULL OR active_from IS NULL OR active_until >= active_from)
);

CREATE TABLE book_versions (
    id uuid PRIMARY KEY,
    subject_id uuid NOT NULL REFERENCES subjects(id),
    grade_id uuid REFERENCES grades(id),
    publisher_id uuid REFERENCES publishers(id),
    name varchar(100) NOT NULL,
    origin varchar(20) NOT NULL,
    owner_user_id uuid REFERENCES users(id),
    status varchar(20) NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT book_versions_identity_subject_unique UNIQUE (id, subject_id),
    CONSTRAINT book_versions_origin_check CHECK (origin IN ('system', 'account')),
    CONSTRAINT book_versions_owner_check
        CHECK (
            (origin = 'system' AND owner_user_id IS NULL)
            OR (origin = 'account' AND owner_user_id IS NOT NULL)
        ),
    CONSTRAINT book_versions_status_check CHECK (status IN ('active', 'inactive', 'archived'))
);

CREATE TABLE exam_programs (
    id uuid PRIMARY KEY,
    code varchar(60) NOT NULL UNIQUE,
    name varchar(120) NOT NULL,
    authority_name varchar(160) NOT NULL,
    source_reference text NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    sort_order smallint NOT NULL,
    CONSTRAINT exam_programs_status_check CHECK (status IN ('active', 'inactive')),
    CONSTRAINT exam_programs_sort_order_check CHECK (sort_order >= 0)
);

CREATE TABLE exam_program_levels (
    id uuid PRIMARY KEY,
    exam_program_id uuid NOT NULL REFERENCES exam_programs(id),
    parent_level_id uuid,
    code varchar(60) NOT NULL,
    name varchar(120) NOT NULL,
    level_kind varchar(20) NOT NULL DEFAULT 'level',
    cefr_level varchar(10),
    sort_order smallint NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT exam_program_levels_identity_unique UNIQUE (id, exam_program_id),
    CONSTRAINT exam_program_levels_code_unique UNIQUE (exam_program_id, code),
    CONSTRAINT exam_program_levels_parent_check CHECK (parent_level_id IS NULL OR parent_level_id <> id),
    CONSTRAINT exam_program_levels_kind_check CHECK (level_kind IN ('level', 'category', 'track')),
    CONSTRAINT exam_program_levels_status_check CHECK (status IN ('active', 'inactive')),
    CONSTRAINT exam_program_levels_sort_order_check CHECK (sort_order >= 0),
    CONSTRAINT exam_program_levels_parent_program_fk
        FOREIGN KEY (parent_level_id, exam_program_id)
        REFERENCES exam_program_levels(id, exam_program_id)
);

CREATE INDEX exam_program_levels_parent_sort_index
    ON exam_program_levels(parent_level_id, sort_order);

CREATE TABLE assets (
    id uuid PRIMARY KEY,
    storage_key varchar(500) NOT NULL UNIQUE,
    mime_type varchar(120) NOT NULL,
    byte_size bigint NOT NULL,
    width integer,
    height integer,
    checksum varchar(128) NOT NULL,
    purpose varchar(30) NOT NULL,
    sensitivity varchar(20) NOT NULL DEFAULT 'private',
    scan_status varchar(20) NOT NULL DEFAULT 'pending',
    created_by_user_id uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT assets_byte_size_check CHECK (byte_size > 0),
    CONSTRAINT assets_width_check CHECK (width IS NULL OR width > 0),
    CONSTRAINT assets_height_check CHECK (height IS NULL OR height > 0),
    CONSTRAINT assets_purpose_check
        CHECK (purpose IN ('question_content', 'source_document', 'handwriting', 'learner_avatar', 'page_crop')),
    CONSTRAINT assets_sensitivity_check CHECK (sensitivity IN ('public_content', 'private')),
    CONSTRAINT assets_private_purpose_check
        CHECK (purpose NOT IN ('handwriting', 'learner_avatar') OR sensitivity = 'private'),
    CONSTRAINT assets_scan_status_check CHECK (scan_status IN ('pending', 'clean', 'rejected'))
);

CREATE TABLE learners (
    id uuid PRIMARY KEY,
    display_name varchar(80) NOT NULL,
    education_status varchar(20) NOT NULL DEFAULT 'enrolled',
    grade_id uuid REFERENCES grades(id),
    semester_id uuid REFERENCES semesters(id),
    school_name varchar(120),
    avatar_asset_id uuid REFERENCES assets(id),
    status varchar(20) NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT learners_education_status_check
        CHECK (education_status IN ('enrolled', 'not_enrolled')),
    CONSTRAINT learners_education_fields_check
        CHECK (
            (education_status = 'enrolled' AND grade_id IS NOT NULL)
            OR (
                education_status = 'not_enrolled'
                AND grade_id IS NULL
                AND semester_id IS NULL
                AND school_name IS NULL
            )
        ),
    CONSTRAINT learners_status_check CHECK (status IN ('active', 'archived'))
);

CREATE TABLE learner_access (
    id uuid PRIMARY KEY,
    learner_id uuid NOT NULL REFERENCES learners(id),
    user_id uuid NOT NULL REFERENCES users(id),
    access_role varchar(30) NOT NULL,
    can_view_results boolean NOT NULL DEFAULT true,
    can_create_plans boolean NOT NULL DEFAULT false,
    can_review_answers boolean NOT NULL DEFAULT false,
    can_manage_settings boolean NOT NULL DEFAULT false,
    invited_by_user_id uuid REFERENCES users(id),
    accepted_at timestamptz,
    revoked_at timestamptz,
    CONSTRAINT learner_access_role_check CHECK (access_role IN ('parent', 'learner', 'tutor'))
);

CREATE UNIQUE INDEX learner_access_active_unique
    ON learner_access(learner_id, user_id, access_role)
    WHERE revoked_at IS NULL;

CREATE INDEX learner_access_user_index
    ON learner_access(user_id, revoked_at, learner_id);

CREATE TABLE auth_sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    token_hash text NOT NULL UNIQUE,
    active_role varchar(30) NOT NULL DEFAULT 'learner',
    active_learner_id uuid REFERENCES learners(id),
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at timestamptz,
    CONSTRAINT auth_sessions_active_role_check
        CHECK (active_role IN ('parent', 'learner', 'tutor', 'system_admin'))
);

CREATE INDEX auth_sessions_user_expiry_index
    ON auth_sessions(user_id, revoked_at, expires_at);

CREATE INDEX verification_challenges_lookup_index
    ON verification_challenges(user_id, purpose, consumed_at, expires_at);

CREATE FUNCTION lerniqa_valid_question_limits(options smallint[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
    SELECT cardinality(options) BETWEEN 1 AND 20
        AND NOT EXISTS (
            SELECT 1
            FROM unnest(options) AS value
            WHERE value NOT BETWEEN 1 AND 500
        )
        AND cardinality(options) = (
            SELECT count(DISTINCT value)
            FROM unnest(options) AS value
        );
$$;

CREATE TABLE learner_preferences (
    learner_id uuid PRIMARY KEY REFERENCES learners(id),
    question_limit_options smallint[] NOT NULL,
    default_question_limit smallint NOT NULL,
    default_check_mode varchar(20) NOT NULL DEFAULT 'complete',
    lock_version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT learner_preferences_question_limits_check
        CHECK (lerniqa_valid_question_limits(question_limit_options)),
    CONSTRAINT learner_preferences_default_limit_check
        CHECK (
            default_question_limit BETWEEN 1 AND 500
            AND default_question_limit = ANY(question_limit_options)
        ),
    CONSTRAINT learner_preferences_check_mode_check
        CHECK (default_check_mode IN ('complete', 'instant', 'score')),
    CONSTRAINT learner_preferences_lock_version_check CHECK (lock_version > 0)
);

CREATE TABLE learner_subject_settings (
    id uuid PRIMARY KEY,
    learner_id uuid NOT NULL REFERENCES learners(id),
    subject_id uuid NOT NULL REFERENCES subjects(id),
    book_version_id uuid,
    enabled boolean NOT NULL DEFAULT true,
    is_default_subject boolean NOT NULL DEFAULT false,
    position smallint NOT NULL,
    lock_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT learner_subject_settings_unique UNIQUE (learner_id, subject_id),
    CONSTRAINT learner_subject_settings_book_subject_fk
        FOREIGN KEY (book_version_id, subject_id)
        REFERENCES book_versions(id, subject_id),
    CONSTRAINT learner_subject_settings_position_check CHECK (position >= 0),
    CONSTRAINT learner_subject_settings_lock_version_check CHECK (lock_version > 0)
);

CREATE INDEX learner_subject_settings_display_index
    ON learner_subject_settings(learner_id, enabled, position);

CREATE TABLE curriculum_units (
    id uuid PRIMARY KEY,
    subject_id uuid NOT NULL REFERENCES subjects(id),
    grade_id uuid REFERENCES grades(id),
    semester_id uuid REFERENCES semesters(id),
    book_version_id uuid,
    parent_unit_id uuid REFERENCES curriculum_units(id),
    unit_type varchar(30) NOT NULL,
    code varchar(80),
    name varchar(120) NOT NULL,
    position smallint NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT curriculum_units_book_subject_fk
        FOREIGN KEY (book_version_id, subject_id)
        REFERENCES book_versions(id, subject_id),
    CONSTRAINT curriculum_units_parent_check CHECK (parent_unit_id IS NULL OR parent_unit_id <> id),
    CONSTRAINT curriculum_units_position_check CHECK (position >= 0),
    CONSTRAINT curriculum_units_status_check CHECK (status IN ('active', 'inactive', 'archived'))
);

CREATE UNIQUE INDEX curriculum_units_scoped_code_unique
    ON curriculum_units(
        COALESCE(book_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(parent_unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
        code
    )
    WHERE code IS NOT NULL;

CREATE INDEX curriculum_units_parent_position_index
    ON curriculum_units(parent_unit_id, position);

CREATE TABLE curriculum_codes (
    id uuid PRIMARY KEY,
    curriculum_version varchar(40) NOT NULL,
    code_type varchar(30) NOT NULL,
    code varchar(80) NOT NULL,
    subject_id uuid NOT NULL REFERENCES subjects(id),
    grade_id uuid REFERENCES grades(id),
    name varchar(240),
    authority_name varchar(160) NOT NULL,
    source_reference text NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT curriculum_codes_code_type_check
        CHECK (code_type IN ('learning_content', 'learning_performance')),
    CONSTRAINT curriculum_codes_status_check CHECK (status IN ('active', 'inactive')),
    CONSTRAINT curriculum_codes_identity_unique UNIQUE (curriculum_version, code_type, code)
);

CREATE TABLE source_categories (
    id uuid PRIMARY KEY,
    code varchar(60) NOT NULL UNIQUE,
    name varchar(100) NOT NULL,
    exam_program_id uuid REFERENCES exam_programs(id),
    status varchar(20) NOT NULL DEFAULT 'active',
    sort_order smallint NOT NULL,
    CONSTRAINT source_categories_status_check CHECK (status IN ('active', 'inactive')),
    CONSTRAINT source_categories_sort_order_check CHECK (sort_order >= 0)
);

CREATE INDEX source_categories_program_status_index
    ON source_categories(exam_program_id, status);

CREATE TABLE source_category_dimensions (
    source_category_id uuid NOT NULL REFERENCES source_categories(id),
    dimension varchar(30) NOT NULL,
    native_requirement varchar(20) NOT NULL,
    sort_order smallint NOT NULL,
    PRIMARY KEY (source_category_id, dimension),
    CONSTRAINT source_category_dimensions_dimension_check
        CHECK (
            dimension IN (
                'grade',
                'semester',
                'book_version',
                'exam_level',
                'unit',
                'topic',
                'knowledge_point',
                'curriculum_code'
            )
        ),
    CONSTRAINT source_category_dimensions_requirement_check
        CHECK (native_requirement IN ('required', 'optional', 'not_applicable')),
    CONSTRAINT source_category_dimensions_sort_order_check CHECK (sort_order >= 0)
);

CREATE TABLE seed_manifests (
    id uuid PRIMARY KEY,
    catalog_key varchar(80) NOT NULL,
    version varchar(60) NOT NULL,
    source_reference text NOT NULL,
    content_checksum varchar(128) NOT NULL,
    item_count integer NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    applied_at timestamptz,
    migration_name varchar(160) NOT NULL,
    CONSTRAINT seed_manifests_identity_unique UNIQUE (catalog_key, version),
    CONSTRAINT seed_manifests_item_count_check CHECK (item_count >= 0),
    CONSTRAINT seed_manifests_status_check
        CHECK (status IN ('pending', 'applied', 'superseded', 'failed')),
    CONSTRAINT seed_manifests_applied_at_check
        CHECK (
            (status = 'applied' AND applied_at IS NOT NULL)
            OR (status <> 'applied' AND applied_at IS NULL)
        )
);

INSERT INTO schema_migrations (version, name)
VALUES ('0001', 'identity_and_catalog');

COMMIT;
