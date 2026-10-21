#!/usr/bin/env python3

import argparse
import contextlib
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "BOS")

with contextlib.redirect_stdout(sys.stderr):
    import cv2
    import numpy
    import paddleocr
    from PIL import Image, ImageOps
    from paddleocr import DocPreprocessor, PaddleOCR


PROCESSOR_VERSION = "lerniqa-question-scan/v1"
DETECTION_MODEL = "PP-OCRv5_mobile_det"
RECOGNITION_MODEL = "PP-OCRv6_medium_rec"
UNWARPING_MODEL = "UVDoc"
MAX_PAGES = 20
MAX_PIXELS = 40_000_000


def parse_arguments() -> argparse.Namespace:
    """Parse bounded file paths and optional normalized page corners.

    Returns:
        Validated command-line arguments.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--corners", type=Path)
    parser.add_argument("--dewarp", action="store_true")
    return parser.parse_args()


def sha256(path: Path) -> str:
    """Calculate a file SHA-256 without loading it twice.

    Args:
        path: File to digest.

    Returns:
        Lowercase hexadecimal digest.
    """
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pdf_page_count(path: Path) -> int:
    """Read a PDF page count through Poppler with a hard product limit.

    Args:
        path: PDF source.

    Returns:
        Page count between one and MAX_PAGES.

    Raises:
        RuntimeError: Metadata is unavailable or exceeds the supported limit.
    """
    completed = subprocess.run(["pdfinfo", str(path)], check=True, capture_output=True, text=True, timeout=15)
    match = re.search(r"^Pages:\s+(\d+)$", completed.stdout, re.MULTILINE)
    if not match:
        raise RuntimeError("PDF_PAGE_COUNT_UNAVAILABLE")
    count = int(match.group(1))
    if count < 1 or count > MAX_PAGES:
        raise RuntimeError("PDF_PAGE_COUNT_UNSUPPORTED")
    return count


def load_source_pages(source: Path, temporary: Path) -> list[tuple[int, numpy.ndarray]]:
    """Decode an image or render bounded PDF pages at 200 DPI.

    Args:
        source: Validated source object.
        temporary: Private temporary directory for PDF rendering.

    Returns:
        One-based page numbers and BGR pixels.

    Raises:
        RuntimeError: The source cannot be decoded safely.
    """
    if source.read_bytes()[:5] == b"%PDF-":
        count = pdf_page_count(source)
        prefix = temporary / "page"
        subprocess.run(
            ["pdftoppm", "-r", "200", "-png", str(source), str(prefix)],
            check=True,
            timeout=90,
        )
        pages = []
        for page in range(1, count + 1):
            rendered = temporary / f"page-{page}.png"
            image = cv2.imread(str(rendered), cv2.IMREAD_COLOR)
            if image is None:
                raise RuntimeError("PDF_PAGE_UNREADABLE")
            pages.append((page, image))
        return pages

    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
        if image.width * image.height > MAX_PIXELS:
            raise RuntimeError("IMAGE_PIXEL_LIMIT_EXCEEDED")
        rgb = numpy.asarray(image)
    return [(1, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))]


def order_corners(points: numpy.ndarray) -> numpy.ndarray:
    """Return page corners in top-left, top-right, bottom-right, bottom-left order.

    Args:
        points: Four XY points.

    Returns:
        Ordered float32 points.
    """
    points = points.astype("float32")
    sums = points.sum(axis=1)
    differences = numpy.diff(points, axis=1).reshape(-1)
    return numpy.array([
        points[numpy.argmin(sums)],
        points[numpy.argmin(differences)],
        points[numpy.argmax(sums)],
        points[numpy.argmax(differences)],
    ], dtype="float32")


def manual_corners(value: object, width: int, height: int) -> numpy.ndarray | None:
    """Convert four normalized UI points to source pixels.

    Args:
        value: Untrusted JSON page corners.
        width: Source width.
        height: Source height.

    Returns:
        Ordered pixel corners, or None when no manual override exists.
    """
    if not isinstance(value, list) or len(value) != 4:
        return None
    points = []
    for point in value:
        if not isinstance(point, dict) or set(point) != {"x", "y"}:
            raise RuntimeError("INVALID_MANUAL_CORNERS")
        x = point.get("x")
        y = point.get("y")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or not 0 <= x <= 1 or not 0 <= y <= 1:
            raise RuntimeError("INVALID_MANUAL_CORNERS")
        points.append([float(x) * (width - 1), float(y) * (height - 1)])
    ordered = order_corners(numpy.array(points, dtype="float32"))
    if abs(cv2.contourArea(ordered)) < width * height * 0.1:
        raise RuntimeError("MANUAL_CORNERS_TOO_SMALL")
    return ordered


def detect_page(image: numpy.ndarray) -> tuple[numpy.ndarray, float, list[str]]:
    """Detect the strongest document quadrilateral with a conservative fallback.

    Args:
        image: Full-resolution BGR image.

    Returns:
        Ordered corners, confidence and warnings.
    """
    height, width = image.shape[:2]
    scale = min(1.0, 1600 / max(width, height))
    preview = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(preview, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, numpy.ones((7, 7), numpy.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    image_area = preview.shape[0] * preview.shape[1]
    best = None
    best_score = 0.0
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:30]:
        perimeter = cv2.arcLength(contour, True)
        candidate = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(candidate) != 4 or not cv2.isContourConvex(candidate):
            continue
        area_ratio = cv2.contourArea(candidate) / image_area
        if area_ratio < 0.2:
            continue
        points = order_corners(candidate.reshape(4, 2))
        edge_lengths = [numpy.linalg.norm(points[(index + 1) % 4] - points[index]) for index in range(4)]
        symmetry = min(edge_lengths[0], edge_lengths[2]) / max(edge_lengths[0], edge_lengths[2])
        symmetry *= min(edge_lengths[1], edge_lengths[3]) / max(edge_lengths[1], edge_lengths[3])
        score = area_ratio * 0.8 + symmetry * 0.2
        if score > best_score:
            best = points
            best_score = score
    if best is None:
        margin_x = width * 0.01
        margin_y = height * 0.01
        fallback = numpy.array([
            [margin_x, margin_y],
            [width - margin_x, margin_y],
            [width - margin_x, height - margin_y],
            [margin_x, height - margin_y],
        ], dtype="float32")
        return fallback, 0.0, ["未可靠偵測紙張四角，請人工調整。"]
    return best / scale, round(min(1.0, best_score), 4), []


def warp_page(image: numpy.ndarray, corners: numpy.ndarray) -> numpy.ndarray:
    """Map a planar page quadrilateral to its largest measured rectangle.

    Args:
        image: BGR source image.
        corners: Ordered page corners.

    Returns:
        Perspective-corrected BGR page.
    """
    top_left, top_right, bottom_right, bottom_left = corners
    width = int(max(numpy.linalg.norm(top_right - top_left), numpy.linalg.norm(bottom_right - bottom_left)))
    height = int(max(numpy.linalg.norm(bottom_left - top_left), numpy.linalg.norm(bottom_right - top_right)))
    width = max(64, min(width, 6000))
    height = max(64, min(height, 6000))
    destination = numpy.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype="float32")
    transform = cv2.getPerspectiveTransform(corners.astype("float32"), destination)
    return cv2.warpPerspective(image, transform, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def unwarp_page(image: numpy.ndarray, model_root: Path) -> tuple[numpy.ndarray, bool]:
    """Apply the provisioned UVDoc model without downloading at runtime.

    Args:
        image: Perspective-corrected BGR page.
        model_root: Fixed Paddle model directory.

    Returns:
        Result pixels and whether UVDoc ran.
    """
    model_directory = model_root / UNWARPING_MODEL
    if not model_directory.is_dir():
        return image, False
    with contextlib.redirect_stdout(sys.stderr):
        pipeline = DocPreprocessor(
            doc_unwarping_model_name=UNWARPING_MODEL,
            doc_unwarping_model_dir=str(model_directory),
            use_doc_orientation_classify=False,
            use_doc_unwarping=True,
        )
        result = next(iter(pipeline.predict(image, use_doc_orientation_classify=False, use_doc_unwarping=True)))
    output = result["output_img"]
    return output if isinstance(output, numpy.ndarray) else image, isinstance(output, numpy.ndarray)


def correct_illumination(image: numpy.ndarray) -> numpy.ndarray:
    """Normalize slow background shading while preserving colored content.

    Args:
        image: BGR page.

    Returns:
        Conservative color scan.
    """
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    luminance, channel_a, channel_b = cv2.split(lab)
    background = cv2.GaussianBlur(luminance, (0, 0), sigmaX=max(15, min(image.shape[:2]) / 30))
    normalized = cv2.divide(luminance, numpy.maximum(background, 1), scale=235)
    normalized = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8)).apply(normalized)
    return cv2.cvtColor(cv2.merge([normalized, channel_a, channel_b]), cv2.COLOR_LAB2BGR)


def handwriting_mask(image: numpy.ndarray) -> numpy.ndarray:
    """Find high-saturation colored ink without guessing black pencil over print.

    Args:
        image: Corrected BGR page.

    Returns:
        Binary candidate mask for user review.
    """
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    mask = numpy.where((saturation > 80) & (value < 245), 255, 0).astype("uint8")
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, numpy.ones((2, 2), numpy.uint8))


def build_modes(image: numpy.ndarray) -> dict[str, numpy.ndarray]:
    """Create reversible color, grayscale, black-and-white and ink-cleaned previews.

    Args:
        image: Rectified BGR page.

    Returns:
        Named scan modes and a colored-ink mask.
    """
    color = correct_illumination(image)
    gray = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY)
    black_white = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 13)
    mask = handwriting_mask(color)
    removed = cv2.inpaint(color, mask, 3, cv2.INPAINT_TELEA) if numpy.any(mask) else color.copy()
    return {"color": color, "gray": gray, "bw": black_white, "handwriting-mask": mask, "handwriting-removed": removed}


def build_ocr_engine(model_root: Path) -> PaddleOCR | None:
    """Create OCR only when fixed local model directories exist.

    Args:
        model_root: Fixed Paddle model directory.

    Returns:
        OCR engine, or None when provisioning is incomplete.
    """
    detection = model_root / DETECTION_MODEL
    recognition = model_root / RECOGNITION_MODEL
    if not detection.is_dir() or not recognition.is_dir():
        return None
    with contextlib.redirect_stdout(sys.stderr):
        return PaddleOCR(
            text_detection_model_name=DETECTION_MODEL,
            text_detection_model_dir=str(detection),
            text_recognition_model_name=RECOGNITION_MODEL,
            text_recognition_model_dir=str(recognition),
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )


def recognize(engine: PaddleOCR | None, image_path: Path) -> list[dict[str, object]]:
    """Return OCR text with normalized bounds and confidence.

    Args:
        engine: Provisioned PaddleOCR engine.
        image_path: Corrected color page.

    Returns:
        OCR lines in visual reading order.
    """
    if engine is None:
        return []
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    height, width = image.shape[:2]
    with contextlib.redirect_stdout(sys.stderr):
        prediction = next(iter(engine.predict(str(image_path))))
    result = prediction.json["res"]
    polygons = [polygon.tolist() if hasattr(polygon, "tolist") else polygon for polygon in result["rec_polys"]]
    lines = []
    for text, score, polygon in zip(result["rec_texts"], result["rec_scores"], polygons):
        clean_text = str(text).strip()
        if not clean_text:
            continue
        x_values = [point[0] for point in polygon]
        y_values = [point[1] for point in polygon]
        lines.append({
            "text": clean_text,
            "confidence": round(float(score), 4),
            "bounds": {
                "left": round(min(x_values) / width, 6),
                "top": round(min(y_values) / height, 6),
                "width": round((max(x_values) - min(x_values)) / width, 6),
                "height": round((max(y_values) - min(y_values)) / height, 6),
            },
        })
    return sorted(lines, key=lambda line: (line["bounds"]["top"], line["bounds"]["left"]))


def write_image(path: Path, image: numpy.ndarray) -> dict[str, object]:
    """Write a lossless PNG and return stable file evidence.

    Args:
        path: Destination path.
        image: Image pixels.

    Returns:
        Relative-file metadata completed by the caller.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(path), image, [cv2.IMWRITE_PNG_COMPRESSION, 6]):
        raise RuntimeError("OUTPUT_IMAGE_WRITE_FAILED")
    height, width = image.shape[:2]
    return {"file": path.name, "sha256": sha256(path), "byteSize": path.stat().st_size, "width": width, "height": height}


def run(args: argparse.Namespace) -> dict[str, object]:
    """Process every source page and emit a review-only manifest.

    Args:
        args: Validated command-line arguments.

    Returns:
        Processing manifest for the application boundary.
    """
    source = args.input.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    corner_overrides = json.loads(args.corners.read_text("utf-8")) if args.corners else {}
    if not isinstance(corner_overrides, dict):
        raise RuntimeError("INVALID_MANUAL_CORNERS")
    model_root = Path.home() / ".paddlex" / "official_models"
    ocr_engine = None
    reports = []
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="lerniqa-question-scan-") as temporary_name:
        pages = load_source_pages(source, Path(temporary_name))
        for page_number, page in pages:
            height, width = page.shape[:2]
            override = manual_corners(corner_overrides.get(str(page_number)), width, height)
            corners, confidence, warnings = detect_page(page) if override is None else (override, 1.0, [])
            warped = warp_page(page, corners)
            dewarped = False
            if args.dewarp:
                warped, dewarped = unwarp_page(warped, model_root)
                if not dewarped:
                    warnings.append("UVDoc 模型尚未安裝，這一頁只完成透視校正。")
            page_directory = output / f"page-{page_number}"
            modes = build_modes(warped)
            files = {name: write_image(page_directory / f"{name}.png", value) for name, value in modes.items()}
            if ocr_engine is None:
                ocr_engine = build_ocr_engine(model_root)
            lines = recognize(ocr_engine, page_directory / "color.png")
            if ocr_engine is None:
                warnings.append("OCR 模型尚未安裝，請先完成本機模型設定。")
            reports.append({
                "page": page_number,
                "source": {"width": width, "height": height},
                "corners": [{"x": round(float(x) / width, 6), "y": round(float(y) / height, 6)} for x, y in corners],
                "cornerConfidence": confidence,
                "dewarped": dewarped,
                "warnings": warnings,
                "files": files,
                "ocr": lines,
                "ocrText": "\n".join(line["text"] for line in lines),
            })
    return {
        "schemaVersion": 1,
        "processorVersion": PROCESSOR_VERSION,
        "sourceSha256": sha256(source),
        "durationMilliseconds": round((time.perf_counter() - started) * 1000),
        "pages": reports,
    }


def main() -> None:
    """Run the processor and write one JSON document to stdout."""
    try:
        report = run(parse_arguments())
        json.dump(report, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
    except Exception as error:
        print(f"QUESTION_SOURCE_PROCESSING_FAILED:{type(error).__name__}:{error}", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
