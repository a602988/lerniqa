#!/usr/bin/env python3

import base64
import contextlib
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "BOS")

with contextlib.redirect_stdout(sys.stderr):
    import cv2
    import numpy
    from paddleocr import TextRecognition

    model_directory = Path.home() / ".paddlex" / "official_models" / "PP-OCRv6_medium_rec"
    if not model_directory.is_dir():
        raise RuntimeError("PADDLE_MODEL_NOT_PROVISIONED")
    model = TextRecognition(
        model_name="PP-OCRv6_medium_rec",
        model_dir=str(model_directory),
    )

print(json.dumps({"type": "ready", "engine": "paddleocr"}), flush=True)


def character_variant(image):
    """保留原筆跡結構，補足觸控筆細線並避免單字被拆成多段。

    Args:
        image: OpenCV BGR 筆跡圖片。

    Returns:
        加粗並補足水平留白的 BGR 圖片。
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    ink = 255 - gray
    thickened = cv2.dilate(ink, numpy.ones((4, 4), dtype=numpy.uint8), iterations=1)
    normalized = 255 - thickened
    height, width = normalized.shape
    target_width = max(width, height * 2)
    left = (target_width - width) // 2
    right = target_width - width - left
    padded = cv2.copyMakeBorder(
        normalized,
        0,
        0,
        left,
        right,
        cv2.BORDER_CONSTANT,
        value=255,
    )
    return cv2.cvtColor(padded, cv2.COLOR_GRAY2BGR)


def line_variant(image):
    """補強細筆畫但保留多字答案的字距與行寬。

    Args:
        image: OpenCV BGR 筆跡圖片。

    Returns:
        輕度加粗且維持原始版面的 BGR 圖片。
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    ink = 255 - gray
    thickened = cv2.dilate(ink, numpy.ones((2, 2), dtype=numpy.uint8), iterations=1)
    return cv2.cvtColor(255 - thickened, cv2.COLOR_GRAY2BGR)


for line in sys.stdin:
    request_id = None
    try:
        request = json.loads(line)
        request_id = request.get("id")
        image_bytes = base64.b64decode(request["image"], validate=True)
        image_array = numpy.frombuffer(image_bytes, dtype=numpy.uint8)
        image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("INVALID_IMAGE")
        mode = request.get("mode")
        if mode == "single_character":
            variants = [image, character_variant(image)]
        elif mode == "single_line":
            variants = [image, line_variant(image)]
        else:
            raise ValueError("INVALID_RECOGNITION_MODE")
        with contextlib.redirect_stdout(sys.stderr):
            predictions = list(model.predict(input=variants, batch_size=len(variants)))
        candidates = []
        for prediction in predictions:
            result = prediction.json["res"]
            text = str(result.get("rec_text") or "").strip()
            score = float(result.get("rec_score") or 0)
            candidates.append({
                "text": text or None,
                "confidence": max(0, min(1, score)),
            })
        print(json.dumps({
            "id": request_id,
            "candidates": candidates,
        }, ensure_ascii=False), flush=True)
    except Exception:
        print(json.dumps({"id": request_id, "error": "PADDLE_RECOGNITION_FAILED"}), flush=True)
