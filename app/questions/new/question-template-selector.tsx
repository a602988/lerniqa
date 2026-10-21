"use client";

import { CheckSquare2, CircleDot, Images, ListTree, MessageSquareText, Rows3, TextCursorInput, ToggleLeft } from "lucide-react";
import type { ReactNode } from "react";
import { QUESTION_TEMPLATES, type QuestionTemplateIcon, type QuestionTemplateId } from "@/app/lib/question-authoring-templates";
import styles from "./question-import.module.css";

const TEMPLATE_ICONS = {
    circle: CircleDot,
    image: Images,
    checks: CheckSquare2,
    toggle: ToggleLeft,
    input: TextCursorInput,
    rows: Rows3,
    message: MessageSquareText,
    tree: ListTree,
} satisfies Record<QuestionTemplateIcon, typeof CircleDot>;

type SingleTemplateSelectorProps = {
    selectionMode?: "single";
    selected: QuestionTemplateId;
    onSelect: (templateId: QuestionTemplateId) => void;
    preview: ReactNode;
};

type MultipleTemplateSelectorProps = {
    selectionMode: "multiple";
    selected: QuestionTemplateId[];
    onSelect: (templateIds: QuestionTemplateId[]) => void;
    preview: ReactNode;
};

type QuestionTemplateSelectorProps = SingleTemplateSelectorProps | MultipleTemplateSelectorProps;

/**
 * 顯示手動建立與格式匯入共用的題型清單。
 *
 * @param props 單選或多選模式的受控選取狀態與預覽內容。
 * @returns 題型選擇器。
 */
export function QuestionTemplateSelector(props: QuestionTemplateSelectorProps) {
    const multiple = props.selectionMode === "multiple";
    const selectedIds = multiple ? props.selected : [props.selected];

    function selectTemplate(templateId: QuestionTemplateId) {
        if (!multiple) {
            props.onSelect(templateId);
            return;
        }
        const selected = props.selected.includes(templateId)
            ? props.selected.filter((id) => id !== templateId)
            : [...props.selected, templateId];
        props.onSelect(selected);
    }

    return <div className={styles.templateLayout}>
        <div>
            {multiple && <div className={styles.templateSelectionTools}>
                <span>已選 {selectedIds.length} 種題型</span>
                <button
                    type="button"
                    onClick={() => props.onSelect(selectedIds.length === QUESTION_TEMPLATES.length ? [] : QUESTION_TEMPLATES.map((template) => template.id))}
                >
                    {selectedIds.length === QUESTION_TEMPLATES.length ? "取消全選" : "全選"}
                </button>
            </div>}
            <div aria-label="題目範本" className={styles.templateGrid} role={multiple ? "group" : "radiogroup"}>
                {QUESTION_TEMPLATES.map((template) => {
                    const Icon = TEMPLATE_ICONS[template.icon];
                    const active = selectedIds.includes(template.id);
                    return <button
                        aria-checked={active}
                        className={styles.templateCard}
                        data-active={active}
                        key={template.id}
                        onClick={() => selectTemplate(template.id)}
                        role={multiple ? "checkbox" : "radio"}
                        type="button"
                    >
                        <span className={styles.templateIcon}><Icon /></span>
                        <span><strong>{template.name}</strong><small>{template.description}</small></span>
                    </button>;
                })}
            </div>
        </div>
        {props.preview}
    </div>;
}
