#!/bin/sh

set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
python_binary=$(command -v python3.12 || true)

if [ -z "$python_binary" ]; then
    echo "找不到 Python 3.12，無法安裝本機 PP-OCRv5。" >&2
    exit 1
fi

environment_directory="$repository_root/local-data/handwriting-python"
"$python_binary" -m venv "$environment_directory"
"$environment_directory/bin/python" -m pip install --upgrade pip
"$environment_directory/bin/python" -m pip install -r "$repository_root/requirements-handwriting.txt"

PADDLE_PDX_MODEL_SOURCE=BOS "$environment_directory/bin/python" - <<'PY'
import contextlib
import sys

with contextlib.redirect_stdout(sys.stderr):
    import paddle
    from paddleocr import TextRecognition

    paddle.utils.run_check()
    TextRecognition(model_name="PP-OCRv5_server_rec")

print("本機 PP-OCRv5 已安裝並預載模型。")
PY
