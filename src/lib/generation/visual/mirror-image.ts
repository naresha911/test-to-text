import type { MirrorElement, MirrorImageSpec, MirrorTransform } from "@/lib/generation/visual/spec";
import { hashSeed } from "@/lib/generation/job-types";

const WIDTH = 160;
const HEIGHT = 160;

function templates(seed: number): MirrorElement[] {
  const variant = seed % 3;
  if (variant === 0) {
    return [
      { id: "block", shape: "rect", x: 18, y: 28, w: 36, h: 70, fill: "#1d4ed8" },
      { id: "dot", shape: "circle", cx: 78, cy: 46, r: 14, fill: "#b45309" },
    ];
  }
  if (variant === 1) {
    return [
      { id: "bar", shape: "rect", x: 24, y: 96, w: 84, h: 18, fill: "#047857" },
      { id: "dot", shape: "circle", cx: 40, cy: 40, r: 16, fill: "#be123c" },
    ];
  }
  return [
    { id: "tall", shape: "rect", x: 22, y: 22, w: 22, h: 90, fill: "#6d28d9" },
    { id: "wide", shape: "rect", x: 52, y: 36, w: 48, h: 16, fill: "#0f766e" },
    { id: "dot", shape: "circle", cx: 112, cy: 108, r: 12, fill: "#c2410c" },
  ];
}

const DISTRACTORS: MirrorTransform[] = ["identity", "mirror_horizontal", "rotate_180"];

/** Builds a new figure. The source crop is not traced or reflected into these coordinates. */
export function inventMirrorSpec(seedKey: string): MirrorImageSpec {
  const seed = hashSeed(seedKey);
  const correctSlot = seed % 4;
  const option_transforms: Record<string, MirrorTransform> = {};
  let distractor = 0;
  for (let index = 0; index < 4; index += 1) {
    const key = String.fromCharCode(65 + index);
    if (index === correctSlot) option_transforms[key] = "mirror_vertical";
    else {
      option_transforms[key] = DISTRACTORS[distractor] ?? "identity";
      distractor += 1;
    }
  }
  return {
    kind: "mirror_image",
    canvas: { width: WIDTH, height: HEIGHT },
    elements: templates(seed),
    transformation: { axis: "vertical", coordinate_system: "cartesian" },
    correct_key: String.fromCharCode(65 + correctSlot),
    option_transforms,
  };
}
