import { unstable_rethrow } from "next/navigation";

import { AdminNotice } from "@/app/components/admin/admin-notice";
import { AdminPage } from "@/app/components/admin/admin-page";
import {
    AdminTableActionCell,
    AdminTableBody,
    AdminTableCell,
    AdminTableEmptyState,
    AdminTableFrame,
    AdminTableHeadCell,
    AdminTableHeader,
    AdminTableRow,
} from "@/app/components/admin/admin-table";
import { QuestionRelationReviewActions } from "@/app/components/admin/views/question-relation-review-actions";
import { listPendingQuestionRelations } from "@/app/lib/admin/question-relation-review";
import { withAdminReadOnlySnapshot } from "@/app/lib/admin/admin-server";

import { readAdminPageAccessInSnapshot } from "../../admin-page-auth";

export default async function AdminQuestionRelationsPage() {
    try {
        return await withAdminReadOnlySnapshot(async (runner) => {
            const access = await readAdminPageAccessInSnapshot(runner);
            if (access.kind !== "authorized") return null;
            const snapshot = await listPendingQuestionRelations(runner);
            return (
                <AdminPage
                    title="題型關係審核"
                    eyebrow="Question relation review"
                    description="核對相同題型的文字骨架與解題邏輯，以及相近題目的關鍵字證據。"
                >
                    <AdminNotice title="待審資料不參與推薦" tone="info">
                        只有核准後的模板成員與關鍵字關聯會進入推薦；退回必須留下原因。
                    </AdminNotice>

                    <h2>相同題型模板（{snapshot.templateTotal}）</h2>
                    <AdminTableFrame aria-label="相同題型模板待審清單" minWidth={980}>
                        <AdminTableHeader>
                            <AdminTableRow>
                                <AdminTableHeadCell>文字骨架</AdminTableHeadCell>
                                <AdminTableHeadCell>解題邏輯</AdminTableHeadCell>
                                <AdminTableHeadCell>題目</AdminTableHeadCell>
                                <AdminTableHeadCell>操作</AdminTableHeadCell>
                            </AdminTableRow>
                        </AdminTableHeader>
                        <AdminTableBody>
                            {snapshot.templates.length === 0 ? (
                                <AdminTableEmptyState colSpan={4} title="目前沒有待審模板" description="分析結果匯入後會顯示在這裡。" />
                            ) : snapshot.templates.map((template) => (
                                <AdminTableRow key={template.id}>
                                    <AdminTableCell><strong>{template.normalizedPattern}</strong><br />{template.templateKey}</AdminTableCell>
                                    <AdminTableCell>{template.logicKey}</AdminTableCell>
                                    <AdminTableCell>
                                        {template.questionCount} 題<br />
                                        {template.prompts.slice(0, 3).join("／")}<br />
                                        變數：{template.variables.slice(0, 3).map((value) => JSON.stringify(value)).join("／")}<br />
                                        依據：{JSON.stringify(template.evidence)}
                                    </AdminTableCell>
                                    <AdminTableActionCell>
                                        <QuestionRelationReviewActions kind="template" targetId={template.id} />
                                    </AdminTableActionCell>
                                </AdminTableRow>
                            ))}
                        </AdminTableBody>
                    </AdminTableFrame>

                    <h2>相近題目關鍵字（{snapshot.keywordTotal}）</h2>
                    <AdminTableFrame aria-label="相近題目關鍵字待審清單" minWidth={980}>
                        <AdminTableHeader>
                            <AdminTableRow>
                                <AdminTableHeadCell>題目</AdminTableHeadCell>
                                <AdminTableHeadCell>關鍵字</AdminTableHeadCell>
                                <AdminTableHeadCell>種類</AdminTableHeadCell>
                                <AdminTableHeadCell>操作</AdminTableHeadCell>
                            </AdminTableRow>
                        </AdminTableHeader>
                        <AdminTableBody>
                            {snapshot.keywords.length === 0 ? (
                                <AdminTableEmptyState colSpan={4} title="目前沒有待審關鍵字" description="分析結果匯入後會顯示在這裡。" />
                            ) : snapshot.keywords.map((keyword) => (
                                <AdminTableRow key={`${keyword.revisionId}:${keyword.keywordId}`}>
                                    <AdminTableCell><strong>{keyword.prompt}</strong><br />{keyword.questionId}</AdminTableCell>
                                    <AdminTableCell>{keyword.label}<br />{keyword.keywordKey}<br />依據：{JSON.stringify(keyword.evidence)}</AdminTableCell>
                                    <AdminTableCell>{keyword.kind}</AdminTableCell>
                                    <AdminTableActionCell>
                                        <QuestionRelationReviewActions kind="keyword" targetId={keyword.keywordId} revisionId={keyword.revisionId} />
                                    </AdminTableActionCell>
                                </AdminTableRow>
                            ))}
                        </AdminTableBody>
                    </AdminTableFrame>
                    {(snapshot.templateTotal > snapshot.templates.length || snapshot.keywordTotal > snapshot.keywords.length) ? (
                        <AdminNotice title="清單尚未全部載入" tone="warning">
                            目前每類最多顯示 50 筆；完成這批審核後重新整理即可繼續下一批。
                        </AdminNotice>
                    ) : null}
                </AdminPage>
            );
        });
    }
    catch (error) {
        unstable_rethrow(error);
        return (
            <AdminPage title="題型關係審核" eyebrow="Question relation review">
                <AdminNotice title="無法載入題型關係" tone="danger">
                    管理後台資料庫暫時無法讀取，請稍後再試。
                </AdminNotice>
            </AdminPage>
        );
    }
}
