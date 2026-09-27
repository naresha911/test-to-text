import type { MirrorElement, MirrorTransform } from "@/lib/generation/visual/spec";

export type PlacedShape = MirrorElement;

function mirrorRectVertical(
  element: Extract<MirrorElement, { shape: "rect" }>,
  width: number,
): MirrorElement {
  return { ...element, x: width - element.x - element.w };
}

function mirrorCircleVertical(
  element: Extract<MirrorElement, { shape: "circle" }>,
  width: number,
): MirrorElement {
  return { ...element, cx: width - element.cx };
}

/** Renderer-owned transform. The oracle uses a separate implementation. */
export function placeElements(
  elements: MirrorElement[],
  transform: MirrorTransform,
  canvas: { width: number; height: number },
): PlacedShape[] {
  return elements.map((element) => {
    if (transform === "identity") return { ...element };
    if (element.shape === "rect") {
      if (transform === "mirror_vertical") return mirrorRectVertical(element, canvas.width);
      if (transform === "mirror_horizontal") {
        return { ...element, y: canvas.height - element.y - element.h };
      }
      return {
        ...element,
        x: canvas.width - element.x - element.w,
        y: canvas.height - element.y - element.h,
      };
    }
    if (transform === "mirror_vertical") return mirrorCircleVertical(element, canvas.width);
    if (transform === "mirror_horizontal") {
      return { ...element, cy: canvas.height - element.cy };
    }
    return { ...element, cx: canvas.width - element.cx, cy: canvas.height - element.cy };
  });
}

function renderShape(shape: PlacedShape): string {
  if (shape.shape === "rect") {
    return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" fill="${shape.fill}" />`;
  }
  return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${shape.fill}" />`;
}

export function renderSvg(
  shapes: PlacedShape[],
  canvas: { width: number; height: number },
): string {
  const body = shapes.map(renderShape).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">${body}</svg>`;
}
