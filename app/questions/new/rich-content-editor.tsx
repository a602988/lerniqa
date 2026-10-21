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
} from "@keel-design/ui";
import { Check, GripVertical, Plus, Sigma, Table2, Trash2, Type, ZoomIn } from "lucide-react";
import { useState } from "react";
import { isUncertainBopomofoAlt, parseBopomofoCorrection } from "@/app/lib/bopomofo-recognition";
import type { ImportContentBlock } from "@/app/lib/question-import-contract";
import { FileSourcePicker } from "./file-source-picker";
import styles from "./question-import.module.css";

const CONTENT_BLOCK_DRAG_TYPE = "application/x-lerniqa-content-block";

interface RichContentEditorProps {
    blocks: ImportContentBlock[];
    description?: string;
    label: string;
    onChange: (blocks: ImportContentBlock[]) => void;
    onUploadImage: (file: File) => Promise<ImportContentBlock>;
}

interface BopomofoCropReviewProps {
    block: Extract<ImportContentBlock, { kind: "page_crop" }>;
    onConfirm: (value: string) => void;
}

/**
 * Keeps an uncertain source crop visible until the user transcribes its printed Bopomofo.
 *
 * @param props - The private crop and the replacement callback owned by the draft editor.
 * @returns An inline correction control with an enlarged source preview.
 */
function BopomofoCropReview({ block, onConfirm }: BopomofoCropReviewProps) {
    const [correction, setCorrection] = useState("");
    const parsed = parseBopomofoCorrection(correction);
    const errorId = `bopomofo-correction-${block.assetId}`;
    const sourceUrl = `/api/v1/question-import-assets/${block.assetId}`;

    return <section className={styles.bopomofoReview}>
        <Dialog>
            <DialogTrigger asChild>
                <button className={styles.bopomofoCropTrigger} type="button" aria-label="放大待確認的注音圖片">
                    <img src={sourceUrl} alt={block.alt} />
                    <span><ZoomIn />放大查看</span>
                </button>
            </DialogTrigger>
            <DialogContent size="xl" fullscreen="sm" closeLabel="關閉注音圖片">
                <DialogHeader>
                    <DialogTitle>放大待確認的注音</DialogTitle>
                    <DialogDescription>請逐字對照原稿，不要依詞義猜測。</DialogDescription>
                </DialogHeader>
                <DialogBody className={styles.bopomofoDialogBody}>
                    <img src={sourceUrl} alt={block.alt} />
                </DialogBody>
                <DialogFooter>
                    <DialogClose asChild><Button type="button">關閉</Button></DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        <div className={styles.bopomofoCorrection}>
            <div>
                <strong>確認圖片中的注音</strong>
                <p>如果原稿有引號或括號，請一起輸入。無法確認時保留圖片，不必猜測。</p>
            </div>
            <label>
                <span>原稿文字</span>
                <input
                    aria-describedby={correction && !parsed.ok ? errorId : undefined}
                    aria-invalid={correction ? !parsed.ok : undefined}
                    lang="zh-Bopo"
                    value={correction}
                    placeholder="例如：ㄇㄤˇ 或「ㄇㄤˇ」"
                    onChange={(event) => setCorrection(event.target.value)}
                />
            </label>
            {correction && !parsed.ok && <p className={styles.bopomofoError} id={errorId} role="alert">{parsed.message}</p>}
            <button
                className={styles.primary}
                disabled={!parsed.ok}
                type="button"
                onClick={() => { if (parsed.ok) onConfirm(parsed.value); }}
            >
                <Check />確認並替換
            </button>
        </div>
    </section>;
}

/**
 * Edits the ordered content blocks used by questions, options, hints, and explanations.
 *
 * @param props - Content, labels, and persistence callbacks owned by the parent draft editor.
 * @returns An ordered block editor that preserves every supported content kind.
 */
export function RichContentEditor({ blocks, description, label, onChange, onUploadImage }: RichContentEditorProps) {
    function patchBlock(index: number, block: ImportContentBlock) {
        onChange(blocks.map((current, currentIndex) => currentIndex === index ? block : current));
    }

    function moveBlock(index: number, offset: -1 | 1) {
        const target = index + offset;
        reorderBlock(index, target);
    }

    function reorderBlock(source: number, target: number) {
        if (source === target || source < 0 || target < 0 || source >= blocks.length || target >= blocks.length) return;
        const next = [...blocks];
        const [moved] = next.splice(source, 1);
        if (!moved) return;
        next.splice(target, 0, moved);
        onChange(next);
    }

    async function uploadImage(files: File[]) {
        const file = files[0];
        if (!file) return;
        const block = await onUploadImage(file);
        onChange([...blocks, block]);
    }

    return <section className={styles.contentEditor}>
        <div className={styles.contentHeading}>
            <div>
                <strong>{label}</strong>
                {description && <p>{description}</p>}
            </div>
            <div className={styles.contentActions}>
                <button type="button" onClick={() => onChange([...blocks, { kind: "text", text: "" }])}><Type />文字</button>
                <button type="button" onClick={() => onChange([...blocks, { kind: "formula", tex: "" }])}><Sigma />公式</button>
                <button type="button" onClick={() => onChange([...blocks, { kind: "table", rows: [[""]] }])}><Table2 />表格</button>
                <FileSourcePicker
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    camera
                    disabled={false}
                    driveMimeTypes={["image/jpeg", "image/png", "image/webp"]}
                    onFiles={uploadImage}
                    systemLabel="加入圖片"
                />
            </div>
        </div>
        {blocks.length === 0 && <button className={styles.emptyContent} type="button" onClick={() => onChange([{ kind: "text", text: "" }])}><Plus />加入內容</button>}
        <div className={styles.contentBlocks}>{blocks.map((block, index) => {
            const isPendingBopomofo = block.kind === "page_crop" && isUncertainBopomofoAlt(block.alt);
            const blockLabel = isPendingBopomofo ? "待確認注音" : block.kind === "text" ? "文字" : block.kind === "formula" ? "公式" : block.kind === "table" ? "表格" : "圖片";
            return <article
                className={styles.contentBlock}
                key={`${block.kind}-${index}`}
                onDragOver={(event) => {
                    if (event.dataTransfer.types.includes(CONTENT_BLOCK_DRAG_TYPE)) event.preventDefault();
                }}
                onDrop={(event) => {
                    const source = Number(event.dataTransfer.getData(CONTENT_BLOCK_DRAG_TYPE));
                    if (!Number.isInteger(source)) return;
                    event.preventDefault();
                    reorderBlock(source, index);
                }}
            >
                <div className={styles.blockMeta}>
                    <button
                        className={styles.dragHandle}
                        type="button"
                        draggable={blocks.length > 1}
                        disabled={blocks.length < 2}
                        aria-label={`拖移第 ${index + 1} 個${blockLabel}內容排序；可用方向鍵調整`}
                        title="拖移排序"
                        onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData(CONTENT_BLOCK_DRAG_TYPE, String(index));
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "ArrowUp") {
                                event.preventDefault();
                                moveBlock(index, -1);
                            }
                            if (event.key === "ArrowDown") {
                                event.preventDefault();
                                moveBlock(index, 1);
                            }
                        }}
                    >
                        <GripVertical />
                    </button>
                    <span>{blockLabel}</span>
                </div>
                <div className={styles.blockBody}>
                    {block.kind === "text" && <textarea aria-label={`${label}文字`} value={block.text} onChange={(event) => patchBlock(index, { kind: "text", text: event.target.value })} />}
                    {block.kind === "formula" && <input aria-label={`${label}公式`} value={block.tex} placeholder="例如：x^2 + y^2" onChange={(event) => patchBlock(index, { kind: "formula", tex: event.target.value })} />}
                    {block.kind === "table" && <textarea aria-label={`${label}表格`} value={block.rows.map((row) => row.join("\t")).join("\n")} placeholder="Tab 分欄，換行分列" onChange={(event) => patchBlock(index, { kind: "table", rows: event.target.value.split("\n").map((row) => row.split("\t")) })} />}
                    {isPendingBopomofo
                        ? <BopomofoCropReview block={block} onConfirm={(value) => patchBlock(index, { kind: "text", text: value })} />
                        : (block.kind === "image" || block.kind === "page_crop") && <div className={styles.imageBlock}>
                        <img src={`/api/v1/question-import-assets/${block.assetId}`} alt={block.alt} />
                        <label><span>圖片說明</span><input value={block.alt} maxLength={300} onChange={(event) => patchBlock(index, { ...block, alt: event.target.value })} /></label>
                    </div>}
                </div>
                <button className={styles.blockDelete} type="button" aria-label={isPendingBopomofo ? "待確認注音不可直接移除" : `移除第 ${index + 1} 個內容`} disabled={isPendingBopomofo} onClick={() => onChange(blocks.filter((_, currentIndex) => currentIndex !== index))}><Trash2 /></button>
        </article>})}</div>
    </section>;
}
