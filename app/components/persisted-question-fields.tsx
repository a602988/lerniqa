"use client";

import { Button, Checkbox, Input, Radio } from "@keel-design/ui";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { setAnswerSlot, splitAnswerSlots } from "../lib/answer-slots";
import { BopomofoText } from "./bopomofo-text";
import { MathFormula } from "./math-formula";
import { QuestionTable } from "./question-table";
import { LOCAL_PRACTICE_MAX_ANSWER_LENGTH, type LocalPracticeAnswerValue, type LocalPracticeContentBlock, type LocalPracticeQuestion } from "../lib/local-practice-types";
import { parsePracticeAnswers } from "../lib/practice-catalog-adapter";
import { CORRECTION_ANSWER_HINT, CORRECTION_ANSWER_PLACEHOLDER, isCorrectionQuestion } from "../lib/question-answer-guidance";
import { getRepeatedNumberedPartLabel, tokenizePromptBlanks } from "../lib/question-presentation";

function PublicContent({ blocks, duplicateText }: { blocks: LocalPracticeContentBlock[]; duplicateText?: string }) {
    const mediaBlocks = blocks.filter((block) => block.asset && ["image", "page_crop", "audio"].includes(block.contentType));
    if (!mediaBlocks.length) return null;

    return <span className="my-3 flex w-full flex-wrap items-start gap-3">{mediaBlocks.map((block) => {
        if (block.asset && (block.contentType === "image" || block.contentType === "page_crop")) {
            return <img className="max-h-96 max-w-full flex-none object-contain" key={block.id} src={block.asset.url} alt={block.altText || "題目附圖"} />;
        }
        if (block.asset && block.contentType === "audio") {
            return <audio className="w-full" key={block.id} controls src={block.asset.url} aria-label={block.altText || "題目音訊"} />;
        }
        // Text blocks are already projected into the public prompt/option label. Rendering them here
        // would duplicate a reading passage when the source stores it as multiple ordered blocks.
        if (!block.text || block.text.trim() === duplicateText?.trim()) return null;
        return null;
    })}</span>;
}

function OrderedPublicContent({ blocks, fallbackText, layout = "default" }: {
    blocks: LocalPracticeContentBlock[];
    fallbackText?: string;
    layout?: "default" | "root-prompt";
}) {
    const orderedBlocks = [...blocks].sort((first, second) => first.position - second.position);
    const hasText = orderedBlocks.some((block) => (block.contentType === "text" || block.contentType === "transcript") && block.text);
    const textClassName = `whitespace-pre-wrap${layout === "root-prompt" ? " question-root-prompt-text" : ""}`;
    return <>{!hasText && fallbackText ? <span className={textClassName}><PromptText text={fallbackText} /></span> : null}
        {orderedBlocks.map((block) => {
            if ((block.contentType === "text" || block.contentType === "transcript") && block.text) {
                return <span className={textClassName} key={block.id}><PromptText text={block.text} /></span>;
            }
            if (block.contentType === "formula" && block.text) {
                return <MathFormula expression={block.text} key={block.id} />;
            }
            if (block.contentType === "table" && block.text) {
                return <QuestionTable key={block.id} text={block.text} />;
            }
            if (block.asset && (block.contentType === "image" || block.contentType === "page_crop")) {
                const isInlineFormula = block.altText === "來源數學公式";
                return <img
                    className={isInlineFormula
                        ? "question-inline-formula-image"
                        : "my-3 max-h-96 max-w-full flex-none object-contain"}
                    key={block.id}
                    src={block.asset.url}
                    alt={block.altText || "題目附圖"}
                />;
            }
            if (block.asset && block.contentType === "audio") {
                return <audio className="my-3 w-full flex-none" key={block.id} controls src={block.asset.url} aria-label={block.altText || "題目音訊"} />;
            }
            return null;
        })}</>;
}

export function PersistedQuestionPromptContent({ question, id, className = "", title = false }: {
    question: LocalPracticeQuestion;
    id?: string;
    className?: string;
    title?: boolean;
}) {
    const hasInlineFormulaContent = question.promptBlocks.some(
        (block) => block.contentType === "formula" || (block.contentType === "image" && block.altText === "來源數學公式"),
    );
    const titleSize = title
        ? question.subject.name === "英文" ? "text-base lg:text-lg" : "text-xl lg:text-2xl"
        : "";
    return <div
        aria-level={title ? 3 : undefined}
        className={`${hasInlineFormulaContent ? "question-inline-formula-flow" : "flex flex-wrap items-center gap-x-1 gap-y-2"} ${titleSize} ${className}`.trim()}
        id={id}
        role={title ? "heading" : undefined}
    >
        <OrderedPublicContent blocks={question.promptBlocks} fallbackText={question.prompt} layout={hasInlineFormulaContent ? "default" : "root-prompt"} />
    </div>;
}

function PromptText({ text }: { text: string }) {
    return <>{tokenizePromptBlanks(text).map((token, index) => {
        if (token.kind === "text") return <span key={`${index}-${token.value}`}><BopomofoText text={token.value} /></span>;
        return <span key={`blank-${index}`}>
            <span
                aria-hidden={token.label ? undefined : "true"}
                className={`question-prompt-blank${token.label ? " question-prompt-numbered-blank" : ""}`}
                style={{ width: `${token.widthEm}em` }}
            >{token.label}</span>
            {!token.label && <span className="sr-only">填答處</span>}
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

function countPromptBlanks(prompt: string) {
    return tokenizePromptBlanks(prompt).filter((token) => token.kind === "blank").length
        + (prompt.match(/(?:_{3,}|＿{3,})/gu)?.length ?? 0);
}

export function PersistedQuestionFields({ question, answer, disabled = false, handwritingOnly = false, submitted = false, recognizedAnswers, partIds, hidePromptContent = false, onAnswer }: {
    question: LocalPracticeQuestion;
    answer: string;
    disabled?: boolean;
    handwritingOnly?: boolean;
    submitted?: boolean;
    recognizedAnswers?: Record<string, string>;
    partIds?: string[];
    hidePromptContent?: boolean;
    onAnswer: (answer: string) => void;
}) {
    const [activeIndex, setActiveIndex] = useState(0);
    const values = Object.fromEntries(parsePracticeAnswers(answer).map((entry) => [entry.partId, entry.value]));
    const update = (partId: string, value: LocalPracticeAnswerValue) => onAnswer(JSON.stringify({ ...values, [partId]: value }));
    const targetIds = partIds?.length ? new Set(partIds) : undefined;
    const parts = question.parts.filter((part) => !targetIds || targetIds.has(part.id));
    const usesInlineBlankAnswerFields = !handwritingOnly
        && parts.length > 1
        && parts.every((part) => part.answerMode === "text")
        && countPromptBlanks(question.prompt) >= parts.length;
    const usesDedicatedAnswerSlotRows = !handwritingOnly
        && parts.length > 1
        && parts.every((part) => part.answerMode === "text" && part.answerFieldCount > 1);
    const usesStepNavigation = parts.length > 1
        && !usesInlineBlankAnswerFields
        && !usesDedicatedAnswerSlotRows;
    const needsCorrectionDelimiter = isCorrectionQuestion(question.originalTypeLabel);
    const currentIndex = Math.min(activeIndex, Math.max(parts.length - 1, 0));
    const visibleParts = usesStepNavigation ? parts.slice(currentIndex, currentIndex + 1) : parts;

    useEffect(() => setActiveIndex(0), [question.id, question.revisionId, partIds?.join(",")]);

    if (!parts.length) {
        return <div className="grid gap-5">
            {!hidePromptContent && <PublicContent blocks={question.promptBlocks} duplicateText={question.prompt} />}
            <p className="multi-choice-step-empty" role="status">這題缺少可作答的小題資料。</p>
        </div>;
    }

    return <div className="grid gap-5">
        {!hidePromptContent && <PublicContent blocks={question.promptBlocks} duplicateText={question.prompt} />}
        {usesStepNavigation && <div className="multi-choice-step-header">
            <p aria-live="polite">{targetIds
                ? <>第 <strong>{question.parts.findIndex((part) => part.id === parts[currentIndex]?.id) + 1}</strong> 小題 · 複習 {currentIndex + 1}／{parts.length}</>
                : <>小題 <strong>{currentIndex + 1}</strong>／{parts.length}</>}</p>
            <div className="multi-choice-step-actions">
                <Button type="button" appearance="outline" size="sm" disabled={currentIndex <= 0} onClick={() => setActiveIndex((index) => Math.max(index - 1, 0))}><ArrowLeft />上一小題</Button>
                <Button type="button" appearance="outline" size="sm" disabled={currentIndex >= parts.length - 1} onClick={() => setActiveIndex((index) => Math.min(index + 1, parts.length - 1))}>下一小題<ArrowRight /></Button>
            </div>
        </div>}
        <div className={usesStepNavigation ? "multi-choice-step" : "written-answer-parts"}>
        {visibleParts.map((part) => {
            const value = values[part.id];
            const sourceIndex = question.parts.findIndex((candidate) => candidate.id === part.id);
            const repeatedNumberLabel = getRepeatedNumberedPartLabel(question.prompt, part.prompt, sourceIndex);
            const optionLabels = part.options.map((option) => option.label);
            const normalizedPrompt = part.prompt.normalize("NFKC").replace(/[\s。．.、；;]/g, "").toLocaleLowerCase();
            const normalizedOptions = optionLabels.join("").normalize("NFKC").replace(/[\s。．.、；;]/g, "").toLocaleLowerCase();
            const showPrompt = Boolean(part.prompt && part.prompt !== question.prompt && normalizedPrompt !== normalizedOptions);
            const hasInlineFormulaContent = part.promptBlocks.some((block) => block.contentType === "formula" || (block.contentType === "image" && block.altText === "來源數學公式"));
            const usesDedicatedAnswerSlots = part.answerMode === "text" && part.answerFieldCount > 1;
            const answerColumnCount = getOptionColumnCount(part);
            const gradingNotice = part.gradingPolicy === "manual_review"
                ? "送出後會保存答案，等待人工批改"
                : part.gradingPolicy !== "automatic"
                    ? "送出後會保存答案，等待輔助批改"
                    : "";
            const fieldsetClassName = part.answerMode === "text"
                ? `written-answer-fieldset grid w-full min-w-0 gap-3${usesInlineBlankAnswerFields ? " written-answer-fieldset-compact" : " col-span-full"}`
                : `answer-grid answer-grid-${answerColumnCount}`;
            const legendClassName = `${usesStepNavigation && showPrompt ? "multi-choice-step-prompt" : "mb-2 font-semibold"}${part.answerMode === "text" ? " written-answer-legend" : ""}`;
            const recognitionDescription = submitted
                ? "手寫內容已保存；字跡無法清楚辨識時會等待檢視。"
                : "停筆後會自動辨識，也可以立即分析或重新分析。";
            const recognitionDescriptionId = `handwriting-answer-description-${part.id}`;
            return <fieldset className={fieldsetClassName} data-answer-columns={part.answerMode === "text" ? undefined : answerColumnCount} disabled={disabled} key={part.id}>
                <legend className={(usesDedicatedAnswerSlots || usesInlineBlankAnswerFields) ? "sr-only" : legendClassName}>
                    {usesDedicatedAnswerSlots
                        ? `第 ${sourceIndex + 1} 小題`
                        : hasInlineFormulaContent
                        ? <span className="question-inline-formula-flow"><OrderedPublicContent blocks={part.promptBlocks} fallbackText={part.prompt} /></span>
                        : repeatedNumberLabel
                        ? repeatedNumberLabel
                        : showPrompt
                        ? <PromptText text={part.prompt} />
                        : usesStepNavigation && part.answerMode !== "text" ? "選擇答案" : question.parts.length > 1 ? `第 ${sourceIndex + 1} 小題` : "作答"}
                    {part.answerMode === "multiple_choice" ? "（可複選）" : ""}
                    {!usesInlineBlankAnswerFields && !usesDedicatedAnswerSlots && gradingNotice && <span className="written-answer-notice">（{gradingNotice}）</span>}
                </legend>
                {!usesInlineBlankAnswerFields && !usesDedicatedAnswerSlots && !hasInlineFormulaContent && <div className="col-span-full"><PublicContent blocks={part.promptBlocks} duplicateText={part.prompt} /></div>}
                {part.answerMode === "text"
                    ? handwritingOnly
                        ? <div className="practice-handwriting-answer-field">
                            <Input
                                value={recognizedAnswers?.[part.id] ?? ""}
                                placeholder="等待辨識手寫內容"
                                readOnly
                                aria-readonly="true"
                                aria-label="作答辨識結果"
                                aria-describedby={recognitionDescriptionId}
                                className="w-full"
                            />
                            <p id={recognitionDescriptionId}>{recognitionDescription}</p>
                        </div>
                        : part.answerFieldCount > 1
                            ? <div className="practice-answer-slots-row">
                                <span aria-hidden="true" className="practice-answer-part-number">({sourceIndex + 1})</span>
                                <div className="practice-answer-slots">
                                    {splitAnswerSlots(typeof value === "string" ? value : "", part.answerFieldCount).map((slot, slotIndex) => <Input
                                        aria-label={`第 ${sourceIndex + 1} 小題第 ${slotIndex + 1} 個答案`}
                                        autoComplete="off"
                                        className="practice-answer-control"
                                        key={slotIndex}
                                        maxLength={LOCAL_PRACTICE_MAX_ANSWER_LENGTH}
                                        onChange={(event) => update(part.id, setAnswerSlot(typeof value === "string" ? value : "", part.answerFieldCount, slotIndex, event.target.value))}
                                        value={slot}
                                    />)}
                                </div>
                            </div>
                        : usesInlineBlankAnswerFields
                            ? <div className="practice-answer-slots-row">
                                <span aria-hidden="true" className="practice-answer-part-number">({sourceIndex + 1})</span>
                                <Input
                                    aria-label={`第 ${sourceIndex + 1} 個答案`}
                                    className="practice-answer-control"
                                    value={typeof value === "string" ? value : ""}
                                    maxLength={LOCAL_PRACTICE_MAX_ANSWER_LENGTH}
                                    onChange={(event) => update(part.id, event.target.value)}
                                    autoComplete="off"
                                />
                            </div>
                            : <div className="practice-answer-field practice-answer-input">
                                <Input
                                    aria-label="文字答案"
                                    className="practice-answer-control"
                                    value={typeof value === "string" ? value : ""}
                                    maxLength={LOCAL_PRACTICE_MAX_ANSWER_LENGTH}
                                    placeholder={needsCorrectionDelimiter ? CORRECTION_ANSWER_PLACEHOLDER : undefined}
                                    onChange={(event) => update(part.id, event.target.value)}
                                    autoComplete="off"
                                />
                                {needsCorrectionDelimiter && <p className="practice-answer-hint">{CORRECTION_ANSWER_HINT}</p>}
                            </div>
                    : part.options.map((option) => <label className="answer-option" key={option.id}>
                        {part.answerMode === "multiple_choice"
                            ? <Checkbox checked={Array.isArray(value) && value.includes(option.key)} onChange={(event) => update(part.id, event.target.checked ? [...(Array.isArray(value) ? value : []), option.key] : (Array.isArray(value) ? value : []).filter((key) => key !== option.key))} />
                            : <Radio name={`question-${question.id}-part-${part.id}`} value={option.key} checked={value === option.key} onChange={() => update(part.id, option.key)} />}
                        {option.contentBlocks.some((block) => block.contentType === "image" && block.altText === "來源數學公式")
                            ? <span className="question-inline-formula-flow"><OrderedPublicContent blocks={option.contentBlocks} fallbackText={option.label} /></span>
                            : <span><BopomofoText text={option.label} /><PublicContent blocks={option.contentBlocks} duplicateText={option.label} /></span>}
                    </label>)}
            </fieldset>;
        })}
        </div>
    </div>;
}
