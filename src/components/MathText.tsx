import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";

import { cn } from "@/lib/utils";

type Segment = { kind: "text" | "inline" | "block"; value: string };

function tokenize(input: string): Segment[] {
  const segments: Segment[] = [];
  let rest = input;

  while (rest.length) {
    const block = rest.indexOf("$$");
    const inlineMatch = /(?<!\\)\$/.exec(rest);
    const inline = inlineMatch ? inlineMatch.index : -1;

    if (block !== -1 && (inline === -1 || block <= inline)) {
      if (block > 0) segments.push({ kind: "text", value: rest.slice(0, block) });
      const close = rest.indexOf("$$", block + 2);
      if (close === -1) {
        segments.push({ kind: "text", value: rest.slice(block) });
        break;
      }
      segments.push({ kind: "block", value: rest.slice(block + 2, close) });
      rest = rest.slice(close + 2);
      continue;
    }

    if (inline !== -1) {
      if (inline > 0) segments.push({ kind: "text", value: rest.slice(0, inline) });
      const after = rest.slice(inline + 1);
      const closeMatch = /(?<!\\)\$/.exec(after);
      if (!closeMatch) {
        segments.push({ kind: "text", value: rest.slice(inline) });
        break;
      }
      segments.push({ kind: "inline", value: after.slice(0, closeMatch.index) });
      rest = after.slice(closeMatch.index + 1);
      continue;
    }

    segments.push({ kind: "text", value: rest });
    break;
  }

  return segments;
}

function render(segments: Segment[]): string {
  return segments
    .map((segment) => {
      if (segment.kind === "text") {
        return segment.value
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br />");
      }
      try {
        return katex.renderToString(segment.value, {
          displayMode: segment.kind === "block",
          throwOnError: false,
          strict: false,
          output: "html",
        });
      } catch {
        return `<code>${segment.value}</code>`;
      }
    })
    .join("");
}

/** Renders text that may contain inline ($...$) or display ($$...$$) LaTeX. */
export function MathText({
  value,
  className,
  as: Tag = "div",
}: {
  value?: string | null;
  className?: string;
  as?: "div" | "span" | "p";
}) {
  const html = useMemo(() => (value ? render(tokenize(value)) : ""), [value]);
  if (!value) return null;
  return (
    <Tag
      className={cn("[&_.katex-display]:my-3 leading-relaxed", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
