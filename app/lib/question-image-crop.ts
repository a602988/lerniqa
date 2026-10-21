import sharp from "sharp";
import { validateQuestionSource } from "./question-source-object-store.ts";

export type QuestionCropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type QuestionCropResult = {
    bytes: Buffer;
    width: number;
    height: number;
};

/**
 * 將正規化座標轉換成來源圖片的像素範圍，並輸出已驗證的 PNG。
 *
 * @param bytes 已通過所有權與 checksum 驗證的來源圖片。
 * @param rect 介於 0 至 1 的裁切座標。
 * @returns 裁切後的 PNG 與實際像素尺寸。
 */
export async function cropQuestionImage(bytes: Buffer, rect: QuestionCropRect): Promise<QuestionCropResult> {
    const image = sharp(bytes, { failOn: "error", limitInputPixels: 80_000_000 });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) throw new Error("CROP_SOURCE_DIMENSIONS_MISSING");
    const left = Math.min(metadata.width - 1, Math.floor(rect.x * metadata.width));
    const top = Math.min(metadata.height - 1, Math.floor(rect.y * metadata.height));
    const width = Math.max(1, Math.min(metadata.width - left, Math.round(rect.width * metadata.width)));
    const height = Math.max(1, Math.min(metadata.height - top, Math.round(rect.height * metadata.height)));
    const output = await image.extract({ left, top, width, height }).png({ compressionLevel: 9 }).toBuffer();
    const source = validateQuestionSource(output);
    if (!source || source.mimeType !== "image/png") throw new Error("CROP_OUTPUT_INVALID");
    return { bytes: output, width, height };
}
