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
} from "../app/lib/admin/admin-input.ts";
import { AdminApiError } from "../app/lib/admin/admin-types.ts";
import {
    getQuestionDetail,
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
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-02T00:00:00Z",
        email_normalized: "parent@example.test",
        verified_at: null,
        role_names: ["parent", "system_admin"],
        active_learner_count: 1,
        active_session_count: 2,
        total_count: "1",
        password_hash: "must-not-leak",
        token_hash: "must-not-leak",
    }]);
    const query = parseAccountListQuery({
        search: "王家長",
        status: "active",
        role: "system_admin",
        createdFrom: "2026-10-01",
        createdTo: "2026-10-31",
        sort: "displayName",
        direction: "asc",
        page: "2",
        perPage: "10",
    });

    const page = await listAccounts(runner, query);
    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.emailVerified, false);
    assert.deepEqual(page.items[0]?.roles, ["parent", "system_admin"]);
    assert.doesNotMatch(JSON.stringify(page), /must-not-leak/u);

    const call = runner.calls[0];
    assert.ok(call);
    assert.match(call.text, /ORDER BY page_row\.sort_display_name ASC, page_row\.id ASC/iu);
    assert.match(call.text, /LEFT JOIN page AS page_row ON true/iu);
    const finalSelect = call.text.slice(call.text.lastIndexOf("SELECT page_row"));
    assert.match(finalSelect, /LEFT JOIN page AS page_row/iu);
    assert.doesNotMatch(finalSelect, /LEFT JOIN page ON true/iu);
    assert.deepEqual(call.values, [
        "王家長",
        ["active"],
        ["system_admin"],
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
        created_at: null,
        updated_at: null,
        email_normalized: null,
        verified_at: null,
        role_names: null,
        active_learner_count: null,
        active_session_count: null,
        total_count: "7",
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
            created_at: "2026-10-01T00:00:00Z",
            updated_at: "2026-10-02T00:00:00Z",
            closed_at: null,
            email_normalized: "parent@example.test",
            verified_at: "2026-10-01T01:00:00Z",
            role_names: ["parent"],
            active_learner_count: 1,
            active_session_count: 1,
            last_session_seen_at: "2026-10-02T02:00:00Z",
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
    assert.equal(detail.emailVerified, true);
    assert.equal(detail.learnerAccess[0]?.gradeName, "七年級");
    const serialized = JSON.stringify(detail);
    assert.doesNotMatch(serialized, /secret-password-hash/u);
    assert.doesNotMatch(serialized, /secret-provider-subject/u);
    for (const call of runner.calls) {
        assert.doesNotMatch(call.text, /password_hash|provider_subject|token_hash/iu);
        assert.deepEqual(call.values, [USER_ID]);
    }
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
    assert.doesNotMatch(JSON.stringify(page), /不可當作預覽的索引內容/u);
    assert.match(page.items[0]?.readOnlyReason ?? "", /不跨帳號改寫/u);
    const call = runner.calls[0];
    assert.ok(call);
    assert.match(call.text, /page_row\.sort_revision_number DESC, page_row\.id DESC/iu);
    assert.doesNotMatch(call.text, /方程式/u);
    assert.deepEqual(call.values, ["方程式", ["account"], 25, 0]);
});

test("question detail assembles revision children while omitting storage and import payloads", async () => {
    const runner = new FakeRunner((text) => {
        if (/FROM questions AS question/iu.test(text)) return [{
            id: QUESTION_ID,
            origin: "system",
            status: "published",
            created_method: "import",
            current_revision_id: REVISION_ID,
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
    const revision = detail.revisions[0];
    assert.equal(revision?.parts[0]?.options[0]?.key, "A");
    assert.equal(revision?.parts[0]?.answers[0]?.answerKey, "A");
    assert.equal(revision?.sources[0]?.documentTitle, "題庫");
    assert.equal(revision?.reviews[0]?.decision, "approved");
    assert.equal(detail.readOnly, false);
    const serialized = JSON.stringify(detail);
    assert.doesNotMatch(serialized, /must-not-leak/u);
    assert.doesNotMatch(serialized, /storage_key|draft_payload|pasted_text/iu);
    for (const call of runner.calls.slice(3)) {
        assert.deepEqual(call.values, [[REVISION_ID]]);
    }
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
