"""Local reading service.

Printed words come from Tesseract when no other text engine is available.
Diagram boxes come from PP-DocLayout on POST /layout, and only when the
upload page is set to Graphics. This service does not paraphrase the page.
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
from PIL import Image
from pydantic import BaseModel

READER_ID = "openocr"
READER_VERSION = "openocr-text-1"
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
        print("layout ok", "text has no blob figures", len(kept))
    else:
        import uvicorn

        uvicorn.run(app, host="127.0.0.1", port=8099)
