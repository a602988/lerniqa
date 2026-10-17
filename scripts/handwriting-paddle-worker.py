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
        with contextlib.redirect_stdout(sys.stderr):
            predictions = list(model.predict(input=image, batch_size=1))
        result = predictions[0].json["res"] if predictions else {}
        text = str(result.get("rec_text") or "").strip()
        score = float(result.get("rec_score") or 0)
        print(json.dumps({
            "id": request_id,
            "text": text or None,
            "confidence": max(0, min(1, score)),
        }, ensure_ascii=False), flush=True)
    except Exception:
        print(json.dumps({"id": request_id, "error": "PADDLE_RECOGNITION_FAILED"}), flush=True)
