"use client";

import {
    Button,
    Dialog,
    DialogBody,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    FormField,
    Input,
} from "@keel-design/ui";
import {
    type FormEvent,
    type ReactNode,
    useEffect,
    useId,
    useRef,
    useState,
} from "react";

import { AdminNotice } from "../admin-notice";
import { AppSelect as NativeSelect } from "../../app-select";
import { useAppRouter } from "../../navigation-feedback";
import type {
    SubscriptionFeatureDefinitionDto,
    SubscriptionFeatureLimitDto,
    SubscriptionPlanDetailDto,
    SubscriptionPriceDto,
} from "./view-types";
import {
    type CatalogRetryEvidence,
    resolveCatalogMutationAttempt,
} from "./subscription-catalog-client";
import {
    subscriptionBillingIntervalLabel,
    subscriptionCatalogStatusLabel,
} from "./subscription-catalog-labels";

import styles from "./views.module.css";

type MutationMethod = "POST" | "PATCH" | "PUT";

interface MutationErrorBody {
    error?: { message?: unknown };
}

function formString(data: FormData, key: string): string {
    const value = data.get(key);
    return typeof value === "string" ? value : "";
}

function formOptionalString(data: FormData, key: string): string | null {
    const value = formString(data, key).trim();
    return value || null;
}

function formInteger(data: FormData, key: string): number {
    return Number(formString(data, key));
}

async function mutateCatalog(
    endpoint: string,
    method: MutationMethod,
    serializedBody: string,
    idempotencyKey: string,
): Promise<void> {
    const response = await fetch(endpoint, {
        method,
        credentials: "same-origin",
        headers: {
            "content-type": "application/json",
            "x-lerniqa-csrf": "same-origin",
            "idempotency-key": idempotencyKey,
        },
        body: serializedBody,
    });
    if (response.ok) return;

    let message = "系統暫時無法完成操作，請重新載入後再試。";
    try {
        const result = await response.json() as MutationErrorBody;
        if (typeof result.error?.message === "string") message = result.error.message;
    }
    catch {
        // Keep the fixed client-safe fallback; never render a raw response.
    }
    throw new Error(message);
}

function CatalogMutationDialog({
    trigger,
    title,
    description,
    submitLabel,
    endpoint,
    method = "POST",
    buildBody,
    children,
    disabled = false,
}: {
    trigger: string;
    title: string;
    description: string;
    submitLabel: string;
    endpoint: string;
    method?: MutationMethod;
    buildBody(data: FormData): Readonly<Record<string, unknown>>;
    children?: ReactNode;
    disabled?: boolean;
}) {
    const router = useAppRouter();
    const retryEvidence = useRef<CatalogRetryEvidence | null>(null);
    const errorRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!error) return;
        errorRef.current?.focus();
        errorRef.current?.scrollIntoView({ block: "nearest" });
    }, [error]);

    function handleOpenChange(nextOpen: boolean): void {
        if (!nextOpen && pending) return;
        setOpen(nextOpen);
        if (nextOpen) setError(null);
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        setError(null);
        try {
            const attempt = resolveCatalogMutationAttempt(
                retryEvidence.current,
                method,
                endpoint,
                buildBody(new FormData(event.currentTarget)),
                () => crypto.randomUUID(),
            );
            retryEvidence.current = attempt.evidence;
            await mutateCatalog(
                endpoint,
                method,
                attempt.serializedBody,
                attempt.evidence.idempotencyKey,
            );
            retryEvidence.current = null;
            setOpen(false);
            router.refresh();
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : "無法完成管理操作。");
        }
        finally {
            setPending(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button type="button" appearance="outline" tone="primary" disabled={disabled}>
                    {trigger}
                </Button>
            </DialogTrigger>
            <DialogContent size="md" closeLabel={`關閉${title}`}>
                <form className={styles.catalogForm} onSubmit={submit}>
                    <DialogHeader>
                        <DialogTitle>{title}</DialogTitle>
                        <DialogDescription>{description}</DialogDescription>
                    </DialogHeader>
                    <DialogBody className={styles.catalogFormBody}>
                        {error ? (
                            <div ref={errorRef} tabIndex={-1}>
                                <AdminNotice title="未完成操作" tone="danger" live="assertive">
                                    {error}
                                </AdminNotice>
                            </div>
                        ) : null}
                        {children}
                    </DialogBody>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button type="button" appearance="outline" tone="muted" disabled={pending}>
                                取消
                            </Button>
                        </DialogClose>
                        <Button type="submit" appearance="solid" tone="primary" disabled={pending}>
                            {pending ? "送出中…" : submitLabel}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function FeatureDefinitionTypeFields({
    prefix,
    initialType = "boolean",
    initialUnit = null,
}: {
    prefix: string;
    initialType?: "boolean" | "integer";
    initialUnit?: string | null;
}) {
    const [valueType, setValueType] = useState<"boolean" | "integer">(initialType);
    return (
        <>
            <FormField label="值類型" htmlFor={`${prefix}-type`}>
                <NativeSelect
                    id={`${prefix}-type`}
                    name="valueType"
                    value={valueType}
                    onChange={(event) => setValueType(
                        event.currentTarget.value === "integer" ? "integer" : "boolean",
                    )}
                    options={[
                        { value: "boolean", label: "布林（包含／不包含）" },
                        { value: "integer", label: "整數（有限或無上限）" },
                    ]}
                />
            </FormField>
            {valueType === "integer" ? (
                <FormField label="單位代碼" htmlFor={`${prefix}-unit`}>
                    <Input
                        id={`${prefix}-unit`}
                        name="unit"
                        defaultValue={initialUnit ?? ""}
                        maxLength={40}
                        autoComplete="off"
                        required
                    />
                </FormField>
            ) : null}
        </>
    );
}

export function SubscriptionCatalogActions({
    featureDefinitions,
}: {
    featureDefinitions: readonly SubscriptionFeatureDefinitionDto[];
}) {
    const planPrefix = useId();
    const featurePrefix = useId();
    return (
        <section id="catalog-actions" className={styles.subscriptionActionStack} aria-label="方案目錄操作">
            <div className={styles.catalogActions}>
                <CatalogMutationDialog
                trigger="建立方案草稿"
                title="建立方案草稿"
                description="建立 catalog 草稿；不會建立訂閱、付款或扣款。"
                submitLabel="建立草稿"
                endpoint="/api/v1/admin/subscription-plans"
                buildBody={(data) => ({
                    code: formString(data, "code"),
                    name: formString(data, "name"),
                    description: formOptionalString(data, "description"),
                    status: "draft",
                })}
            >
                <FormField label="方案代碼" htmlFor={`${planPrefix}-code`}>
                    <Input id={`${planPrefix}-code`} name="code" required maxLength={40} autoComplete="off" />
                </FormField>
                <FormField label="方案名稱" htmlFor={`${planPrefix}-name`}>
                    <Input id={`${planPrefix}-name`} name="name" required maxLength={80} autoComplete="off" />
                </FormField>
                <FormField label="方案說明" htmlFor={`${planPrefix}-description`}>
                    <Input id={`${planPrefix}-description`} name="description" maxLength={500} autoComplete="off" />
                </FormField>
                </CatalogMutationDialog>

                <CatalogMutationDialog
                trigger="建立功能定義"
                title="建立功能定義"
                description="布林功能只有包含／不包含；整數功能必須填寫穩定的單位代碼。"
                submitLabel="建立功能草稿"
                endpoint="/api/v1/admin/subscription-plans/feature-definitions"
                buildBody={(data) => ({
                    featureKey: formString(data, "featureKey"),
                    displayName: formString(data, "displayName"),
                    description: formOptionalString(data, "description"),
                    valueType: formString(data, "valueType"),
                    unit: formOptionalString(data, "unit"),
                })}
            >
                <FormField label="功能代碼" htmlFor={`${featurePrefix}-key`}>
                    <Input id={`${featurePrefix}-key`} name="featureKey" required maxLength={80} autoComplete="off" />
                </FormField>
                <FormField label="顯示名稱" htmlFor={`${featurePrefix}-name`}>
                    <Input id={`${featurePrefix}-name`} name="displayName" required maxLength={120} autoComplete="off" />
                </FormField>
                <FormField label="功能說明" htmlFor={`${featurePrefix}-description`}>
                    <Input id={`${featurePrefix}-description`} name="description" maxLength={500} autoComplete="off" />
                </FormField>
                <FeatureDefinitionTypeFields prefix={featurePrefix} />
                </CatalogMutationDialog>
            </div>

            {featureDefinitions.length > 0 ? (
                <section className={styles.catalogSubsection} aria-labelledby="feature-definition-actions">
                    <h3 id="feature-definition-actions">功能定義狀態</h3>
                    <ul className={styles.catalogActionList}>
                        {featureDefinitions.map((definition) => (
                            <li key={definition.id}>
                                <span>
                                    {definition.displayName}（{definition.featureKey}）— {subscriptionCatalogStatusLabel(definition.status)}
                                </span>
                                <span className={styles.catalogActions}>
                                    {definition.status !== "retired" ? (
                                        <FeatureDefinitionEditAction definition={definition} />
                                    ) : null}
                                    {definition.status === "draft" ? (
                                        <StatusAction
                                            trigger="啟用功能"
                                            title="啟用功能定義"
                                            description="啟用後，啟用中的方案才能包含這項功能。"
                                            endpoint={`/api/v1/admin/subscription-plans/feature-definitions/${definition.id}/status`}
                                            expectedLockVersion={definition.lockVersion}
                                            targetStatus="active"
                                        />
                                    ) : null}
                                    {definition.status !== "retired" ? (
                                        <StatusAction
                                            trigger="停用功能"
                                            title="停用功能定義"
                                            description="若仍有啟用方案包含此功能，系統會拒絕停用。停用後不可復原。"
                                            endpoint={`/api/v1/admin/subscription-plans/feature-definitions/${definition.id}/status`}
                                            expectedLockVersion={definition.lockVersion}
                                            targetStatus="retired"
                                        />
                                    ) : null}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
        </section>
    );
}

function FeatureDefinitionEditAction({
    definition,
}: {
    definition: SubscriptionFeatureDefinitionDto;
}) {
    const prefix = useId();
    const typeLocked = definition.status !== "draft";
    return (
        <CatalogMutationDialog
            trigger="編輯功能"
            title={`編輯「${definition.displayName}」`}
            description={typeLocked
                ? "功能已啟用，值類型與單位已鎖定；仍可修正名稱與說明。"
                : "功能代碼建立後固定不變；啟用後值類型與單位也會鎖定。"}
            submitLabel="儲存功能"
            endpoint={`/api/v1/admin/subscription-plans/feature-definitions/${definition.id}`}
            method="PATCH"
            buildBody={(data) => ({
                expectedLockVersion: definition.lockVersion,
                displayName: formString(data, "displayName"),
                description: formOptionalString(data, "description"),
                valueType: typeLocked
                    ? definition.valueType
                    : formString(data, "valueType"),
                unit: typeLocked
                    ? definition.unit
                    : formOptionalString(data, "unit"),
            })}
        >
            <FormField label="顯示名稱" htmlFor={`${prefix}-name`}>
                <Input
                    id={`${prefix}-name`}
                    name="displayName"
                    defaultValue={definition.displayName}
                    required
                    maxLength={120}
                />
            </FormField>
            <FormField label="功能說明" htmlFor={`${prefix}-description`}>
                <Input
                    id={`${prefix}-description`}
                    name="description"
                    defaultValue={definition.description ?? ""}
                    maxLength={500}
                />
            </FormField>
            {typeLocked ? (
                <p>
                    值類型：{definition.valueType === "boolean" ? "布林" : "整數"}
                    {definition.unit ? `；單位：${definition.unit}` : ""}
                </p>
            ) : (
                <FeatureDefinitionTypeFields
                    prefix={prefix}
                    initialType={definition.valueType}
                    initialUnit={definition.unit}
                />
            )}
        </CatalogMutationDialog>
    );
}

function PlanMetadataAction({ plan }: { plan: SubscriptionPlanDetailDto }) {
    const prefix = useId();
    return (
        <CatalogMutationDialog
            trigger="編輯方案資料"
            title="編輯方案資料"
            description="方案代碼建立後固定不變。這項操作不會影響任何付款系統。"
            submitLabel="儲存方案"
            endpoint={`/api/v1/admin/subscription-plans/${plan.id}`}
            method="PATCH"
            disabled={plan.status === "retired"}
            buildBody={(data) => ({
                expectedLockVersion: plan.lockVersion,
                name: formString(data, "name"),
                description: formOptionalString(data, "description"),
            })}
        >
            <FormField label="方案名稱" htmlFor={`${prefix}-name`}>
                <Input id={`${prefix}-name`} name="name" defaultValue={plan.name} required maxLength={80} />
            </FormField>
            <FormField label="方案說明" htmlFor={`${prefix}-description`}>
                <Input id={`${prefix}-description`} name="description" defaultValue={plan.description ?? ""} maxLength={500} />
            </FormField>
        </CatalogMutationDialog>
    );
}

function StatusAction({
    trigger,
    title,
    description,
    endpoint,
    expectedLockVersion,
    targetStatus,
    disabled = false,
}: {
    trigger: string;
    title: string;
    description: string;
    endpoint: string;
    expectedLockVersion: number;
    targetStatus: "active" | "retired";
    disabled?: boolean;
}) {
    return (
        <CatalogMutationDialog
            trigger={trigger}
            title={title}
            description={description}
            submitLabel={trigger}
            endpoint={endpoint}
            disabled={disabled}
            buildBody={() => ({ expectedLockVersion, targetStatus })}
        >
            <AdminNotice tone={targetStatus === "retired" ? "warning" : "info"}>
                {targetStatus === "active"
                    ? "啟用後可供方案目錄選用。"
                    : "停用是終態，不能再退回草稿或重新啟用。"}
            </AdminNotice>
        </CatalogMutationDialog>
    );
}

function PriceCreateAction({ plan }: { plan: SubscriptionPlanDetailDto }) {
    const prefix = useId();
    return (
        <CatalogMutationDialog
            trigger="建立價格草稿"
            title="建立價格草稿"
            description="金額使用 ISO 幣別的 minor unit 整數。改價請建立新草稿；舊啟用價格先停用，再啟用新價格。"
            submitLabel="建立價格"
            endpoint={`/api/v1/admin/subscription-plans/${plan.id}/prices`}
            disabled={plan.status === "retired"}
            buildBody={(data) => ({
                currency: formString(data, "currency").toUpperCase(),
                amountMinor: formInteger(data, "amountMinor"),
                billingInterval: formString(data, "billingInterval"),
                billingIntervalCount: formInteger(data, "billingIntervalCount"),
                status: "draft",
                effectiveFrom: formOptionalString(data, "effectiveFrom"),
                effectiveUntil: formOptionalString(data, "effectiveUntil"),
            })}
        >
            <div className={styles.catalogFieldGrid}>
                <FormField label="ISO 4217 幣別" htmlFor={`${prefix}-currency`}>
                    <Input id={`${prefix}-currency`} name="currency" defaultValue="TWD" required minLength={3} maxLength={3} autoComplete="off" />
                </FormField>
                <FormField label="Minor unit 金額" htmlFor={`${prefix}-amount`}>
                    <Input id={`${prefix}-amount`} name="amountMinor" type="number" min={0} max={999999999} step={1} required />
                </FormField>
                <FormField label="計費週期" htmlFor={`${prefix}-interval`}>
                    <NativeSelect
                        id={`${prefix}-interval`}
                        name="billingInterval"
                        defaultValue="month"
                        options={[
                            { value: "day", label: "日" },
                            { value: "week", label: "週" },
                            { value: "month", label: "月" },
                            { value: "year", label: "年" },
                        ]}
                    />
                </FormField>
                <FormField label="週期倍數" htmlFor={`${prefix}-interval-count`}>
                    <Input id={`${prefix}-interval-count`} name="billingIntervalCount" type="number" min={1} max={365} step={1} defaultValue={1} required />
                </FormField>
                <FormField label="生效日" htmlFor={`${prefix}-from`}>
                    <Input id={`${prefix}-from`} name="effectiveFrom" type="date" />
                </FormField>
                <FormField label="結束日" htmlFor={`${prefix}-until`}>
                    <Input id={`${prefix}-until`} name="effectiveUntil" type="date" />
                </FormField>
            </div>
        </CatalogMutationDialog>
    );
}

function PriceUpdateAction({
    plan,
    price,
}: {
    plan: SubscriptionPlanDetailDto;
    price: SubscriptionPriceDto;
}) {
    const prefix = useId();
    const activeEndDateOnly = price.status === "active";
    return (
        <CatalogMutationDialog
            trigger={activeEndDateOnly ? "設定結束日" : "編輯價格"}
            title={activeEndDateOnly ? "設定價格結束日" : "編輯價格草稿"}
            description={activeEndDateOnly
                ? "啟用價格只能設定一次原本未填寫的結束日；金額、幣別、週期與生效日均不可修改。"
                : "價格離開草稿後，金額、幣別、週期與生效日都會鎖定。"}
            submitLabel={activeEndDateOnly ? "設定結束日" : "儲存價格"}
            endpoint={`/api/v1/admin/subscription-plans/${plan.id}/prices/${price.id}`}
            method="PATCH"
            buildBody={(data) => ({
                expectedLockVersion: price.lockVersion,
                currency: activeEndDateOnly
                    ? price.currency
                    : formString(data, "currency").toUpperCase(),
                amountMinor: activeEndDateOnly
                    ? price.amountMinor
                    : formInteger(data, "amountMinor"),
                billingInterval: activeEndDateOnly
                    ? price.billingInterval
                    : formString(data, "billingInterval"),
                billingIntervalCount: activeEndDateOnly
                    ? price.billingIntervalCount
                    : formInteger(data, "billingIntervalCount"),
                effectiveFrom: activeEndDateOnly
                    ? price.effectiveFrom
                    : formOptionalString(data, "effectiveFrom"),
                effectiveUntil: formOptionalString(data, "effectiveUntil"),
            })}
        >
            {activeEndDateOnly ? (
                <FormField label="結束日" htmlFor={`${prefix}-until`}>
                    <Input
                        id={`${prefix}-until`}
                        name="effectiveUntil"
                        type="date"
                        min={price.effectiveFrom ?? undefined}
                        required
                    />
                </FormField>
            ) : (
                <div className={styles.catalogFieldGrid}>
                    <FormField label="ISO 4217 幣別" htmlFor={`${prefix}-currency`}>
                        <Input
                            id={`${prefix}-currency`}
                            name="currency"
                            defaultValue={price.currency}
                            required
                            minLength={3}
                            maxLength={3}
                            autoComplete="off"
                        />
                    </FormField>
                    <FormField label="Minor unit 金額" htmlFor={`${prefix}-amount`}>
                        <Input
                            id={`${prefix}-amount`}
                            name="amountMinor"
                            type="number"
                            min={0}
                            max={999999999}
                            step={1}
                            defaultValue={price.amountMinor}
                            required
                        />
                    </FormField>
                    <FormField label="計費週期" htmlFor={`${prefix}-interval`}>
                        <NativeSelect
                            id={`${prefix}-interval`}
                            name="billingInterval"
                            defaultValue={price.billingInterval}
                            options={[
                                { value: "day", label: "日" },
                                { value: "week", label: "週" },
                                { value: "month", label: "月" },
                                { value: "year", label: "年" },
                            ]}
                        />
                    </FormField>
                    <FormField label="週期倍數" htmlFor={`${prefix}-interval-count`}>
                        <Input
                            id={`${prefix}-interval-count`}
                            name="billingIntervalCount"
                            type="number"
                            min={1}
                            max={365}
                            step={1}
                            defaultValue={price.billingIntervalCount}
                            required
                        />
                    </FormField>
                    <FormField label="生效日" htmlFor={`${prefix}-from`}>
                        <Input
                            id={`${prefix}-from`}
                            name="effectiveFrom"
                            type="date"
                            defaultValue={price.effectiveFrom ?? ""}
                        />
                    </FormField>
                    <FormField label="結束日" htmlFor={`${prefix}-until`}>
                        <Input
                            id={`${prefix}-until`}
                            name="effectiveUntil"
                            type="date"
                            defaultValue={price.effectiveUntil ?? ""}
                        />
                    </FormField>
                </div>
            )}
        </CatalogMutationDialog>
    );
}

type FeatureLimitMode = "excluded" | "included" | "finite" | "unlimited";

function featureMode(
    definition: SubscriptionFeatureDefinitionDto,
    current: SubscriptionFeatureLimitDto | undefined,
): FeatureLimitMode {
    if (!current?.included) return "excluded";
    if (definition.valueType === "boolean") return "included";
    return current.unlimited ? "unlimited" : "finite";
}

function FeatureLimitAction({
    plan,
    definition,
    current,
}: {
    plan: SubscriptionPlanDetailDto;
    definition: SubscriptionFeatureDefinitionDto;
    current?: SubscriptionFeatureLimitDto;
}) {
    const prefix = useId();
    const integerFeature = definition.valueType === "integer";
    const [mode, setMode] = useState<FeatureLimitMode>(featureMode(definition, current));
    useEffect(() => {
        setMode(featureMode(definition, current));
    }, [definition.valueType, current?.included, current?.limit, current?.unlimited]);
    return (
        <CatalogMutationDialog
            trigger={current ? "調整限制" : "設定限制"}
            title={`設定「${definition.displayName}」`}
            description={integerFeature
                ? `整數功能單位：${definition.unit ?? "未設定"}。可設有限數量或無上限。`
                : "布林功能只表示包含或不包含。"}
            submitLabel="儲存限制"
            endpoint={`/api/v1/admin/subscription-plans/${plan.id}/feature-limits/${definition.id}`}
            method="PUT"
            disabled={plan.status === "retired"}
            buildBody={(data) => ({
                expectedLockVersion: current?.lockVersion ?? null,
                included: mode !== "excluded",
                unlimited: mode === "unlimited",
                limit: mode === "finite" ? formInteger(data, "limit") : null,
            })}
        >
            <FormField label="包含方式" htmlFor={`${prefix}-mode`}>
                <NativeSelect
                    id={`${prefix}-mode`}
                    name="mode"
                    value={mode}
                    onChange={(event) => setMode(event.currentTarget.value as FeatureLimitMode)}
                    options={integerFeature
                        ? [
                              { value: "excluded", label: "不包含" },
                              { value: "finite", label: "包含，有限數量" },
                              { value: "unlimited", label: "包含，無上限" },
                          ]
                        : [
                              { value: "excluded", label: "不包含" },
                              { value: "included", label: "包含" },
                          ]}
                />
            </FormField>
            {integerFeature && mode === "finite" ? (
                <FormField label={`有限數量（${definition.unit ?? "單位"}）`} htmlFor={`${prefix}-limit`}>
                    <Input
                        id={`${prefix}-limit`}
                        name="limit"
                        type="number"
                        min={0}
                        max={999999999}
                        step={1}
                        defaultValue={current?.limit ?? 0}
                        required
                    />
                </FormField>
            ) : null}
        </CatalogMutationDialog>
    );
}

export function SubscriptionPlanActions({
    plan,
    featureDefinitions,
}: {
    plan: SubscriptionPlanDetailDto;
    featureDefinitions: readonly SubscriptionFeatureDefinitionDto[];
}) {
    return (
        <div className={styles.subscriptionActionStack}>
            <div className={styles.catalogActions}>
                <PlanMetadataAction plan={plan} />
                <PriceCreateAction plan={plan} />
                {plan.status === "draft" ? (
                    <StatusAction
                        trigger="啟用方案"
                        title="啟用方案目錄"
                        description="啟用後可再新增價格與限制，但方案狀態不能回到草稿。"
                        endpoint={`/api/v1/admin/subscription-plans/${plan.id}/status`}
                        expectedLockVersion={plan.lockVersion}
                        targetStatus="active"
                    />
                ) : null}
                {plan.status !== "retired" ? (
                    <StatusAction
                        trigger="停用方案"
                        title="停用方案"
                        description="必須先停用所有草稿與啟用中的價格。停用後不可復原。"
                        endpoint={`/api/v1/admin/subscription-plans/${plan.id}/status`}
                        expectedLockVersion={plan.lockVersion}
                        targetStatus="retired"
                    />
                ) : null}
            </div>

            <section className={styles.catalogSubsection} aria-labelledby="catalog-price-actions">
                <h3 id="catalog-price-actions">價格狀態</h3>
                {plan.prices.length === 0 ? <p>尚無價格。</p> : (
                    <ul className={styles.catalogActionList}>
                        {plan.prices.map((price: SubscriptionPriceDto) => (
                            <li key={price.id}>
                                <span>
                                    {price.currency} {price.amountMinor}（minor unit）／
                                    {price.billingIntervalCount} {subscriptionBillingIntervalLabel(price.billingInterval)}
                                </span>
                                <span className={styles.catalogActions}>
                                    {price.status === "draft" || (
                                        price.status === "active" && price.effectiveUntil === null
                                    ) ? (
                                        <PriceUpdateAction plan={plan} price={price} />
                                    ) : null}
                                    {price.status === "draft" ? (
                                        <StatusAction
                                            trigger="啟用價格"
                                            title="啟用價格"
                                            description="同方案、幣別與週期只能有一筆啟用價格。若要改價，請先停用舊價格。"
                                            endpoint={`/api/v1/admin/subscription-plans/${plan.id}/prices/${price.id}/status`}
                                            expectedLockVersion={price.lockVersion}
                                            targetStatus="active"
                                            disabled={plan.status !== "active"}
                                        />
                                    ) : null}
                                    {price.status !== "retired" ? (
                                        <StatusAction
                                            trigger="停用價格"
                                            title="停用價格"
                                            description="停用後不可復原；後續價格請建立新草稿。"
                                            endpoint={`/api/v1/admin/subscription-plans/${plan.id}/prices/${price.id}/status`}
                                            expectedLockVersion={price.lockVersion}
                                            targetStatus="retired"
                                        />
                                    ) : null}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className={styles.catalogSubsection} aria-labelledby="catalog-feature-actions">
                <h3 id="catalog-feature-actions">功能限制</h3>
                {featureDefinitions.length === 0 ? <p>尚無功能定義。</p> : (
                    <ul className={styles.catalogActionList}>
                        {featureDefinitions.map((definition) => {
                            const current = plan.featureLimits.find(
                                (limit) => limit.featureDefinitionId === definition.id,
                            );
                            return (
                                <li key={definition.id}>
                                    <span>{definition.displayName}（{definition.featureKey}）</span>
                                    <FeatureLimitAction
                                        plan={plan}
                                        definition={definition}
                                        current={current}
                                    />
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
        </div>
    );
}
