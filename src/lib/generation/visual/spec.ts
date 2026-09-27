export type MirrorElement =
  | {
      id: string;
      shape: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      fill: string;
    }
  | {
      id: string;
      shape: "circle";
      cx: number;
      cy: number;
      r: number;
      fill: string;
    };

export type MirrorTransform = "identity" | "mirror_vertical" | "mirror_horizontal" | "rotate_180";

export type MirrorImageSpec = {
  kind: "mirror_image";
  canvas: { width: number; height: number };
  elements: MirrorElement[];
  transformation: { axis: "vertical"; coordinate_system: "cartesian" };
  correct_key: string;
  option_transforms: Record<string, MirrorTransform>;
};

export function isMirrorImageSpec(value: unknown): value is MirrorImageSpec {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record["kind"] === "mirror_image" &&
    Array.isArray(record["elements"]) &&
    typeof record["correct_key"] === "string" &&
    record["option_transforms"] != null &&
    typeof record["option_transforms"] === "object"
  );
}
