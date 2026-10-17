"use client";

import { Button, Checkbox, FormField, Input, Radio } from "@keel-design/ui";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { LOCAL_PRACTICE_MAX_ANSWER_LENGTH, type LocalPracticeAnswerValue, type LocalPracticeContentBlock, type LocalPracticeQuestion } from "../lib/local-practice-types";
import { parsePracticeAnswers } from "../lib/practice-catalog-adapter";

function PublicContent({ blocks, duplicateText }: { blocks: LocalPracticeContentBlock[]; duplicateText?: string }) {
    return <>{blocks.map((block) => {
        if (block.asset && (block.contentType === "image" || block.contentType === "page_crop")) {
            return <img className="my-3 max-h-96 max-w-full object-contain" key={block.id} src={block.asset.url} alt={block.altText || "題目附圖"} />;
        }
        if (block.asset && block.contentType === "audio") {
            return <audio key={block.id} controls src={block.asset.url} aria-label={block.altText || "題目音訊"} />;
        }
        // Text blocks are already projected into the public prompt/option label. Rendering them here
        // would duplicate a reading passage when the source stores it as multiple ordered blocks.
        if (!block.text || block.text.trim() === duplicateText?.trim()) return null;
        return null;
    })}</>;
}

function PromptText({ text }: { text: string }) {
    return <>{text.split(/( {4,}|　{2,})/g).map((segment, index) => {
        const isBlank = /^(?: {4,}|　{2,})$/.test(segment);
        if (!isBlank) return <span key={`${index}-${segment}`}>{segment}</span>;
        const blankWidth = [...segment].reduce((width, character) => width + (character === "　" ? 1 : 0.5), 0);
        return <span key={`blank-${index}`}>
            <span aria-hidden="true" className="question-prompt-blank" style={{ width: `${Math.min(Math.max(blankWidth, 3), 8)}em` }} />
            <span className="sr-only">填答處</span>
        </span>;
    })}</>;
}

function getOptionColumnCount(part: LocalPracticeQuestion["parts"][number]) {
    const hasMedia = part.options.some((option) => option.contentBlocks.some((block) => block.contentType !== "text"));
    if (hasMedia || part.options.length < 2) return 1;
    const totalBytes = part.options.reduce((total, option) => total + new TextEncoder().encode(option.label).length, 0);
    if (part.options.length >= 4 && totalBytes <= 48) return 4;
    return totalBytes <= 144 ? 2 : 1;
}

export function PersistedQuestionFields({ question, answer, disabled = false, handwritingOnly = false, submitted = false, recognizedAnswers, partIds, onAnswer }: {
    question: LocalPracticeQuestion;
    answer: string;
    disabled?: boolean;
    handwritingOnly?: boolean;
    submitted?: boolean;
    recognizedAnswers?: Record<string, string>;
    partIds?: string[];
    onAnswer: (answer: string) => void;
}) {
    const [activeIndex, setActiveIndex] = useState(0);
    const values = Object.fromEntries(parsePracticeAnswers(answer).map((entry) => [entry.partId, entry.value]));
    const update = (partId: string, value: LocalPracticeAnswerValue) => onAnswer(JSON.stringify({ ...values, [partId]: value }));
    const targetIds = partIds?.length ? new Set(partIds) : undefined;
    const parts = question.parts.filter((part) => !targetIds || targetIds.has(part.id));
    const usesStepNavigation = parts.length > 1 && parts.every((part) => part.answerMode !== "text");
    const currentIndex = Math.min(activeIndex, Math.max(parts.length - 1, 0));
    const visibleParts = usesStepNavigation ? parts.slice(currentIndex, currentIndex + 1) : parts;

    useEffect(() => setActiveIndex(0), [question.id, question.revisionId, partIds?.join(",")]);

    if (!parts.length) {
        return <div className="grid gap-5">
            <PublicContent blocks={question.promptBlocks} duplicateText={question.prompt} />
            <p className="multi-choice-step-empty" role="status">這題缺少可作答的小題資料。</p>
        </div>;
    }

    return <div className="grid gap-5">
        <PublicContent blocks={question.promptBlocks} duplicateText={question.prompt} />
        {usesStepNavigation && <div className="multi-choice-step-header">
            <p aria-live="polite">{targetIds
                ? <>第 <strong>{question.parts.findIndex((part) => part.id === parts[currentIndex]?.id) + 1}</strong> 小題 · 複習 {currentIndex + 1}／{parts.length}</>
                : <>小題 <strong>{currentIndex + 1}</strong>／{parts.length}</>}</p>
            <div className="multi-choice-step-actions">
                <Button appearance="outline" size="sm" disabled={currentIndex <= 0} onClick={() => setActiveIndex((index) => Math.max(index - 1, 0))}><ArrowLeft />上一小題</Button>
                <Button appearance="outline" size="sm" disabled={currentIndex >= parts.length - 1} onClick={() => setActiveIndex((index) => Math.min(index + 1, parts.length - 1))}>下一小題<ArrowRight /></Button>
            </div>
        </div>}
        <div className={usesStepNavigation ? "multi-choice-step" : "written-answer-parts"}>
        {visibleParts.map((part) => {
            const value = values[part.id];
            const sourceIndex = question.parts.findIndex((candidate) => candidate.id === part.id);
            const optionLabels = part.options.map((option) => option.label);
            const normalizedPrompt = part.prompt.normalize("NFKC").replace(/[\s。．.、；;]/g, "").toLocaleLowerCase();
            const normalizedOptions = optionLabels.join("").normalize("NFKC").replace(/[\s。．.、；;]/g, "").toLocaleLowerCase();
            const showPrompt = Boolean(part.prompt && part.prompt !== question.prompt && normalizedPrompt !== normalizedOptions);
            const answerColumnCount = getOptionColumnCount(part);
            const gradingNotice = part.gradingPolicy === "manual_review"
                ? "送出後會保存答案，等待人工批改"
                : part.gradingPolicy !== "automatic"
                    ? "送出後會保存答案，等待輔助批改"
                    : "";
            return <fieldset className={part.answerMode === "text" ? "grid gap-3" : `answer-grid answer-grid-${answerColumnCount}`} data-answer-columns={part.answerMode === "text" ? undefined : answerColumnCount} disabled={disabled} key={part.id}>
                <legend className={usesStepNavigation && showPrompt ? "multi-choice-step-prompt" : "mb-2 font-semibold"}>
                    {showPrompt
                        ? <PromptText text={part.prompt} />
                        : usesStepNavigation ? "選擇答案" : question.parts.length > 1 ? `第 ${sourceIndex + 1} 小題` : "作答"}
                    {part.answerMode === "multiple_choice" ? "（可複選）" : ""}
                    {gradingNotice && <span className="ml-2 text-xs font-normal text-muted-foreground">（{gradingNotice}）</span>}
                </legend>
                <div className="col-span-full"><PublicContent blocks={part.promptBlocks} duplicateText={part.prompt} /></div>
                {part.answerMode === "text"
                    ? handwritingOnly
                        ? recognizedAnswers?.[part.id]
                            ? <FormField className="practice-answer-field" label="辨識文字" layout="horizontal"><Input value={recognizedAnswers[part.id]} readOnly aria-readonly="true" /></FormField>
                            : <p className="text-sm text-muted-foreground">{submitted
                                ? "手寫內容已保存；字跡無法清楚辨識時會等待檢視。"
                                : "請在手寫板作答，完成後按「AI 分析」。"}</p>
                        : <FormField className="practice-answer-field" label="文字答案" layout="horizontal"><Input value={typeof value === "string" ? value : ""} maxLength={LOCAL_PRACTICE_MAX_ANSWER_LENGTH} onChange={(event) => update(part.id, event.target.value)} autoComplete="off" /></FormField>
                    : part.options.map((option) => <label className="answer-option" key={option.id}>
                        {part.answerMode === "multiple_choice"
                            ? <Checkbox checked={Array.isArray(value) && value.includes(option.key)} onChange={(event) => update(part.id, event.target.checked ? [...(Array.isArray(value) ? value : []), option.key] : (Array.isArray(value) ? value : []).filter((key) => key !== option.key))} />
                            : <Radio name={`question-${question.id}-part-${part.id}`} value={option.key} checked={value === option.key} onChange={() => update(part.id, option.key)} />}
                        <span>{option.label}<PublicContent blocks={option.contentBlocks} duplicateText={option.label} /></span>
                    </label>)}
            </fieldset>;
        })}
        </div>
    </div>;
}
