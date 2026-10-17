#!/usr/bin/env python3

import argparse
import contextlib
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "BOS")

with contextlib.redirect_stdout(sys.stderr):
    import cv2
    import numpy
    import paddleocr
    from paddleocr import PaddleOCR


PARSER_VERSION = "teaching-source-ocr-smoke-v1"
DETECTION_MODEL = "PP-OCRv5_mobile_det"
RECOGNITION_MODEL = "PP-OCRv6_medium_rec"
RENDER_DPI = 150


def parse_pages(value: str) -> list[int]:
    """解析逗號分隔的 PDF 正整數頁碼。

    Args:
        value: 從 1 起算的 PDF 頁碼，以逗號分隔。

    Returns:
        依輸入順序排列且不重複的頁碼。

    Raises:
        argparse.ArgumentTypeError: 頁碼遺漏、格式錯誤或重複。
    """
    raw_pages = value.split(",")
    if not raw_pages or any(not re.fullmatch(r"[1-9]\d*", page) for page in raw_pages):
        raise argparse.ArgumentTypeError("頁碼必須是逗號分隔的正整數。")
    pages = [int(page) for page in raw_pages]
    if len(set(pages)) != len(pages):
        raise argparse.ArgumentTypeError("頁碼不可重複。")
    return pages


def checksum_file(path: Path) -> str:
    """以串流方式計算檔案的 SHA-256。

    Args:
        path: 要計算 checksum 的檔案。

    Returns:
        小寫十六進位 SHA-256。
    """
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pdf_page_count(path: Path) -> int:
    """透過 Poppler metadata 讀取 PDF 頁數。

    Args:
        path: 來源 PDF。

    Returns:
        PDF 頁數。

    Raises:
        RuntimeError: Poppler 沒有回傳可用頁數。
    """
    completed = subprocess.run(
        ["pdfinfo", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    match = re.search(r"^Pages:\s+(\d+)$", completed.stdout, re.MULTILINE)
    if not match:
        raise RuntimeError("PDF_PAGE_COUNT_UNAVAILABLE")
    return int(match.group(1))


def render_page(source: Path, page: int, destination: Path) -> None:
    """將單一 PDF 頁面渲染成可重跑的 PNG OCR 輸入。

    Args:
        source: 來源 PDF。
        page: 從 1 起算的 PDF 頁碼。
        destination: PNG 輸出路徑。

    Returns:
        無。
    """
    destination.parent.mkdir(parents=True, exist_ok=True)
    prefix = destination.with_suffix("")
    subprocess.run(
        [
            "pdftoppm",
            "-f",
            str(page),
            "-l",
            str(page),
            "-r",
            str(RENDER_DPI),
            "-png",
            "-singlefile",
            str(source),
            str(prefix),
        ],
        check=True,
    )


def normalized_bounds(polygon: list[list[int]], width: int, height: int) -> dict[str, float]:
    """把 OCR 多邊形換算成不受解析度影響的矩形座標。

    Args:
        polygon: 包住辨識文字的四個以上像素座標。
        width: 渲染頁面寬度。
        height: 渲染頁面高度。

    Returns:
        介於 0 至 1 的左側、頂端、寬度與高度。
    """
    x_values = [point[0] for point in polygon]
    y_values = [point[1] for point in polygon]
    left = min(x_values)
    top = min(y_values)
    right = max(x_values)
    bottom = max(y_values)
    return {
        "left": round(left / width, 6),
        "top": round(top / height, 6),
        "width": round((right - left) / width, 6),
        "height": round((bottom - top) / height, 6),
    }


def annotate_page(image_path: Path, polygons: list[list[list[int]]], destination: Path) -> None:
    """在頁面畫出 OCR 多邊形與固定編號，供人工比對。

    Args:
        image_path: 渲染後的輸入影像。
        polygons: 偵測到的文字多邊形。
        destination: 標示後的 PNG 輸出路徑。

    Returns:
        無。

    Raises:
        RuntimeError: OpenCV 無法讀取或寫入影像。
    """
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError("RENDERED_PAGE_UNREADABLE")
    for index, polygon in enumerate(polygons):
        contour = cv2.convexHull(numpy.array(polygon, dtype="int32"))
        cv2.polylines(image, [contour], True, (28, 92, 222), 2)
        x = min(point[0] for point in polygon)
        y = min(point[1] for point in polygon)
        cv2.putText(
            image,
            str(index + 1),
            (x, max(14, y - 3)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.4,
            (196, 44, 44),
            1,
            cv2.LINE_AA,
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(destination), image):
        raise RuntimeError("ANNOTATED_PAGE_WRITE_FAILED")


def run_smoke(
    source: Path,
    pages: list[int],
    printed_offset: int,
    output: Path,
) -> dict[str, object]:
    """使用本機模型渲染並辨識代表頁面。

    Args:
        source: 來源 PDF 路徑。
        pages: 從 1 起算的 PDF 抽樣頁碼。
        printed_offset: PDF 頁碼換算印刷頁碼時要加上的值。
        output: 渲染頁面、標示圖與報告的輸出目錄。

    Returns:
        可序列化的 smoke test 報告。

    Raises:
        RuntimeError: 必要模型或渲染頁面無法使用。
        ValueError: 要求的頁碼超出 PDF 範圍。
    """
    model_root = Path.home() / ".paddlex" / "official_models"
    detection_directory = model_root / DETECTION_MODEL
    recognition_directory = model_root / RECOGNITION_MODEL
    if not detection_directory.is_dir() or not recognition_directory.is_dir():
        raise RuntimeError("PADDLE_MODEL_NOT_PROVISIONED")

    total_pages = pdf_page_count(source)
    if any(page > total_pages for page in pages):
        raise ValueError("REQUESTED_PAGE_OUT_OF_RANGE")

    with contextlib.redirect_stdout(sys.stderr):
        engine = PaddleOCR(
            text_detection_model_name=DETECTION_MODEL,
            text_detection_model_dir=str(detection_directory),
            text_recognition_model_name=RECOGNITION_MODEL,
            text_recognition_model_dir=str(recognition_directory),
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )

    rendered_directory = output / "rendered"
    annotated_directory = output / "annotated"
    page_reports = []
    for page in pages:
        rendered_path = rendered_directory / f"pdf-{page}.png"
        annotated_path = annotated_directory / f"pdf-{page}.png"
        render_page(source, page, rendered_path)
        image = cv2.imread(str(rendered_path), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError("RENDERED_PAGE_UNREADABLE")
        height, width = image.shape[:2]

        started_at = time.perf_counter()
        with contextlib.redirect_stdout(sys.stderr):
            prediction = next(iter(engine.predict(str(rendered_path))))
        duration_ms = round((time.perf_counter() - started_at) * 1000)
        result = prediction.json["res"]
        polygons = [polygon.tolist() if hasattr(polygon, "tolist") else polygon for polygon in result["rec_polys"]]
        texts = [str(text).strip() for text in result["rec_texts"]]
        scores = [float(score) for score in result["rec_scores"]]
        annotate_page(rendered_path, polygons, annotated_path)

        detections = [
            {
                "position": index + 1,
                "text": text,
                "confidence": round(max(0, min(1, score)), 6),
                "polygon": polygon,
                "bounds": normalized_bounds(polygon, width, height),
            }
            for index, (text, score, polygon) in enumerate(zip(texts, scores, polygons, strict=True))
        ]
        page_reports.append({
            "pdfPageNumber": page,
            "printedPageNumber": page + printed_offset,
            "width": width,
            "height": height,
            "durationMilliseconds": duration_ms,
            "detectionCount": len(detections),
            "averageConfidence": round(sum(scores) / len(scores), 6) if scores else 0,
            "lowConfidenceCount": sum(score < 0.8 for score in scores),
            "renderedFile": str(rendered_path.relative_to(output)),
            "annotatedFile": str(annotated_path.relative_to(output)),
            "detections": detections,
        })

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "parserVersion": PARSER_VERSION,
        "source": {
            "fileName": source.name,
            "sha256": checksum_file(source),
            "byteSize": source.stat().st_size,
            "totalPages": total_pages,
        },
        "engine": {
            "name": "PaddleOCR",
            "packageVersion": paddleocr.__version__,
            "detectionModel": DETECTION_MODEL,
            "recognitionModel": RECOGNITION_MODEL,
            "renderDpi": RENDER_DPI,
        },
        "review": {
            "status": "requires_human_correction",
            "findings": [
                "直排正文與題目欄位可被偵測並保留座標。",
                "注音、小字註解、標點與插圖文字可能混入正文或降低信心值。",
                "偵測順序不能直接視為直排文章的閱讀順序。",
                "OCR 結果只可建立 pending 區塊，人工校正後才能核准。",
            ],
        },
        "pages": page_reports,
    }


def main() -> int:
    """驗證參數、執行抽樣並以原子替換寫入報告。

    Returns:
        程序結束碼。
    """
    parser = argparse.ArgumentParser(description="抽樣檢查教材 PDF 的本機 OCR 品質。")
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--pages", required=True, type=parse_pages)
    parser.add_argument("--printed-offset", required=True, type=int)
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()

    source = arguments.pdf.resolve()
    if not source.is_file() or source.suffix.lower() != ".pdf":
        parser.error("--pdf 必須指向可讀取的 PDF 檔案。")
    output = arguments.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = run_smoke(source, arguments.pages, arguments.printed_offset, output)
    report_path = output / "ocr-smoke.json"
    temporary_path = report_path.with_suffix(".json.part")
    with temporary_path.open("w", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    temporary_path.replace(report_path)
    print(json.dumps({
        "report": str(report_path),
        "pages": len(report["pages"]),
        "sha256": report["source"]["sha256"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
