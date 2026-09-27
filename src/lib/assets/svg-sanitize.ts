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
