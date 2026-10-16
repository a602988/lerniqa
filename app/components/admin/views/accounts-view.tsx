import { Button, Card, CardContent, CardHeader, CardTitle } from "@keel-design/ui";

import { AdminNotice } from "../admin-notice";
import { AdminPage } from "../admin-page";
import { AdminStatusBadge } from "../admin-status-badge";
import {
    AdminTableActionCell,
    AdminTableBody,
    AdminTableCell,
    AdminTableEmptyState,
    AdminTableErrorState,
    AdminTableFrame,
    AdminTableHeadCell,
    AdminTableHeader,
    AdminTableLoadingState,
    AdminTableRow,
} from "../admin-table";
import { RouteDrawer } from "./route-drawer";
import type { AccountsViewProps, ViewSortLinkDto } from "./view-types";
import {
    ActionPolicyControl,
    DetailList,
    MobileListState,
    MobileRecordCard,
    MobileRecordList,
    ViewFilters,
    ViewPagination,
    ViewSortHeader,
    formatViewValue,
    sortLinkFor,
} from "./view-shared";

import styles from "./views.module.css";

const roleLabels: Record<string, string> = {
    parent: "家長",
    learner: "學習者",
    tutor: "導師",
    system_admin: "系統管理員",
};

const accountStatusLabels: Record<string, string> = {
    active: "啟用",
    suspended: "已停權",
    closed: "已關閉",
};

const learnerPermissionLabels = {
    canViewResults: "查看學習成果",
    canCreatePlans: "建立練習計畫",
    canReviewAnswers: "審核答案",
    canManageSettings: "修改學習者設定",
} as const;

function identityVerificationLabel(
    state: "verified" | "unverified" | "not_applicable",
    verifiedAt: string | null,
) {
    if (state === "not_applicable") return "不適用";
    if (state === "unverified") return "未驗證";
    return verifiedAt ? `已驗證（${verifiedAt}）` : "已驗證";
}

function RoleBadge({ role }: { role: string }) {
    return (
        <AdminStatusBadge
            status={role}
            label={roleLabels[role] ?? role}
            tone={role === "system_admin" ? "primary" : "light"}
        />
    );
}

function HeaderCell({
    sorts,
    sortKey,
    label,
}: {
    sorts: readonly ViewSortLinkDto[];
    sortKey: string;
    label: string;
}) {
    const sort = sortLinkFor(sorts, sortKey);
    return sort ? (
        <ViewSortHeader sort={sort} />
    ) : (
        <AdminTableHeadCell>{label}</AdminTableHeadCell>
    );
}

export function AccountsView({
    state,
    filters,
    sorts,
    rows,
    pagination,
    detail,
    detailCloseHref,
}: AccountsViewProps) {
    const hasActiveFilters =
        Boolean(filters.search?.value.trim()) ||
        Boolean(filters.selects?.some((select) => select.value.trim()));
    const emptyState = hasActiveFilters
        ? {
              title: "找不到符合條件的帳號",
              description: "請調整搜尋字詞或篩選條件。",
          }
        : {
              title: "尚無註冊帳號",
              description: "帳號完成註冊後，會顯示在這裡。",
          };

    return (
        <AdminPage
            title="帳號管理"
            eyebrow="Accounts"
            description="查詢註冊帳號、身份、有效角色與學習者存取關係。敏感異動依伺服器政策決定是否開放。"
        >
            <div className={styles.viewStack}>
                <ViewFilters filters={filters} />

                <div className={styles.desktopRecordTable}>
                    <AdminTableFrame
                        aria-label="帳號清單"
                        minWidth={1080}
                        footer={<ViewPagination pagination={pagination} />}
                    >
                    <AdminTableHeader>
                        <AdminTableRow>
                            <HeaderCell sorts={sorts} sortKey="displayName" label="帳號" />
                            <HeaderCell sorts={sorts} sortKey="email" label="主要信箱" />
                            <HeaderCell sorts={sorts} sortKey="status" label="狀態" />
                            <HeaderCell sorts={sorts} sortKey="accountRole" label="帳號身份" />
                            <AdminTableHeadCell>有效權限</AdminTableHeadCell>
                            <AdminTableHeadCell>學習者</AdminTableHeadCell>
                            <HeaderCell sorts={sorts} sortKey="createdAt" label="註冊時間" />
                            <AdminTableHeadCell>操作</AdminTableHeadCell>
                        </AdminTableRow>
                    </AdminTableHeader>
                    <AdminTableBody>
                        {state.kind === "loading" ? (
                            <AdminTableLoadingState
                                colSpan={8}
                                title={state.message ?? "正在載入帳號"}
                            />
                        ) : state.kind === "error" ? (
                            <AdminTableErrorState
                                colSpan={8}
                                description={state.message}
                                retryHref={state.retryHref ?? ""}
                                retryLabel={state.retryLabel}
                            />
                        ) : rows.length === 0 ? (
                            <AdminTableEmptyState
                                colSpan={8}
                                title={emptyState.title}
                                description={emptyState.description}
                            />
                        ) : (
                            rows.map((account) => (
                                <AdminTableRow key={account.id}>
                                    <AdminTableCell>
                                        <div className={styles.primaryCell}>
                                            <strong>{account.displayName}</strong>
                                            <span>{account.id}</span>
                                        </div>
                                    </AdminTableCell>
                                    <AdminTableCell className={styles.longValue}>
                                        {formatViewValue(account.primaryEmail)}
                                    </AdminTableCell>
                                    <AdminTableCell>
                                        <AdminStatusBadge status={account.status} />
                                    </AdminTableCell>
                                    <AdminTableCell>
                                        {account.accountRole ? (
                                            <RoleBadge role={account.accountRole} />
                                        ) : (
                                            "未填"
                                        )}
                                    </AdminTableCell>
                                    <AdminTableCell>
                                        {account.activeRoles.length === 0 ? (
                                            <span className={styles.mutedText}>無資料</span>
                                        ) : (
                                            <div className={styles.badgeList}>
                                                {account.activeRoles.map((role) => (
                                                    <RoleBadge key={role} role={role} />
                                                ))}
                                            </div>
                                        )}
                                    </AdminTableCell>
                                    <AdminTableCell className={styles.numericCell}>
                                        {account.learnerCount}
                                    </AdminTableCell>
                                    <AdminTableCell>{account.createdAt}</AdminTableCell>
                                    <AdminTableActionCell>
                                        <Button asChild size="sm" appearance="outline" tone="primary">
                                            <a href={account.detailHref}>查看</a>
                                        </Button>
                                    </AdminTableActionCell>
                                </AdminTableRow>
                            ))
                        )}
                    </AdminTableBody>
                    </AdminTableFrame>
                </div>

                <MobileRecordList label="帳號清單（行動版）">
                    {state.kind === "loading" ? (
                        <MobileListState
                            kind="loading"
                            title={state.message ?? "正在載入帳號"}
                        />
                    ) : state.kind === "error" ? (
                        <MobileListState
                            kind="error"
                            title="無法載入帳號"
                            description={state.message}
                            action={
                                <Button asChild appearance="outline" tone="primary">
                                    <a href={state.retryHref ?? ""}>
                                        {state.retryLabel ?? "重新載入"}
                                    </a>
                                </Button>
                            }
                        />
                    ) : rows.length === 0 ? (
                        <MobileListState
                            kind="empty"
                            title={emptyState.title}
                            description={emptyState.description}
                        />
                    ) : (
                        <>
                            {rows.map((account) => (
                                <MobileRecordCard
                                    key={account.id}
                                    title={account.displayName}
                                    subtitle={account.primaryEmail ?? "未填"}
                                    badges={
                                        <>
                                            <AdminStatusBadge status={account.status} />
                                            {account.accountRole ? (
                                                <RoleBadge role={account.accountRole} />
                                            ) : null}
                                        </>
                                    }
                                    fields={[
                                        {
                                            label: "有效權限",
                                            value:
                                                account.activeRoles.length === 0 ? (
                                                    "無資料"
                                                ) : (
                                                    <div className={styles.badgeList}>
                                                        {account.activeRoles.map((role) => (
                                                            <RoleBadge key={role} role={role} />
                                                        ))}
                                                    </div>
                                                ),
                                        },
                                        { label: "學習者", value: account.learnerCount },
                                        { label: "註冊時間", value: account.createdAt },
                                        { label: "帳號 ID", value: account.id },
                                    ]}
                                    action={
                                        <Button asChild appearance="outline" tone="primary">
                                            <a href={account.detailHref}>查看帳號詳情</a>
                                        </Button>
                                    }
                                />
                            ))}
                            <div className={styles.mobilePagination}>
                                <ViewPagination pagination={pagination} />
                            </div>
                        </>
                    )}
                </MobileRecordList>
            </div>

            <RouteDrawer
                open={detail !== null}
                closeHref={detailCloseHref}
                title={detail?.displayName ?? "帳號詳情"}
                description={detail ? `帳號 ID：${detail.id}` : "帳號詳情"}
            >
                {detail ? (
                    <div className={styles.drawerStack}>
                        <DetailList
                            items={[
                                { label: "主要信箱", value: detail.primaryEmail },
                                {
                                    label: "帳號狀態",
                                    value:
                                        accountStatusLabels[detail.status] ?? detail.status,
                                },
                                {
                                    label: "帳號身份（accountRole）",
                                    value: detail.accountRole
                                        ? (roleLabels[detail.accountRole] ?? detail.accountRole)
                                        : null,
                                },
                                { label: "註冊時間", value: detail.createdAt },
                                { label: "更新時間", value: detail.updatedAt },
                            ]}
                        />

                        <AdminNotice title="權限欄位說明" tone="info">
                            帳號身份、目前操作模式與有效角色授權是不同資料；本頁不以身份欄位推定管理員權限。
                        </AdminNotice>

                        <Card>
                            <CardHeader>
                                <CardTitle asChild>
                                    <h2>登入身份</h2>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {detail.identities.length === 0 ? (
                                    <AdminNotice tone="muted">無資料</AdminNotice>
                                ) : (
                                    <ul className={styles.detailItems}>
                                        {detail.identities.map((identity) => (
                                            <li key={identity.id}>
                                                <div>
                                                    <strong>{identity.providerLabel}</strong>
                                                    <span className={styles.longValue}>
                                                        {identity.identifier}
                                                    </span>
                                                </div>
                                                <span>
                                                    驗證：
                                                    {identityVerificationLabel(
                                                        identity.verificationState,
                                                        identity.verifiedAt,
                                                    )}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle asChild>
                                    <h2>角色授權紀錄</h2>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {detail.roles.length === 0 ? (
                                    <AdminNotice tone="muted">無資料</AdminNotice>
                                ) : (
                                    <ul className={styles.detailItems}>
                                        {detail.roles.map((grant) => (
                                            <li key={grant.id}>
                                                <div className={styles.badgeList}>
                                                    <RoleBadge role={grant.role} />
                                                    <AdminStatusBadge
                                                        status={grant.revokedAt ? "revoked" : "active"}
                                                    />
                                                </div>
                                                <span>
                                                    授予：{grant.grantedAt}；撤銷：
                                                    {formatViewValue(grant.revokedAt, "未撤銷")}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle asChild>
                                    <h2>學習者存取</h2>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {detail.learnerAccess.length === 0 ? (
                                    <AdminNotice tone="muted">無資料</AdminNotice>
                                ) : (
                                    <ul className={styles.detailItems}>
                                        {detail.learnerAccess.map((learner) => (
                                            <li key={learner.id}>
                                                <strong>{learner.learnerName}</strong>
                                                <span>
                                                    年級：{formatViewValue(learner.gradeLabel)}；學期：
                                                    {formatViewValue(learner.semesterLabel)}；關係：
                                                    {learner.accessRole}
                                                </span>
                                                <span>
                                                    權限：
                                                    {Object.entries(learner.permissions)
                                                        .filter(([, enabled]) => enabled)
                                                        .map(
                                                            ([permission]) =>
                                                                learnerPermissionLabels[
                                                                    permission as keyof typeof learnerPermissionLabels
                                                                ],
                                                        )
                                                        .join("、") || "無"}
                                                    ；撤銷：
                                                    {formatViewValue(
                                                        learner.revokedAt,
                                                        "未撤銷",
                                                    )}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle asChild>
                                    <h2>安全異動</h2>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className={styles.policyStack}>
                                <ActionPolicyControl
                                    title="帳號狀態"
                                    policy={detail.statusPolicy}
                                />
                                <ActionPolicyControl
                                    title="角色與管理權限"
                                    policy={detail.rolePolicy}
                                />
                            </CardContent>
                        </Card>
                    </div>
                ) : null}
            </RouteDrawer>
        </AdminPage>
    );
}
