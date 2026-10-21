\set ON_ERROR_STOP on

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM schema_migrations
        WHERE version = '0025' AND name = 'account_question_taxonomy'
    ) THEN
        RAISE EXCEPTION '0025 migration 紀錄不存在';
    END IF;
END;
$$;

INSERT INTO users(id,display_name)
VALUES('25000000-0000-4000-8000-000000000001','第二個分類測試帳號');

INSERT INTO filter_fields(
    id,key,name,value_type,selection_mode,sort_order,status,origin,owner_user_id
) VALUES
    ('25000000-0000-4000-8000-000000000011','content-kind','內容類型','option','single',0,'active','account','00000000-0000-0000-0000-000000000001'),
    ('25000000-0000-4000-8000-000000000012','content-kind','內容類型','option','single',0,'active','account','25000000-0000-4000-8000-000000000001');

INSERT INTO filter_field_scopes(id,filter_field_id,name)
VALUES('25000000-0000-4000-8000-000000000021','25000000-0000-4000-8000-000000000011','英文分類');

INSERT INTO filter_field_scope_subjects(filter_field_scope_id,subject_id,effect)
VALUES('25000000-0000-4000-8000-000000000021','50000000-0000-0000-0000-000000000001','include');

INSERT INTO filter_field_options(id,filter_field_id,value,label,sort_order)
VALUES('25000000-0000-4000-8000-000000000031','25000000-0000-4000-8000-000000000011','vocabulary','單字',0);

DO $$
BEGIN
    IF (SELECT count(*) FROM filter_fields WHERE key='content-kind' AND origin='account') <> 2 THEN
        RAISE EXCEPTION '不同帳號無法使用自己的分類鍵值';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM filter_fields AS field
        JOIN filter_field_scopes AS scope ON scope.filter_field_id=field.id
        JOIN filter_field_scope_subjects AS subject_scope ON subject_scope.filter_field_scope_id=scope.id
        JOIN filter_field_options AS option ON option.filter_field_id=field.id
        WHERE field.owner_user_id='00000000-0000-0000-0000-000000000001'
          AND subject_scope.subject_id='50000000-0000-0000-0000-000000000001'
          AND option.label='單字'
    ) THEN
        RAISE EXCEPTION '帳號分類欄位、科目範圍與選項關聯不完整';
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'filter_fields' AND column_name = 'owner_user_id'
    ) THEN
        RAISE EXCEPTION 'filter_fields 缺少帳號擁有者欄位';
    END IF;
END;
$$;
