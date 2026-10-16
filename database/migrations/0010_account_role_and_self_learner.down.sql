BEGIN;

DROP TRIGGER learner_access_self_learner_check ON learner_access;
DROP TRIGGER learners_self_learner_check ON learners;
DROP TRIGGER users_self_learner_check ON users;
DROP FUNCTION lerniqa_validate_self_learner_identity();

DROP TRIGGER user_roles_account_identity_role_check ON user_roles;
DROP TRIGGER learner_access_account_identity_role_check ON learner_access;
DROP TRIGGER learners_account_identity_role_check ON learners;
DROP TRIGGER account_identities_account_role_check ON account_identities;
DROP TRIGGER users_account_identity_role_check ON users;
DROP FUNCTION lerniqa_validate_account_identity_role();

DROP TRIGGER learners_account_self_lock ON learners;
DROP TRIGGER learner_access_account_self_lock ON learner_access;
DROP FUNCTION lerniqa_lock_self_learner_change();

DROP TRIGGER users_account_invariants_user_lock ON users;
DROP TRIGGER account_identities_account_role_user_lock ON account_identities;

DROP INDEX learner_access_active_self_user_unique;

ALTER TABLE users
DROP CONSTRAINT users_account_role_check,
DROP COLUMN account_role;

-- Permission and name repairs are intentionally forward-only. The old values
-- cannot be distinguished from legitimate edits made after migration 0010.
DELETE FROM schema_migrations WHERE version = '0010';

COMMIT;
