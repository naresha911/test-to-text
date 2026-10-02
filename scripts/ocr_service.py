"""Local figure-layout reader.

Printed words are read later by OCR.space or Optiic. This service only returns
the boxes around diagrams, so those regions can be cropped onto the question.
It does not paraphrase the page.
"""

from __future__ import annotations

import base64
import io
import shutil
import subprocess
import sys
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
from PIL import Image, ImageDraw
from pydantic import BaseModel

READER_ID = "openocr"
READER_VERSION = "openocr-layout-2"
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


def _ink(image: Image.Image, max_side: int = 1400) -> tuple[bytearray, int, int]:
    gray = image.convert("L")
    scale = min(1.0, max_side / max(gray.size))
    if scale < 1:
        gray = gray.resize((max(1, int(gray.width * scale)), max(1, int(gray.height * scale))))
    width, height = gray.size
    pixels = list(gray.get_flattened_data() if hasattr(gray, "get_flattened_data") else gray.getdata())
    ink = bytearray(1 if pixel < 185 else 0 for pixel in pixels)
    return ink, width, height


def _components(ink: bytearray, width: int, height: int) -> list[tuple[int, int, int, int, int]]:
    seen = bytearray(width * height)
    found: list[tuple[int, int, int, int, int]] = []
    for start, value in enumerate(ink):
        if not value or seen[start]:
            continue
        stack = [start]
        seen[start] = 1
        min_x = max_x = start % width
        min_y = max_y = start // width
        count = 0
        while stack:
            index = stack.pop()
            count += 1
            x, y = index % width, index // width
            min_x = min(min_x, x)
            max_x = max(max_x, x)
            min_y = min(min_y, y)
            max_y = max(max_y, y)
            if x > 0:
                left = index - 1
                if ink[left] and not seen[left]:
                    seen[left] = 1
                    stack.append(left)
            if x + 1 < width:
                right = index + 1
                if ink[right] and not seen[right]:
                    seen[right] = 1
                    stack.append(right)
            if y > 0:
                up = index - width
                if ink[up] and not seen[up]:
                    seen[up] = 1
                    stack.append(up)
            if y + 1 < height:
                down = index + width
                if ink[down] and not seen[down]:
                    seen[down] = 1
                    stack.append(down)
        found.append((min_x, min_y, max_x, max_y, count))
    return found


def _contains(outer: tuple[float, float, float, float], inner: tuple[float, float, float, float]) -> bool:
    return (
        inner[0] >= outer[0] - 0.005
        and inner[1] >= outer[1] - 0.005
        and inner[0] + inner[2] <= outer[0] + outer[2] + 0.005
        and inner[1] + inner[3] <= outer[1] + outer[3] + 0.005
        and inner[2] * inner[3] < outer[2] * outer[3] * 0.85
    )


def _flat(box: tuple[float, float, float, float]) -> bool:
    _x, _y, width, height = box
    return height < 0.02 and width > height * 2.2


def _merge_stacked(boxes: list[tuple[float, float, float, float]]) -> list[tuple[float, float, float, float]]:
    merged: list[tuple[float, float, float, float]] = []
    for box in sorted(boxes, key=lambda item: (item[1], item[0])):
        x, y, width, height = box
        placed = False
        for index, other in enumerate(merged):
            ox, oy, ow, oh = other
            overlap = min(ox + ow, x + width) - max(ox, x)
            if overlap > 0.5 * min(ow, width) and y <= oy + oh + 0.008:
                nx = min(ox, x)
                ny = min(oy, y)
                merged[index] = (nx, ny, max(ox + ow, x + width) - nx, max(oy + oh, y + height) - ny)
                placed = True
                break
        if not placed:
            merged.append(box)
    return merged


def _figure_like(box_w: int, box_h: int, count: int, width: int, height: int) -> bool:
    if min(box_w, box_h) < 16:
        return False
    nw, nh = box_w / width, box_h / height
    area = nw * nh
    if area < 0.00035 or area > 0.28:
        return False
    density = count / (box_w * box_h)
    # Outlines sit between a faint rule and a solid text block.
    if density < 0.035 or density > 0.72:
        return False
    aspect = nw / nh if nh else 99
    if 0.5 <= aspect <= 2.05:
        return True
    # A row or column of shapes is taller or wider than one line of type.
    if aspect > 2.05 and 0.028 <= nh <= 0.22 and nw <= 0.62:
        return True
    if aspect < 0.5 and 0.028 <= nw <= 0.22 and nh <= 0.4:
        return True
    return False


def figure_boxes(image: Image.Image) -> list[dict]:
    ink, width, height = _ink(image)
    boxes: list[tuple[float, float, float, float]] = []
    for min_x, min_y, max_x, max_y, count in _components(ink, width, height):
        box_w = max_x - min_x + 1
        box_h = max_y - min_y + 1
        if not _figure_like(box_w, box_h, count, width, height):
            continue
        boxes.append((min_x / width, min_y / height, box_w / width, box_h / height))
    boxes = [box for box in _merge_stacked(boxes) if not _flat(box)]
    kept = [
        box
        for box in boxes
        if not any(_contains(other, box) for other in boxes if other != box)
    ]
    kept.sort(key=lambda box: (round(box[1], 2), box[0]))
    return [
        {
            "id": f"fig-{index + 1}",
            "type": "figure",
            "text": None,
            "latex": None,
            "bbox": [round(box[0], 4), round(box[1], 4), round(box[2], 4), round(box[3], 4)],
            "confidence": 0.6,
        }
        for index, box in enumerate(kept)
    ]


def tesseract_blocks(image: Image.Image) -> list[dict]:
    if shutil.which("tesseract") is None:
        return []
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
        "blocks": [*text, *figure_boxes(image)],
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


def _sample_page() -> Image.Image:
    image = Image.new("RGB", (1000, 700), "white")
    draw = ImageDraw.Draw(image)
    draw.polygon([(180, 80), (280, 180), (180, 280), (80, 180)], outline="black", width=4)
    for index in range(4):
        left = 80 + index * 180
        draw.rectangle((left, 400, left + 110, 520), outline="black", width=4)
    return image


def _small_figures_page() -> Image.Image:
    """A full page where each diagram is only a small fraction of the sheet."""
    image = Image.new("RGB", (1600, 2200), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((80, 80, 700, 96), fill="black")
    draw.polygon([(1180, 400), (1260, 480), (1180, 560), (1100, 480)], outline="black", width=3)
    for index in range(4):
        left = 1040 + index * 120
        draw.rectangle((left, 640, left + 80, 720), outline="black", width=3)
    return image


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        for label, page in (("sample", _sample_page()), ("page", _small_figures_page())):
            figures = [block for block in read_image(page)["blocks"] if block["type"] == "figure"]
            if len(figures) != 5:
                raise SystemExit(f"{label}: expected 5 figure boxes, found {len(figures)}: {figures}")
            print("layout ok", label, len(figures))
    else:
        import uvicorn

        uvicorn.run(app, host="127.0.0.1", port=8099)
