import { describe, expect, test } from "bun:test";

import { ensureSvgRootAttributes } from "@/lib/assets/svg-sanitize";

describe("ensureSvgRootAttributes", () => {
  test("adds the SVG namespace and intrinsic size from the viewBox", () => {
    const out = ensureSvgRootAttributes('<svg viewBox="0 0 10 20"><rect/></svg>');
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('width="10"');
    expect(out).toContain('height="20"');
  });

  test("keeps a fully-specified root untouched", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" width="5" height="5" viewBox="0 0 5 5"><rect/></svg>';
    expect(ensureSvgRootAttributes(input)).toBe(input);
  });

  test("handles a self-closing root", () => {
    const out = ensureSvgRootAttributes('<svg viewBox="0 0 4 4" />');
    expect(out).toBe(
      '<svg viewBox="0 0 4 4" xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>',
    );
  });

  test("leaves non-svg text untouched", () => {
    expect(ensureSvgRootAttributes("not an svg")).toBe("not an svg");
  });
});
