"use client";

import { Badge, Button } from "@keel-design/ui";
import { Eraser, PencilLine, Sparkles, Trash2 } from "lucide-react";
import { PointerEvent, useEffect, useId, useRef, useState } from "react";
import { hasVisibleHandwritingPixels } from "@/app/lib/handwriting";

interface HandwritingPadProps {
    /** 已保存的手寫影像。 */
    value?: string;
    /** 手寫內容更新事件。 */
    onChange: (value: string) => void;
    /** 是否禁止修改。 */
    disabled?: boolean;
    /** 顯示於標題旁的 AI 辨識狀態。 */
    recognitionStatus?: string;
}

/**
 * 提供數學計算與書寫題使用的本機手寫畫布。
 *
 * @param props 已保存內容、更新事件與停用狀態。
 * @returns 可觸控與滑鼠書寫的畫布。
 */
export function HandwritingPad({ value, onChange, disabled = false, recognitionStatus }: HandwritingPadProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const [tool, setTool] = useState<"pen" | "eraser">("pen");
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext("2d");
        if (!context) return;

        context.clearRect(0, 0, canvas.width, canvas.height);
        if (!value) return;

        const image = new Image();
        image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
        image.src = value;
    }, [value]);

    /**
     * 依畫布顯示尺寸換算指標座標。
     *
     * @param event 指標事件。
     * @returns 畫布內座標。
     */
    function getPoint(event: PointerEvent<HTMLCanvasElement>) {
        const canvas = event.currentTarget;
        const bounds = canvas.getBoundingClientRect();
        return {
            x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
            y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
        };
    }

    /**
     * 開始一段手寫線條。
     *
     * @param event 指標按下事件。
     * @returns 無回傳值。
     */
    function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
        if (disabled) return;

        const context = event.currentTarget.getContext("2d");
        if (!context) return;

        const point = getPoint(event);
        event.currentTarget.setPointerCapture(event.pointerId);
        drawingRef.current = true;
        context.beginPath();
        context.moveTo(point.x, point.y);
        context.lineWidth = tool === "eraser" ? 32 : 4;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
        context.strokeStyle = tool === "eraser" ? "rgba(0,0,0,1)" : "#292a43";
    }

    /**
     * 延續目前手寫線條。
     *
     * @param event 指標移動事件。
     * @returns 無回傳值。
     */
    function draw(event: PointerEvent<HTMLCanvasElement>) {
        if (!drawingRef.current || disabled) return;

        const context = event.currentTarget.getContext("2d");
        if (!context) return;

        const point = getPoint(event);
        context.lineTo(point.x, point.y);
        context.stroke();
    }

    /**
     * 保存完成的手寫線條。
     *
     * @param event 指標放開事件。
     * @returns 無回傳值。
     */
    function finishDrawing(event: PointerEvent<HTMLCanvasElement>) {
        if (!drawingRef.current) return;

        drawingRef.current = false;
        const canvas = event.currentTarget;
        const context = canvas.getContext("2d");
        if (!context || !hasVisibleHandwritingPixels(
            context.getImageData(0, 0, canvas.width, canvas.height).data,
        )) {
            onChange("");
            return;
        }
        onChange(canvas.toDataURL("image/png"));
    }

    /**
     * 清除目前手寫內容。
     *
     * @returns 無回傳值。
     */
    function clear() {
        if (disabled) return;

        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
        onChange("");
    }

    return (
        <section
            className="grid gap-2"
            aria-disabled={disabled || undefined}
            aria-labelledby={titleId}
            data-disabled={disabled ? "" : undefined}
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <p id={titleId} className="text-sm font-semibold">手寫板</p>
                    {recognitionStatus && <Badge className="ai-recognition-chip" tone="warning" title="送出後由本機 AI 逐字辨識手寫內容；不解題，也不判斷答案正誤。"><Sparkles size={13} />AI 手寫辨識 · {recognitionStatus}</Badge>}
                    <p id={descriptionId} className="text-xs text-muted-foreground">原始手寫會保留在這一題</p>
                </div>
                <div className="flex items-center gap-1">
                    <Button appearance={tool === "pen" ? "solid" : "ghost"} tone={tool === "pen" ? "primary" : "muted"} size="sm" disabled={disabled} aria-pressed={tool === "pen"} onClick={() => setTool("pen")}>
                        <PencilLine />畫筆
                    </Button>
                    <Button appearance={tool === "eraser" ? "solid" : "ghost"} tone={tool === "eraser" ? "primary" : "muted"} size="sm" disabled={disabled} aria-pressed={tool === "eraser"} onClick={() => setTool("eraser")}>
                        <Eraser />橡皮擦
                    </Button>
                    <Button appearance="ghost" tone="muted" size="sm" disabled={disabled || !value} onClick={clear}>
                        <Trash2 />清除
                    </Button>
                </div>
            </div>
            <canvas
                ref={canvasRef}
                width={1200}
                height={760}
                className="handwriting-canvas w-full touch-none rounded-2xl border border-border bg-white shadow-inner"
                aria-label="手寫作答區"
                aria-describedby={descriptionId}
                aria-disabled={disabled || undefined}
                role="img"
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={finishDrawing}
                onPointerCancel={finishDrawing}
            />
        </section>
    );
}
