/** Browser-only helpers for preparing page images and cropping figures. */

const MAX_EDGE = 2000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that image file."));
    img.src = src;
  });
}

function readAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that image file."));
    reader.readAsDataURL(file);
  });
}

/** OCR.space free tier rejects a page larger than 1 MB. */
export const OCR_SPACE_MAX_BYTES = 1_000_000;

function jpegByteLength(dataUrl: string): number {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function drawScaled(img: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot process images.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

/** Re-encode a page JPEG until it fits a byte limit. Used for the OCR.space free tier. */
export async function shrinkJpegUnderBytes(dataUrl: string, maxBytes: number): Promise<string> {
  if (jpegByteLength(dataUrl) <= maxBytes) return dataUrl;
  const img = await loadImage(dataUrl);
  let width = img.width;
  let height = img.height;
  const qualities = [0.85, 0.7, 0.55, 0.4, 0.3];

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const canvas = drawScaled(img, width, height);
    for (const quality of qualities) {
      const next = canvas.toDataURL("image/jpeg", quality);
      if (jpegByteLength(next) <= maxBytes) return next;
    }
    width = Math.max(1, Math.round(width * 0.8));
    height = Math.max(1, Math.round(height * 0.8));
    if (width < 400 && height < 400) break;
  }

  throw new Error("This page is still over the OCR.space free limit of 1 MB after shrinking.");
}

/** Downscale to a sane edge length and re-encode as JPEG for the AI request. */
export async function preparePageImage(file: File): Promise<{ dataUrl: string; blob: Blob }> {
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const dataUrl = drawScaled(img, width, height).toDataURL("image/jpeg", 0.9);
  const blob = await (await fetch(dataUrl)).blob();
  return { dataUrl, blob };
}

/** Crop a normalised [x, y, w, h] box out of a page image, with a small margin. */
export async function cropFigure(
  pageDataUrl: string,
  bbox: [number, number, number, number],
): Promise<Blob | null> {
  const img = await loadImage(pageDataUrl);
  const pad = 0.012;
  const x = Math.max(0, (bbox[0] - pad) * img.width);
  const y = Math.max(0, (bbox[1] - pad) * img.height);
  const w = Math.min(img.width - x, (bbox[2] + pad * 2) * img.width);
  const h = Math.min(img.height - y, (bbox[3] + pad * 2) * img.height);
  if (w < 16 || h < 16) return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  return (await fetch(dataUrl)).blob();
}
