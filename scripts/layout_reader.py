"""PP-DocLayout adapter.

The model is PaddleOCR PP-DocLayoutV2 (Apache-2.0). It already labels text,
image, chart, and table. This module only keeps diagram and table regions.
"""

from __future__ import annotations

import threading
import urllib.request
from pathlib import Path

from PIL import Image

LABELS = [
    "abstract",
    "algorithm",
    "aside_text",
    "chart",
    "content",
    "display_formula",
    "doc_title",
    "figure_title",
    "footer",
    "footer_image",
    "footnote",
    "formula_number",
    "header",
    "header_image",
    "image",
    "inline_formula",
    "number",
    "paragraph_title",
    "reference",
    "reference_content",
    "seal",
    "table",
    "text",
    "vertical_text",
    "vision_footnote",
]

FIGURE_LABELS = {"image", "chart", "figure"}
TABLE_LABELS = {"table"}
MODEL_URL = (
    "https://media.githubusercontent.com/media/"
    "PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/layout/PP-DocLayoutV2.onnx"
)
INPUT_SIZE = 800
SCORE_MIN = 0.5

_session = None
_session_lock = threading.Lock()


def model_path() -> Path:
    directory = Path.home() / ".cache" / "paperparse"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / "PP-DocLayoutV2.onnx"


def ensure_model() -> Path:
    path = model_path()
    if path.is_file() and path.stat().st_size > 1_000_000:
        return path
    temporary = path.with_suffix(".onnx.part")
    try:
        urllib.request.urlretrieve(MODEL_URL, temporary)
        temporary.replace(path)
    except Exception as exc:
        temporary.unlink(missing_ok=True)
        raise RuntimeError(
            "Graphics reading could not download the PP-DocLayout model. Check the network and try again."
        ) from exc
    return path


def session():
    global _session
    with _session_lock:
        if _session is not None:
            return _session
        try:
            import onnxruntime as ort
        except ImportError as exc:
            raise RuntimeError(
                "Graphics reading needs onnxruntime. From the project folder run: "
                "pip install -r scripts/requirements-ocr.txt"
            ) from exc
        path = ensure_model()
        _session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        return _session


def detections_to_blocks(
    detections: list[tuple[str, float, float, float, float, float]],
    width: int,
    height: int,
) -> list[dict]:
    """Keep image, chart, and table boxes. Drop text and captions."""
    blocks: list[dict] = []
    for label, score, x1, y1, x2, y2 in detections:
        kind = label.strip().lower().replace(" ", "_")
        if kind in FIGURE_LABELS:
            block_type = "figure"
        elif kind in TABLE_LABELS:
            block_type = "table"
        else:
            continue
        left = max(0.0, min(x1, x2) / width)
        top = max(0.0, min(y1, y2) / height)
        box_w = min(1.0 - left, abs(x2 - x1) / width)
        box_h = min(1.0 - top, abs(y2 - y1) / height)
        if box_w <= 0 or box_h <= 0:
            continue
        blocks.append(
            {
                "id": f"fig-{len(blocks) + 1}",
                "type": block_type,
                "text": None,
                "latex": None,
                "bbox": [round(left, 4), round(top, 4), round(box_w, 4), round(box_h, 4)],
                "confidence": round(float(score), 4),
            }
        )
    return blocks


def _parse_output(data, columns: int) -> list[tuple[str, float, float, float, float, float]]:
    found: list[tuple[int, str, float, float, float, float, float]] = []
    for row in data:
        if len(row) < 7:
            continue
        score = float(row[1])
        if score < SCORE_MIN:
            continue
        label_index = int(round(float(row[0])))
        label = LABELS[label_index] if 0 <= label_index < len(LABELS) else f"unknown_{label_index}"
        order = int(round(float(row[6]))) if columns > 6 else 0
        found.append((order, label, score, float(row[2]), float(row[3]), float(row[4]), float(row[5])))
    found.sort(key=lambda item: item[0])
    return [(label, score, x1, y1, x2, y2) for _order, label, score, x1, y1, x2, y2 in found]


def graphic_blocks(image: Image.Image) -> list[dict]:
    import numpy as np

    runner = session()
    resized = image.convert("RGB").resize((INPUT_SIZE, INPUT_SIZE), Image.Resampling.BILINEAR)
    array = np.asarray(resized, dtype=np.float32) / 255.0
    tensor = np.transpose(array, (2, 0, 1))[None, ...]
    outputs = runner.run(
        None,
        {
            "image": tensor,
            "im_shape": np.array([[INPUT_SIZE, INPUT_SIZE]], dtype=np.float32),
            "scale_factor": np.array(
                [[INPUT_SIZE / image.height, INPUT_SIZE / image.width]],
                dtype=np.float32,
            ),
        },
    )
    boxes = None
    for output in outputs:
        shape = getattr(output, "shape", None)
        if shape is not None and len(shape) == 2 and shape[1] in (7, 8):
            boxes = output
            break
    if boxes is None:
        raise RuntimeError("PP-DocLayout returned no region boxes.")
    if len(boxes.shape) == 3:
        boxes = boxes[0]
    detections = _parse_output(boxes, int(boxes.shape[1]))
    return detections_to_blocks(detections, image.width, image.height)
