/** What the pages in this Read pages click contain. Not stored in Settings. */

export const CONTENT_MODES = ["text", "graphics"] as const;

export type ContentMode = (typeof CONTENT_MODES)[number];
