const ALLOWED_TAGS = new Set([
  "svg",
  "g",
  "rect",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "line",
  "path",
  "text",
  "title",
]);

const MAX_SVG_CHARS = 200_000;

export class SvgRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SvgRejectedError";
  }
}

function stripDisallowedTags(svg: string): string {
  return svg.replace(/<\/?([a-zA-Z][\w:-]*)\b[^>]*\/?>/g, (tag, name: string) => {
    const normalized = name.toLowerCase();
    if (normalized === "foreignobject" || normalized === "script" || normalized === "iframe") {
      return "";
    }
    return ALLOWED_TAGS.has(normalized) ? tag : "";
  });
}

/** Drops scripts, event handlers, external references, and foreignObject. */
export function sanitizeSvg(svg: string): string {
  if (svg.length > MAX_SVG_CHARS) {
    throw new SvgRejectedError("SVG is larger than the allowed size.");
  }
  let next = svg
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\s(?:href|xlink:href)\s*=\s*(['"])(?!#).*?\1/gi, "");
  next = stripDisallowedTags(next);
  if (/<script\b|<foreignobject\b|javascript:/i.test(next)) {
    throw new SvgRejectedError("SVG still contains unsafe content.");
  }
  if (!next.includes("<svg")) {
    throw new SvgRejectedError("SVG is missing the root element.");
  }
  return next;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * Make a drawing usable as a standalone SVG image. A standalone SVG fed to an
 * `<img>`/data URL needs the SVG namespace to decode, and an intrinsic size for
 * layout. Model-authored drawings often omit both, so derive them from the root
 * tag and its viewBox.
 */
export function ensureSvgRootAttributes(svg: string): string {
  const match = /<svg\b[^>]*>/i.exec(svg);
  if (!match) return svg;
  const open = match[0];
  const has = (name: string) => new RegExp(`\\s${name}\\s*[=:]`, "i").test(open);

  const additions: string[] = [];
  if (!has("xmlns")) additions.push(`xmlns="${SVG_NAMESPACE}"`);

  if (!has("width") || !has("height")) {
    const viewBox = /\sviewBox\s*=\s*(['"])([^'"]*)\1/i.exec(open);
    const numbers = viewBox?.[2]?.trim().split(/[\s,]+/).map(Number) ?? [];
    if (numbers.length === 4 && numbers.every((value) => Number.isFinite(value))) {
      if (!has("width")) additions.push(`width="${numbers[2]}"`);
      if (!has("height")) additions.push(`height="${numbers[3]}"`);
    }
  }
  if (additions.length === 0) return svg;

  const selfClosing = /\/>$/.test(open);
  const head = open.slice(0, -1).replace(/\/$/, "").trimEnd();
  const rebuilt = `${head} ${additions.join(" ")}${selfClosing ? "/>" : ">"}`;
  return svg.slice(0, match.index) + rebuilt + svg.slice(match.index + open.length);
}
