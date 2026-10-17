import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { hasVisibleHandwritingPixels } from "./handwriting";

export const MAX_HANDWRITING_BYTES = 4 * 1024 * 1024;
export const MAX_HANDWRITING_DIMENSION = 2048;
export const MAX_HANDWRITING_PIXELS = 4_000_000;

export interface ValidatedHandwritingPng {
    bytes: Buffer;
    checksum: string;
    height: number;
    mimeType: "image/png";
    width: number;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(left: number, above: number, upperLeft: number): number {
    const estimate = left + above - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const aboveDistance = Math.abs(estimate - above);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
    return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function decodeRgbaScanlines(compressed: Buffer, width: number, height: number): Uint8Array | null {
    const stride = width * 4;
    const expectedLength = height * (stride + 1);
    let inflated: Buffer;
    try {
        inflated = inflateSync(compressed, { maxOutputLength: expectedLength + 1 });
    }
    catch {
        return null;
    }
    if (inflated.length !== expectedLength) return null;

    const rgba = new Uint8Array(width * height * 4);
    let sourceOffset = 0;
    for (let row = 0; row < height; row += 1) {
        const filter = inflated[sourceOffset++];
        if (filter === undefined || filter > 4) return null;
        const rowOffset = row * stride;
        for (let column = 0; column < stride; column += 1) {
            const encoded = inflated[sourceOffset++];
            if (encoded === undefined) return null;
            const left = column >= 4 ? rgba[rowOffset + column - 4]! : 0;
            const above = row > 0 ? rgba[rowOffset + column - stride]! : 0;
            const upperLeft = row > 0 && column >= 4 ? rgba[rowOffset + column - stride - 4]! : 0;
            const predictor = filter === 0
                ? 0
                : filter === 1
                    ? left
                    : filter === 2
                        ? above
                        : filter === 3
                            ? Math.floor((left + above) / 2)
                            : paeth(left, above, upperLeft);
            rgba[rowOffset + column] = (encoded + predictor) & 0xff;
        }
    }
    return rgba;
}

/**
 * Accepts only a bounded, non-interlaced 8-bit RGBA PNG with visible ink.
 * The browser canvas produces this format; blank and fully erased canvases fail.
 */
export function validateHandwritingPngDataUrl(dataUrl: string): ValidatedHandwritingPng | null {
    const prefix = "data:image/png;base64,";
    if (!dataUrl.startsWith(prefix) || dataUrl.length > Math.ceil(MAX_HANDWRITING_BYTES * 4 / 3) + prefix.length + 4) {
        return null;
    }
    const encoded = dataUrl.slice(prefix.length);
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) return null;
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length === 0 || bytes.length > MAX_HANDWRITING_BYTES || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
        return null;
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let sawHeader = false;
    let sawEnd = false;
    const imageChunks: Buffer[] = [];
    while (offset + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(offset);
        const typeOffset = offset + 4;
        const dataOffset = typeOffset + 4;
        const crcOffset = dataOffset + length;
        if (length > MAX_HANDWRITING_BYTES || crcOffset + 4 > bytes.length) return null;
        const type = bytes.toString("ascii", typeOffset, dataOffset);
        const crcInput = bytes.subarray(typeOffset, crcOffset);
        if (crc32(crcInput) !== bytes.readUInt32BE(crcOffset)) return null;
        const chunk = bytes.subarray(dataOffset, crcOffset);

        if (!sawHeader && type !== "IHDR") return null;
        if (type === "IHDR") {
            if (sawHeader || length !== 13) return null;
            width = chunk.readUInt32BE(0);
            height = chunk.readUInt32BE(4);
            if (
                width < 1 || height < 1
                || width > MAX_HANDWRITING_DIMENSION || height > MAX_HANDWRITING_DIMENSION
                || width * height > MAX_HANDWRITING_PIXELS
                || chunk[8] !== 8 || chunk[9] !== 6
                || chunk[10] !== 0 || chunk[11] !== 0 || chunk[12] !== 0
            ) return null;
            sawHeader = true;
        }
        else if (type === "IDAT") {
            if (!sawHeader || sawEnd) return null;
            imageChunks.push(chunk);
        }
        else if (type === "IEND") {
            if (length !== 0 || !sawHeader || imageChunks.length === 0) return null;
            sawEnd = true;
            offset = crcOffset + 4;
            break;
        }
        else if ((bytes[typeOffset]! & 0x20) === 0) {
            return null;
        }
        offset = crcOffset + 4;
    }
    if (!sawEnd || offset !== bytes.length || width === 0 || height === 0) return null;

    const rgba = decodeRgbaScanlines(Buffer.concat(imageChunks), width, height);
    if (!rgba || !hasVisibleHandwritingPixels(rgba)) return null;
    return {
        bytes,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        height,
        mimeType: "image/png",
        width,
    };
}
