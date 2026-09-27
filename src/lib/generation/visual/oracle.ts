import type { MirrorElement, MirrorImageSpec } from "@/lib/generation/visual/spec";
import {
  combineValidation,
  type ValidationCheck,
  type ValidationResult,
} from "@/lib/generation/validation-types";

type Box = { x: number; y: number; w: number; h: number };
type Dot = { cx: number; cy: number; r: number };

function independentMirror(
  elements: MirrorElement[],
  width: number,
): { rects: Box[]; circles: Dot[] } {
  const rects: Box[] = [];
  const circles: Dot[] = [];
  for (const element of elements) {
    if (element.shape === "rect") {
      rects.push({
        x: width - (element.x + element.w),
        y: element.y,
        w: element.w,
        h: element.h,
      });
    } else {
      circles.push({ cx: width - element.cx, cy: element.cy, r: element.r });
    }
  }
  return { rects, circles };
}

function readSvg(svg: string): { rects: Box[]; circles: Dot[] } {
  const rects: Box[] = [];
  const circles: Dot[] = [];
  for (const match of svg.matchAll(
    /<rect\b[^>]*\bx="(-?\d+(?:\.\d+)?)"[^>]*\by="(-?\d+(?:\.\d+)?)"[^>]*\bwidth="(-?\d+(?:\.\d+)?)"[^>]*\bheight="(-?\d+(?:\.\d+)?)"/g,
  )) {
    rects.push({
      x: Number(match[1]),
      y: Number(match[2]),
      w: Number(match[3]),
      h: Number(match[4]),
    });
  }
  for (const match of svg.matchAll(
    /<circle\b[^>]*\bcx="(-?\d+(?:\.\d+)?)"[^>]*\bcy="(-?\d+(?:\.\d+)?)"[^>]*\br="(-?\d+(?:\.\d+)?)"/g,
  )) {
    circles.push({ cx: Number(match[1]), cy: Number(match[2]), r: Number(match[3]) });
  }
  return { rects, circles };
}

function sameGeometry(
  left: { rects: Box[]; circles: Dot[] },
  right: { rects: Box[]; circles: Dot[] },
): boolean {
  if (left.rects.length !== right.rects.length || left.circles.length !== right.circles.length) {
    return false;
  }
  const rects = [...left.rects].sort((a, b) => a.x - b.x || a.y - b.y);
  const otherRects = [...right.rects].sort((a, b) => a.x - b.x || a.y - b.y);
  for (let index = 0; index < rects.length; index += 1) {
    const a = rects[index]!;
    const b = otherRects[index]!;
    if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h) return false;
  }
  const circles = [...left.circles].sort((a, b) => a.cx - b.cx || a.cy - b.cy);
  const otherCircles = [...right.circles].sort((a, b) => a.cx - b.cx || a.cy - b.cy);
  for (let index = 0; index < circles.length; index += 1) {
    const a = circles[index]!;
    const b = otherCircles[index]!;
    if (a.cx !== b.cx || a.cy !== b.cy || a.r !== b.r) return false;
  }
  return true;
}

export function validateMirrorSvgs(
  spec: MirrorImageSpec,
  optionSvgs: Record<string, string>,
  createdAt?: string,
): ValidationResult {
  const expected = independentMirror(spec.elements, spec.canvas.width);
  const checks: ValidationCheck[] = [];
  const correctSvg = optionSvgs[spec.correct_key];
  if (!correctSvg) {
    checks.push({
      name: "visual",
      status: "failed" as const,
      details: "The keyed mirror option has no SVG.",
    });
    return combineValidation(checks, createdAt);
  }
  const correct = readSvg(correctSvg);
  if (!sameGeometry(expected, correct)) {
    checks.push({
      name: "visual",
      status: "failed" as const,
      details: "The keyed option is not the vertical mirror of the question figure.",
    });
  } else {
    checks.push({
      name: "visual",
      status: "passed" as const,
      details: "Independent reflection matches the keyed option.",
    });
  }

  const distractorHit = Object.entries(optionSvgs).filter(
    ([key, svg]) => key !== spec.correct_key && sameGeometry(expected, readSvg(svg)),
  );
  checks.push({
    name: "distractors",
    status: distractorHit.length ? ("failed" as const) : ("passed" as const),
    details: distractorHit.length
      ? `Option ${distractorHit.map(([key]) => key).join(", ")} is also an exact mirror.`
      : "Distractors are not exact mirrors.",
  });

  return combineValidation(checks, createdAt);
}
