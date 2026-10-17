export interface HandwritingInkPoint {
    /** 畫布水平座標。 */
    x: number;
    /** 畫布垂直座標。 */
    y: number;
    /** 相對於本次書寫開始的毫秒數。 */
    t: number;
    /** 裝置提供的壓力值。 */
    force?: number;
}

export interface HandwritingInkStroke {
    /** 從落筆到抬筆之間依時間排列的座標。 */
    points: HandwritingInkPoint[];
}

export interface HandwritingInk {
    /** 原始畫布寬度。 */
    width: number;
    /** 原始畫布高度。 */
    height: number;
    /** 依落筆順序排列的線條。 */
    strokes: HandwritingInkStroke[];
}

const MAXIMUM_STROKES = 256;
const MAXIMUM_POINTS = 20_000;
const MAXIMUM_DURATION_MS = 60 * 60 * 1_000;

/**
 * 驗證瀏覽器畫布送出的數位筆跡，避免把任意 JSON 傳入本機辨識程序。
 *
 * @param value 尚未信任的數位筆跡。
 * @returns 通過大小與座標限制的筆跡；無效時回傳 null。
 */
export function validateHandwritingInk(value: unknown): HandwritingInk | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    const width = Number(source.width);
    const height = Number(source.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)
        || width < 1 || height < 1 || width > 2_048 || height > 2_048
        || !Array.isArray(source.strokes) || source.strokes.length < 1
        || source.strokes.length > MAXIMUM_STROKES) return null;

    let pointCount = 0;
    const strokes: HandwritingInkStroke[] = [];
    for (const candidate of source.strokes) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
        const pointsValue = (candidate as Record<string, unknown>).points;
        if (!Array.isArray(pointsValue) || pointsValue.length < 1) return null;
        pointCount += pointsValue.length;
        if (pointCount > MAXIMUM_POINTS) return null;
        const points: HandwritingInkPoint[] = [];
        for (const entry of pointsValue) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
            const point = entry as Record<string, unknown>;
            const x = Number(point.x);
            const y = Number(point.y);
            const t = Number(point.t);
            const force = point.force === undefined ? undefined : Number(point.force);
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)
                || x < 0 || x > width || y < 0 || y > height || t < 0 || t > MAXIMUM_DURATION_MS
                || (force !== undefined && (!Number.isFinite(force) || force < 0 || force > 1))) return null;
            points.push({ x, y, t, ...(force === undefined ? {} : { force }) });
        }
        strokes.push({ points });
    }
    return { width, height, strokes };
}
