export type WebSnippet = {
  title: string;
  url: string;
  snippet: string;
};

const MAX_QUERY = 240;
const MAX_SNIPPETS = 5;

/** A short query from the stem and the exam context. Passages are not included. */
export function buildSearchQuery(input: {
  stem?: string | null;
  subject?: string | null;
  exam?: string | null;
}): string {
  const stem = (input.stem ?? "").replace(/\s+/g, " ").trim();
  const prefix = [input.exam, input.subject].filter((part) => part?.trim()).join(" ");
  const combined = `${prefix} ${stem}`.trim();
  if (combined.length <= MAX_QUERY) return combined;
  return combined.slice(0, MAX_QUERY).trim();
}

export function formatSnippets(snippets: WebSnippet[]): string {
  return snippets
    .slice(0, MAX_SNIPPETS)
    .map((snippet, index) => {
      const title = snippet.title.trim() || "Result";
      const body = snippet.snippet.trim();
      const url = snippet.url.trim();
      return `${index + 1}. ${title}${url ? ` (${url})` : ""}\n${body}`;
    })
    .join("\n\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asList(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** Read titles, URLs, and snippets from an OmniRoute /v1/search body. */
export function snippetsFromSearchBody(body: unknown): WebSnippet[] {
  const root = asRecord(body);
  if (!root) return [];
  const data = asRecord(root["data"]) ?? root;
  const list =
    asList(data["results"]) ??
    asList(data["organic"]) ??
    asList(root["results"]) ??
    asList(data["items"]) ??
    [];
  const snippets: WebSnippet[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const title = typeof row["title"] === "string" ? row["title"].trim() : "";
    const url =
      typeof row["url"] === "string"
        ? row["url"].trim()
        : typeof row["link"] === "string"
          ? row["link"].trim()
          : "";
    const snippet =
      typeof row["snippet"] === "string"
        ? row["snippet"].trim()
        : typeof row["content"] === "string"
          ? row["content"].trim()
          : typeof row["description"] === "string"
            ? row["description"].trim()
            : "";
    if (!title && !snippet) continue;
    snippets.push({ title, url, snippet });
    if (snippets.length >= MAX_SNIPPETS) break;
  }
  return snippets;
}

/** OmniRoute web search. An empty list means search was unavailable. */
export async function searchWeb(
  query: string,
  options: {
    fetchImpl?: typeof fetch;
    baseUrl?: string | null;
    apiKey?: string | null;
  } = {},
): Promise<WebSnippet[]> {
  const trimmed = query.trim();
  const apiKey = options.apiKey?.trim();
  const baseUrl = options.baseUrl?.trim().replace(/\/$/, "");
  if (!trimmed || !apiKey || !baseUrl) return [];
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${baseUrl}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query: trimmed, max_results: MAX_SNIPPETS, search_type: "web" }),
    });
    if (!response.ok) return [];
    return snippetsFromSearchBody(await response.json());
  } catch {
    return [];
  }
}
