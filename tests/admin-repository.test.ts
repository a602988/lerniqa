import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import {
    getAccountDetail,
    listAccounts,
} from "../app/lib/admin/account-repository.ts";
import {
    type AdminQueryResult,
    type AdminQueryRunner,
    requireSystemAdmin,
    requireSystemAdminToken,
} from "../app/lib/admin/admin-auth.ts";
import {
    listAuditLogs,
    sanitizeAuditData,
} from "../app/lib/admin/audit-repository.ts";
import {
    parseAccountListQuery,
    parseAuditListQuery,
    parseQuestionListQuery,
    parseQuestionReviewQueueQuery,
} from "../app/lib/admin/admin-input.ts";
import { AdminApiError } from "../app/lib/admin/admin-types.ts";
import {
    getQuestionDetail,
    listQuestionFilterOptions,
    listQuestionReviewQueue,
    listQuestions,
} from "../app/lib/admin/question-repository.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const LEARNER_ID = "33333333-3333-4333-8333-333333333333";
const QUESTION_ID = "44444444-4444-4444-8444-444444444444";
const REVISION_ID = "55555555-5555-4555-8555-555555555555";
const PART_ID = "66666666-6666-4666-8666-666666666666";
const OPTION_ID = "77777777-7777-4777-8777-777777777777";
const TOKEN = "a".repeat(43);

interface QueryCall {
    text: string;
    values: readonly unknown[];
}

class FakeRunner implements AdminQueryRunner {
    readonly calls: QueryCall[] = [];
    private readonly resolve: (
        text: string,
        values: readonly unknown[],
        callIndex: number,
    ) => QueryResultRow[];

    constructor(
        resolve: (
            text: string,
            values: readonly unknown[],
            callIndex: number,
        ) => QueryResultRow[],
    ) {
        this.resolve = resolve;
    }

    async query<Row extends QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
    ): Promise<AdminQueryResult<Row>> {
        const callIndex = this.calls.length;
        this.calls.push({ text, values });
        return { rows: this.resolve(text, values, callIndex) as Row[] };
    }
}

function assertAdminError(
    action: () => Promise<unknown>,
    code: string,
    status: number,
): Promise<void> {
    return assert.rejects(action, (error: unknown) => {
        assert.ok(error instanceof AdminApiError);
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        return true;
    });
}

test("admin guard hashes the cookie server-side and does not trust activeRole", async () => {
    const runner = new FakeRunner(() => [{
        session_id: SESSION_ID,
        user_id: USER_ID,
        display_name: "管理員",
        expires_at: "2026-10-20T00:00:00.000Z",
        is_system_admin: true,
    }]);
    const request = new Request("http://127.0.0.1/admin", {
        headers: { cookie: `other=value; lerniqa_session=${TOKEN}` },
    });

    const actor = await requireSystemAdmin(request, runner);
    assert.equal(actor.userId, USER_ID);
    assert.equal(runner.calls.length, 1);
    const call = runner.calls[0];
    assert.ok(call);
    assert.match(String(call.values[0]), /^sha256:v1:[0-9a-f]{64}$/u);
    assert.notEqual(call.values[0], TOKEN);
    assert.doesNotMatch(call.text, /active_role\s*=\s*'system_admin'/iu);
    assert.match(call.text, /lerniqa_auth_session_is_valid/iu);
    assert.match(call.text, /admin_role\.role\s*=\s*'system_admin'/iu);
    assert.match(call.text, /app_user\.status\s*=\s*'active'/iu);
});

test("admin guard distinguishes missing authentication from missing authorization", async () => {
    await assertAdminError(
        () => requireSystemAdminToken(null, new FakeRunner(() => [])),
        "UNAUTHENTICATED",
        401,
    );
    await assertAdminError(
        () => requireSystemAdminToken(TOKEN, new FakeRunner(() => [])),
        "UNAUTHENTICATED",
        401,
    );
    await assertAdminError(
        () => requireSystemAdminToken(TOKEN, new FakeRunner(() => [{
            session_id: SESSION_ID,
            user_id: USER_ID,
            display_name: "一般帳號",
            expires_at: "2026-10-20T00:00:00Z",
            is_system_admin: false,
        }])),
        "FORBIDDEN",
        403,
    );
});

test("account list uses parameterized filters, allowlisted sort and a visible final alias", async () => {
    const runner = new FakeRunner(() => [{
        id: USER_ID,
        display_name: "王家長",
        status: "active",
        account_role: "parent",
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-02T00:00:00Z",
        email_normalized: "parent@example.test",
        verified_at: null,
        email_verification_state: "unverified",
        role_names: ["parent", "system_admin"],
        active_learner_count: 1,
        active_session_count: 2,
        total_count: "1",
        ambiguous_active_email_account_count: "0",
        password_hash: "must-not-leak",
        token_hash: "must-not-leak",
    }]);
    const query = parseAccountListQuery({
        search: "王家長",
        status: "active",
        accountRole: "parent",
        role: "system_admin",
        verification: "unverified",
        createdFrom: "2026-10-01",
        createdTo: "2026-10-31",
        sort: "displayName",
        direction: "asc",
        page: "2",
        perPage: "10",
    });

    const page = await listAccounts(runner, query);
    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.emailVerificationState, "unverified");
    assert.equal(page.items[0]?.accountRole, "parent");
    assert.deepEqual(page.items[0]?.roles, ["parent", "system_admin"]);
    assert.doesNotMatch(JSON.stringify(page), /must-not-leak/u);

    const call = runner.calls[0];
    assert.ok(call);
    assert.match(call.text, /ORDER BY page_row\.sort_display_name ASC, page_row\.id ASC/iu);
    assert.match(call.text, /app_user\.account_role = ANY\(\$3::varchar\[\]\)/iu);
    assert.match(call.text, /primary_identity\.verified_at IS NULL/iu);
    assert.match(call.text, /identity_integrity/iu);
    assert.match(call.text, /active_email_identity_count > 1/iu);
    assert.match(call.text, /FROM learner_access AS access/iu);
    assert.doesNotMatch(call.text, /user_learner_access/iu);
    assert.match(call.text, /LEFT JOIN page AS page_row ON true/iu);
    const finalSelect = call.text.slice(call.text.lastIndexOf("SELECT\n            page_row"));
    assert.match(finalSelect, /LEFT JOIN page AS page_row/iu);
    assert.doesNotMatch(finalSelect, /LEFT JOIN page ON true/iu);
    assert.deepEqual(call.values, [
        "王家長",
        ["active"],
        ["parent"],
        ["system_admin"],
        ["unverified"],
        "2026-10-01",
        "2026-10-31",
        10,
        10,
    ]);
    assert.doesNotMatch(call.text, /王家長/u);
});

test("account list preserves total on an empty page", async () => {
    const runner = new FakeRunner(() => [{
        id: null,
        display_name: null,
        status: null,
        account_role: null,
        created_at: null,
        updated_at: null,
        email_normalized: null,
        verified_at: null,
        email_verification_state: null,
        role_names: null,
        active_learner_count: null,
        active_session_count: null,
        total_count: "7",
        ambiguous_active_email_account_count: "0",
    }]);
    const page = await listAccounts(runner, parseAccountListQuery({ page: "9" }));
    assert.deepEqual(page.items, []);
    assert.equal(page.total, 7);
});

test("account detail exposes safe identity evidence without credential fields", async () => {
    const runner = new FakeRunner((text) => {
        if (/FROM users AS app_user/iu.test(text)) return [{
            id: USER_ID,
            display_name: "王家長",
            status: "active",
            account_role: "parent",
            created_at: "2026-10-01T00:00:00Z",
            updated_at: "2026-10-02T00:00:00Z",
            closed_at: null,
            email_normalized: "parent@example.test",
            verified_at: "2026-10-01T01:00:00Z",
            email_verification_state: "verified",
            role_names: ["parent"],
            active_learner_count: 1,
            active_session_count: 1,
            last_session_seen_at: "2026-10-02T02:00:00Z",
            active_email_identity_count: 1,
        }];
        if (/FROM account_identities AS identity/iu.test(text)) return [{
            id: SESSION_ID,
            provider: "email",
            email_normalized: "parent@example.test",
            verified_at: "2026-10-01T01:00:00Z",
            created_at: "2026-10-01T00:00:00Z",
            revoked_at: null,
            password_hash: "secret-password-hash",
            provider_subject: "secret-provider-subject",
        }];
        if (/FROM user_roles AS role/iu.test(text)) return [{
            id: SESSION_ID,
            role: "parent",
            granted_at: "2026-10-01T00:00:00Z",
            revoked_at: null,
        }];
        if (/FROM learner_access AS access/iu.test(text)) return [{
            id: SESSION_ID,
            learner_id: LEARNER_ID,
            learner_display_name: "學生",
            learner_status: "active",
            access_role: "parent",
            grade_code: "junior-high-1",
            grade_name: "七年級",
            semester_code: "semester-1",
            semester_name: "上學期",
            accepted_at: "2026-10-01T00:00:00Z",
            revoked_at: null,
            can_view_results: true,
            can_create_plans: true,
            can_review_answers: true,
            can_manage_settings: true,
        }];
        return [];
    });

    const detail = await getAccountDetail(runner, USER_ID);
    assert.equal(detail.emailVerificationState, "verified");
    assert.equal(detail.accountRole, "parent");
    assert.equal(detail.learnerAccess[0]?.gradeName, "七年級");
    assert.equal(detail.learnerAccess[0]?.learnerStatus, "active");
    const serialized = JSON.stringify(detail);
    assert.doesNotMatch(serialized, /secret-password-hash/u);
    assert.doesNotMatch(serialized, /secret-provider-subject/u);
    for (const call of runner.calls) {
        assert.doesNotMatch(call.text, /password_hash|provider_subject|token_hash/iu);
        assert.deepEqual(call.values, [USER_ID]);
    }
});

test("account repository fails closed for ambiguous active email identities", async () => {
    const listRunner = new FakeRunner(() => [{
        id: null,
        display_name: null,
        status: null,
        account_role: null,
        created_at: null,
        updated_at: null,
        email_normalized: null,
        verified_at: null,
        email_verification_state: null,
        role_names: null,
        active_learner_count: null,
        active_session_count: null,
        total_count: "0",
        ambiguous_active_email_account_count: "1",
    }]);
    await assertAdminError(
        () => listAccounts(listRunner, parseAccountListQuery({})),
        "INTERNAL_ERROR",
        500,
    );
    assert.doesNotMatch(
        listRunner.calls[0]?.text ?? "",
        /ORDER BY identity\.created_at, identity\.id\s+LIMIT 1/iu,
    );

    const detailRunner = new FakeRunner(() => [{
        id: USER_ID,
        display_name: "歧義帳號",
        status: "active",
        account_role: "parent",
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-02T00:00:00Z",
        closed_at: null,
        email_normalized: "first@example.test",
        verified_at: null,
        email_verification_state: "unverified",
        role_names: ["parent"],
        active_learner_count: 0,
        active_session_count: 0,
        last_session_seen_at: null,
        active_email_identity_count: 2,
    }]);
    await assertAdminError(
        () => getAccountDetail(detailRunner, USER_ID),
        "INTERNAL_ERROR",
        500,
    );
    assert.equal(detailRunner.calls.length, 1);
});

test("question list has deterministic sorting and marks account-owned questions read-only", async () => {
    const runner = new FakeRunner(() => [{
        id: QUESTION_ID,
        origin: "account",
        status: "published",
        created_method: "manual",
        owner_user_id: USER_ID,
        owner_display_name: "王家長",
        created_at: "2026-10-01T00:00:00Z",
        current_revision_id: REVISION_ID,
        current_revision_number: 2,
        current_revision_status: "published",
        prompt_preview: "解下列一元一次方程式",
        search_text: "不可當作預覽的索引內容",
        published_at: "2026-10-02T00:00:00Z",
        question_type_code: "single-choice",
        question_type_name: "單選題",
        subject_code: "math",
        subject_name: "數學",
        grade_code: "junior-high-1",
        grade_name: "七年級",
        difficulty_code: "medium",
        difficulty_name: "中等",
        revision_count: 2,
        source_count: 1,
        bank_memberships: [
            {
                id: SESSION_ID,
                name: "王家題庫",
                origin: "account",
                status: "active",
            },
        ],
        total_count: 1,
    }]);
    const query = parseQuestionListQuery({
        search: "方程式",
        origin: "account",
        sort: "revisionNumber",
        direction: "desc",
    });
    const page = await listQuestions(runner, query);
    assert.equal(page.items[0]?.readOnly, true);
    assert.equal(page.items[0]?.currentRevision?.promptPreview, "解下列一元一次方程式");
    assert.equal(page.items[0]?.banks[0]?.name, "王家題庫");
    assert.doesNotMatch(JSON.stringify(page), /不可當作預覽的索引內容/u);
    assert.match(page.items[0]?.readOnlyReason ?? "", /不跨帳號改寫/u);
    const call = runner.calls[0];
    assert.ok(call);
    assert.match(call.text, /page_row\.sort_revision_number DESC, page_row\.id DESC/iu);
    assert.doesNotMatch(call.text, /方程式/u);
    assert.deepEqual(call.values, ["方程式", ["account"], 25, 0]);
});

test("question list applies only parameterized catalog, bank, revision and review filters", async () => {
    const runner = new FakeRunner(() => []);
    const query = parseQuestionListQuery({
        revisionStatus: "published",
        reviewStatus: "approved",
        bankId: SESSION_ID,
        subjectId: LEARNER_ID,
        gradeId: USER_ID,
        semesterId: PART_ID,
        bookVersionId: OPTION_ID,
        publisherId: REVISION_ID,
        sourceCategoryId: QUESTION_ID,
        difficultyId: SESSION_ID,
    });
    await listQuestions(runner, query);
    const call = runner.calls[0];
    assert.ok(call);
    assert.match(call.text, /question_bank_items AS filtered_bank_item/iu);
    assert.match(
        call.text,
        /SELECT filtered_review\.decision[\s\S]*ORDER BY filtered_review\.created_at DESC, filtered_review\.id DESC[\s\S]*LIMIT 1[\s\S]*\) = ANY/iu,
    );
    assert.doesNotMatch(
        call.text,
        /WHERE filtered_review\.question_revision_id = revision\.id\s+AND filtered_review\.decision = ANY/iu,
    );
    assert.match(call.text, /revision\.subject_id = \$4::uuid/iu);
    assert.match(call.text, /filtered_book\.publisher_id = \$10::uuid/iu);
    assert.doesNotMatch(call.text, new RegExp(REVISION_ID, "iu"));
    assert.deepEqual(call.values, [
        ["published"],
        ["approved"],
        SESSION_ID,
        LEARNER_ID,
        USER_ID,
        PART_ID,
        OPTION_ID,
        QUESTION_ID,
        SESSION_ID,
        REVISION_ID,
        25,
        0,
    ]);
});

test("pending question review queue uses the latest review, system scope and stable pagination", async () => {
    const draftId = "88888888-8888-4888-8888-888888888888";
    const runner = new FakeRunner(() => [{
        question_id: QUESTION_ID,
        question_status: "published",
        current_revision_id: REVISION_ID,
        current_revision_number: 2,
        draft_revision_id: draftId,
        draft_revision_number: 3,
        prompt_preview: "第四課待審題目",
        change_note: "修正參考答案",
        latest_review_decision: "changes_requested",
        latest_review_reason: "答案仍需校正",
        latest_review_at: "2026-10-16T01:00:00Z",
        created_by_type: "user",
        created_by_user_id: USER_ID,
        creator_display_name: "題庫編修員",
        created_at: "2026-10-16T00:00:00Z",
        total_count: "1",
    }]);
    const query = parseQuestionReviewQueueQuery({
        search: "第四課",
        reviewState: "changes_requested",
        page: "2",
        perPage: "10",
    });
    const page = await listQuestionReviewQueue(runner, query);
    assert.equal(page.items[0]?.draftRevisionId, draftId);
    assert.equal(page.items[0]?.state, "changes_requested");
    assert.equal(page.items[0]?.latestReviewReason, "答案仍需校正");
    assert.deepEqual({ page: page.page, pageSize: page.pageSize, total: page.total }, {
        page: 2,
        pageSize: 10,
        total: 1,
    });

    const call = runner.calls[0];
    assert.ok(call);
    assert.match(call.text, /question\.origin = 'system'/u);
    assert.match(call.text, /question\.status <> 'archived'/u);
    assert.match(call.text, /draft\.status = 'draft'/u);
    assert.match(
        call.text,
        /ORDER BY review\.created_at DESC, review\.id DESC[\s\S]*LIMIT 1/u,
    );
    assert.match(call.text, /ORDER BY created_at ASC, draft_revision_id ASC/u);
    assert.doesNotMatch(call.text, /第四課/u);
    assert.deepEqual(call.values, ["第四課", ["changes_requested"], 10, 10]);
});

test("pending question review queue preserves totals when the requested page is empty", async () => {
    const runner = new FakeRunner(() => [{
        question_id: null,
        question_status: null,
        current_revision_id: null,
        current_revision_number: null,
        draft_revision_id: null,
        draft_revision_number: null,
        prompt_preview: null,
        change_note: null,
        latest_review_decision: null,
        latest_review_reason: null,
        latest_review_at: null,
        created_by_type: null,
        created_by_user_id: null,
        creator_display_name: null,
        created_at: null,
        total_count: "31",
    }]);
    const page = await listQuestionReviewQueue(
        runner,
        parseQuestionReviewQueueQuery({ page: "3", perPage: "10" }),
    );
    assert.deepEqual(page.items, []);
    assert.equal(page.total, 31);
});

test("question filter catalog exposes labels and IDs without inventing parallel data", async () => {
    const runner = new FakeRunner(() => [
        { kind: "banks", id: SESSION_ID, label: "系統題庫" },
        { kind: "subjects", id: LEARNER_ID, label: "數學 (math)" },
        { kind: "difficulties", id: REVISION_ID, label: "中等 (medium)" },
    ]);
    const options = await listQuestionFilterOptions(runner);
    assert.deepEqual(options.banks, [{ id: SESSION_ID, label: "系統題庫" }]);
    assert.deepEqual(options.subjects, [{ id: LEARNER_ID, label: "數學 (math)" }]);
    assert.deepEqual(options.difficulties, [{ id: REVISION_ID, label: "中等 (medium)" }]);
    assert.deepEqual(options.publishers, []);
    assert.match(runner.calls[0]?.text ?? "", /FROM question_banks AS bank/iu);
    assert.doesNotMatch(runner.calls[0]?.text ?? "", /owner_user_id|storage_key/iu);
});

test("question detail assembles revision children while omitting storage and import payloads", async () => {
    const runner = new FakeRunner((text) => {
        if (/FROM questions AS question/iu.test(text)) return [{
            id: QUESTION_ID,
            origin: "system",
            status: "published",
            created_method: "import",
            current_revision_id: REVISION_ID,
            current_revision_number: 1,
            current_revision_created_by_user_id: USER_ID,
            owner_user_id: null,
            owner_display_name: null,
            created_by_user_id: USER_ID,
            creator_display_name: "匯入管理員",
            created_at: "2026-09-01T00:00:00Z",
            archived_at: null,
        }];
        if (/FROM question_identifiers AS identifier/iu.test(text)) return [{
            id: SESSION_ID,
            identifier_type: "legacy",
            value: "Q-001",
            publisher_name: null,
            book_version_name: null,
            source_document_id: null,
        }];
        if (/SELECT count\(\*\) AS total_count\s+FROM question_revisions/iu.test(text)) {
            return [{ total_count: 1 }];
        }
        if (/FROM question_revisions AS revision/iu.test(text)) return [{
            id: REVISION_ID,
            revision_number: 1,
            status: "published",
            original_question_type_label: "單選",
            search_text: "題目文字",
            change_note: null,
            question_type_id: SESSION_ID,
            question_type_code: "single-choice",
            question_type_name: "單選題",
            subject_id: null,
            subject_code: null,
            subject_name: null,
            grade_id: null,
            grade_code: null,
            grade_name: null,
            semester_id: null,
            semester_code: null,
            semester_name: null,
            book_version_id: null,
            book_version_name: null,
            exam_program_level_id: null,
            exam_level_code: null,
            exam_level_name: null,
            difficulty_level_id: null,
            difficulty_code: null,
            difficulty_name: null,
            source_category_id: null,
            source_category_code: null,
            source_category_name: null,
            created_by_type: "user",
            created_by_user_id: USER_ID,
            creator_display_name: "匯入管理員",
            created_at: "2026-09-01T00:00:00Z",
            published_at: "2026-09-02T00:00:00Z",
        }];
        if (/FROM question_parts/iu.test(text)) return [{
            id: PART_ID,
            question_revision_id: REVISION_ID,
            parent_part_id: null,
            stable_key: "main",
            position: 0,
            answer_mode: "single_choice",
            grading_policy: "automatic",
            is_independently_gradable: true,
        }];
        if (/FROM question_options AS option/iu.test(text)) return [{
            id: OPTION_ID,
            question_revision_id: REVISION_ID,
            question_part_id: PART_ID,
            option_key: "A",
            position: 0,
        }];
        if (/FROM question_answers AS answer/iu.test(text)) return [{
            id: SESSION_ID,
            question_revision_id: REVISION_ID,
            question_part_id: PART_ID,
            answer_key: "A",
            accepted_value: null,
            position: 0,
        }];
        if (/FROM question_content_blocks/iu.test(text)) return [{
            id: SESSION_ID,
            question_revision_id: REVISION_ID,
            question_part_id: PART_ID,
            question_option_id: null,
            parent_block_id: null,
            placement: "prompt",
            content_type: "text",
            position: 0,
            text_content: "1 + 1 = ?",
            asset_id: null,
            alt_text: null,
        }];
        if (/FROM question_revision_sources AS source/iu.test(text)) return [{
            id: SESSION_ID,
            question_revision_id: REVISION_ID,
            source_document_id: LEARNER_ID,
            input_type: "pdf",
            original_file_name: "題庫.pdf",
            document_title: "題庫",
            document_status: "ready",
            source_page: 1,
            source_question_number: "1",
            crop_asset_id: null,
            is_primary: true,
            storage_key: "must-not-leak",
            pasted_text: "must-not-leak",
            draft_payload: "must-not-leak",
        }];
        if (/FROM question_revision_reviews AS review/iu.test(text)) return [{
            id: SESSION_ID,
            question_revision_id: REVISION_ID,
            reviewer_type: "user",
            reviewer_user_id: USER_ID,
            reviewer_display_name: "審核員",
            decision: "approved",
            reason: null,
            from_status: "draft",
            to_status: "published",
            created_at: "2026-09-02T00:00:00Z",
        }];
        return [];
    });

    const detail = await getQuestionDetail(runner, QUESTION_ID);
    const revision = detail.displayRevision;
    assert.equal(revision?.parts[0]?.options[0]?.key, "A");
    assert.equal(revision?.parts[0]?.answers[0]?.answerKey, "A");
    assert.equal(revision?.sources[0]?.documentTitle, "題庫");
    assert.equal(revision?.reviews[0]?.decision, "approved");
    assert.equal(detail.revisionHistory.total, 1);
    assert.equal(detail.revisionHistory.pageSize, 10);
    assert.equal(detail.readOnly, false);
    assert.equal(detail.currentRevisionNumber, 1);
    assert.equal(detail.currentRevisionCreatedByUserId, USER_ID);
    const serialized = JSON.stringify(detail);
    assert.doesNotMatch(serialized, /must-not-leak/u);
    assert.doesNotMatch(serialized, /storage_key|draft_payload|pasted_text/iu);
    const historyCall = runner.calls.find((call) =>
        /admin_question_revision_history/iu.test(call.text));
    assert.deepEqual(historyCall?.values, [QUESTION_ID, 10, 0]);
    const displayCall = runner.calls.find((call) =>
        /admin_question_display_revision/iu.test(call.text));
    assert.deepEqual(displayCall?.values, [QUESTION_ID, REVISION_ID]);
    assert.match(runner.calls[0]?.text ?? "", /LEFT JOIN question_revisions AS current_revision/iu);
    for (const call of runner.calls.filter((candidate) => /ANY\(\$1::uuid\[\]\)/u.test(candidate.text))) {
        assert.deepEqual(call.values, [[REVISION_ID]]);
    }
});

test("question list preserves a missing current revision instead of inventing version zero", async () => {
    const runner = new FakeRunner(() => [{
        id: QUESTION_ID,
        origin: "system",
        status: "draft",
        created_method: "manual",
        owner_user_id: null,
        owner_display_name: null,
        created_at: "2026-10-01T00:00:00Z",
        current_revision_id: null,
        current_revision_number: null,
        current_revision_status: null,
        prompt_preview: null,
        published_at: null,
        question_type_code: null,
        question_type_name: null,
        subject_code: null,
        subject_name: null,
        grade_code: null,
        grade_name: null,
        difficulty_code: null,
        difficulty_name: null,
        revision_count: 0,
        source_count: 0,
        bank_memberships: [],
        total_count: 1,
    }]);
    const page = await listQuestions(runner, parseQuestionListQuery({}));
    assert.equal(page.items[0]?.currentRevision, null);
    assert.equal(JSON.stringify(page).includes('"number":0'), false);
});

test("audit repository applies action-specific JSON allowlists", async () => {
    const runner = new FakeRunner(() => [{
        id: SESSION_ID,
        actor_type: "user",
        actor_user_id: USER_ID,
        actor_display_name: "管理員",
        action: "account_status_changed",
        target_type: "user",
        target_id: QUESTION_ID,
        before_data: {
            status: "active",
            email: "private@example.test",
            tokenHash: "secret-token",
        },
        after_data: JSON.stringify({
            status: "suspended",
            reason: "安全檢查",
            revokedSessionCount: 2,
            passwordHash: "secret-password",
        }),
        request_id: "88888888-8888-4888-8888-888888888888",
        created_at: "2026-10-16T00:00:00Z",
        source_ip: "192.0.2.1",
        user_agent: "private-agent",
        total_count: "1",
    }]);
    const page = await listAuditLogs(
        runner,
        parseAuditListQuery({ sort: "action", direction: "asc" }),
    );
    assert.deepEqual(page.items[0]?.before, { status: "active" });
    assert.deepEqual(page.items[0]?.after, {
        status: "suspended",
        reason: "安全檢查",
        revokedSessionCount: 2,
    });
    const serialized = JSON.stringify(page);
    assert.doesNotMatch(serialized, /private@example|secret-token|secret-password|192\.0\.2\.1|private-agent/u);
    const call = runner.calls[0];
    assert.ok(call);
    assert.match(call.text, /page_row\.action ASC, page_row\.id ASC/iu);
    assert.doesNotMatch(call.text, /source_ip|user_agent/iu);

    assert.equal(
        sanitizeAuditData("unknown_action", { status: "active" }),
        null,
    );
});
