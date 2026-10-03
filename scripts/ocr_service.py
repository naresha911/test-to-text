"""Local reading service.

Printed words come from Tesseract when no other text engine is available.
Diagram boxes come from PP-DocLayout on POST /layout, and only when the
upload page is set to Graphics. This service does not paraphrase the page.
"""

from __future__ import annotations

import base64
import io
import math
import shutil
import subprocess
import sys
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
from PIL import Image
from pydantic import BaseModel

READER_ID = "openocr"
READER_VERSION = "openocr-text-2"
MAX_BYTES = 15_000_000


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Python 3.14 on Windows logs ConnectionResetError when a client closes
    # the socket (WinError 10054). Probes that are not /health or /read do that.
    if sys.platform == "win32":
        import asyncio

        loop = asyncio.get_running_loop()
        previous = loop.get_exception_handler()

        def handler(loop, context):
            error = context.get("exception")
            if isinstance(error, ConnectionResetError):
                return
            if previous is not None:
                previous(loop, context)
            else:
                loop.default_exception_handler(context)

        loop.set_exception_handler(handler)
    yield


app = FastAPI(lifespan=lifespan)


class ReadRequest(BaseModel):
    image_base64: str


class CropRequest(BaseModel):
    image_base64: str
    bbox: list[float]
    pad: float = 0.02
    scale: float = 2.0


def payload_bytes(payload: str) -> int:
    data = payload.split(",", 1)[1] if payload.startswith("data:") else payload
    return (len(data) * 3) // 4


def decode_image(payload: str) -> Image.Image:
    if payload.startswith("data:"):
        payload = payload.split(",", 1)[1]
    raw = base64.b64decode(payload, validate=False)
    if len(raw) > MAX_BYTES:
        raise ValueError("That page image is larger than 15 MB.")
    return Image.open(io.BytesIO(raw)).convert("RGB")


def clamp_box(x: float, y: float, width: float, height: float) -> list[float]:
    left = min(1.0, max(0.0, x))
    top = min(1.0, max(0.0, y))
    box_width = min(1.0 - left, max(0.0, width))
    box_height = min(1.0 - top, max(0.0, height))
    return [round(left, 4), round(top, 4), round(box_width, 4), round(box_height, 4)]


def parse_tesseract_tsv(raw: str, width: int, height: int) -> list[dict]:
    """Group Tesseract TSV word rows into lines with normalised boxes."""
    groups: dict[tuple[str, str, str, str], list[tuple[int, int, int, int, float, str]]] = {}
    order: list[tuple[str, str, str, str]] = []
    for row in raw.splitlines():
        parts = row.split("\t")
        if len(parts) < 12 or parts[0] == "level":
            continue
        try:
            level = int(parts[0])
        except ValueError:
            continue
        if level != 5:
            continue
        text = parts[11].strip()
        if not text:
            continue
        try:
            conf = float(parts[10])
            left, top, word_width, word_height = (int(float(parts[index])) for index in range(6, 10))
        except ValueError:
            continue
        if conf < 0 or word_width <= 0 or word_height <= 0:
            continue
        key = (parts[1], parts[2], parts[3], parts[4])
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append((left, top, word_width, word_height, conf, text))

    page_width = width or 1
    page_height = height or 1
    lines: list[dict] = []
    for key in order:
        words = groups[key]
        left = min(item[0] for item in words)
        top = min(item[1] for item in words)
        right = max(item[0] + item[2] for item in words)
        bottom = max(item[1] + item[3] for item in words)
        text = " ".join(item[5] for item in words).strip()
        if not text:
            continue
        confs = [item[4] for item in words]
        lines.append(
            {
                "id": f"line-{len(lines) + 1}",
                "type": "text",
                "text": text,
                "latex": None,
                "bbox": clamp_box(left / page_width, top / page_height, (right - left) / page_width, (bottom - top) / page_height),
                "confidence": round(sum(confs) / len(confs) / 100, 4),
            }
        )
    return lines


def plain_tesseract_block(image: Image.Image) -> list[dict]:
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "page.png"
        image.save(path)
        completed = subprocess.run(
            ["tesseract", str(path), "stdout", "--psm", "6"],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    text = completed.stdout.strip()
    if completed.returncode != 0 or not text:
        return []
    return [
        {
            "id": "text-1",
            "type": "text",
            "text": text,
            "latex": None,
            "bbox": None,
            "confidence": 0.5,
        }
    ]


def tesseract_blocks(image: Image.Image) -> list[dict]:
    if shutil.which("tesseract") is None:
        return []
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "page.png"
        image.save(path)
        try:
            completed = subprocess.run(
                ["tesseract", str(path), "stdout", "--psm", "6", "tsv"],
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            completed = None
    if completed is not None and completed.returncode == 0:
        lines = parse_tesseract_tsv(completed.stdout, image.width, image.height)
        if lines:
            return lines
    try:
        return plain_tesseract_block(image)
    except subprocess.TimeoutExpired:
        return []


def crop_box(image: Image.Image, bbox: list[float], pad: float, scale: float) -> tuple[str, int, int]:
    if len(bbox) != 4:
        raise ValueError("A question crop needs four numbers.")
    x, y, w, h = (float(number) for number in bbox)
    if not all(math.isfinite(number) for number in (x, y, w, h)):
        raise ValueError("A question crop needs four numbers.")
    pad = min(0.2, max(0.0, float(pad)))
    scale = min(3.0, max(1.0, float(scale)))
    width, height = image.size
    left = max(0, int((x - pad) * width))
    top = max(0, int((y - pad) * height))
    right = min(width, int((x + w + pad) * width))
    bottom = min(height, int((y + h + pad) * height))
    if right - left < 8 or bottom - top < 8:
        raise ValueError("That question crop is too small.")
    cropped = image.crop((left, top, right, bottom))
    if scale > 1:
        cropped = cropped.resize(
            (max(1, int(cropped.width * scale)), max(1, int(cropped.height * scale))),
            Image.Resampling.LANCZOS,
        )
    edge = max(cropped.size)
    if edge > 2400:
        ratio = 2400 / edge
        cropped = cropped.resize(
            (max(1, int(cropped.width * ratio)), max(1, int(cropped.height * ratio))),
            Image.Resampling.LANCZOS,
        )
    buffer = io.BytesIO()
    cropped.save(buffer, format="JPEG", quality=90, optimize=True)
    return base64.b64encode(buffer.getvalue()).decode("ascii"), cropped.width, cropped.height


def jpeg_under_limit(image: Image.Image, limit: int = 900_000) -> tuple[str, int, int]:
    current = image.convert("RGB")
    quality = 85
    while True:
        buffer = io.BytesIO()
        current.save(buffer, format="JPEG", quality=quality, optimize=True)
        if buffer.tell() <= limit or (current.width <= 600 and quality <= 40):
            return base64.b64encode(buffer.getvalue()).decode("ascii"), current.width, current.height
        if quality > 40:
            quality -= 15
        else:
            current = current.resize((max(1, int(current.width * 0.8)), max(1, int(current.height * 0.8))))
            quality = 75


def read_image(image: Image.Image, source_bytes: int = 0) -> dict:
    text = tesseract_blocks(image)
    version = READER_VERSION
    payload = {
        "reader_id": READER_ID,
        "reader_version": version,
        "page_width": image.width,
        "page_height": image.height,
        "blocks": text,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if source_bytes > 1_000_000:
        encoded, width, height = jpeg_under_limit(image)
        payload["page_jpeg_base64"] = encoded
        payload["jpeg_width"] = width
        payload["jpeg_height"] = height
    return payload


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "reader_id": READER_ID,
        "reader_version": READER_VERSION,
        "model_ready": False,
    }


@app.post("/read")
def read_page(body: ReadRequest) -> dict:
    try:
        image = decode_image(body.image_base64)
    except Exception as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return read_image(image, source_bytes=payload_bytes(body.image_base64))


@app.post("/crop")
def crop_region(body: CropRequest) -> dict:
    from fastapi import HTTPException

    try:
        image = decode_image(body.image_base64)
        encoded, width, height = crop_box(image, body.bbox, body.pad, body.scale)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"jpeg_base64": encoded, "width": width, "height": height}


@app.post("/layout")
def read_layout(body: ReadRequest) -> dict:
    from fastapi import HTTPException

    from layout_reader import graphic_blocks

    try:
        image = decode_image(body.image_base64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        blocks = graphic_blocks(image)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "reader_id": READER_ID,
        "reader_version": "pp-doclayout-v2",
        "page_width": image.width,
        "page_height": image.height,
        "blocks": blocks,
    }


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        from layout_reader import detections_to_blocks

        page = Image.new("RGB", (400, 200), "white")
        figures = [block for block in read_image(page)["blocks"] if block["type"] == "figure"]
        if figures:
            raise SystemExit(f"text read returned figure boxes: {figures}")
        kept = detections_to_blocks(
            [("text", 0.9, 0, 0, 80, 20), ("image", 0.8, 10, 40, 90, 120)],
            100,
            150,
        )
        if len(kept) != 1 or kept[0]["type"] != "figure":
            raise SystemExit(f"expected one image region, found {kept}")
        sample = (
            "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
            "5\t1\t1\t1\t1\t1\t10\t20\t30\t12\t90\t12.\n"
            "5\t1\t1\t1\t1\t2\t45\t20\t40\t12\t92\tCats\n"
        )
        parsed = parse_tesseract_tsv(sample, 200, 100)
        if len(parsed) != 1 or parsed[0]["text"] != "12. Cats":
            raise SystemExit(f"expected one tesseract line, found {parsed}")
        if parsed[0]["bbox"][0] != 0.05 or parsed[0]["bbox"][1] != 0.2:
            raise SystemExit(f"unexpected line box {parsed[0]['bbox']}")
        encoded, crop_width, crop_height = crop_box(page, [0.1, 0.1, 0.5, 0.5], 0, 2)
        if crop_width < 100 or crop_height < 50 or not encoded:
            raise SystemExit(f"unexpected crop size {crop_width}x{crop_height}")
        print("layout ok", "text has no blob figures", len(kept))
    else:
        import uvicorn

        uvicorn.run(app, host="127.0.0.1", port=8099)
