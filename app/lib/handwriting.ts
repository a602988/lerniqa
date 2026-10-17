/** Minimum visible pixels required before a canvas counts as a handwritten answer. */
export const MINIMUM_HANDWRITING_PIXELS = 4;

/**
 * Detects visible ink in RGBA canvas pixels. Transparent pixels produced by a
 * cleared or fully erased canvas do not count as handwriting.
 */
export function hasVisibleHandwritingPixels(
    pixels: ArrayLike<number>,
    minimumPixels = MINIMUM_HANDWRITING_PIXELS,
): boolean {
    if (!Number.isSafeInteger(minimumPixels) || minimumPixels < 1 || pixels.length % 4 !== 0) {
        return false;
    }
    let visiblePixels = 0;
    for (let alphaIndex = 3; alphaIndex < pixels.length; alphaIndex += 4) {
        if ((pixels[alphaIndex] ?? 0) > 8 && ++visiblePixels >= minimumPixels) return true;
    }
    return false;
}
