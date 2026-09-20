import type { OAuthProvider } from "@lovable.dev/cloud-auth-js";

/**
 * Lovable Cloud Auth allowlists http://127.0.0.1:<port> but rejects http://localhost.
 * Prefer 127.0.0.1 for local OAuth redirects and session storage.
 */
export function localOAuthOrigin(): string {
  const port = window.location.port || "8080";
  return `http://127.0.0.1:${port}`;
}

export function isLocalDevHost(): boolean {
  if (typeof window === "undefined") return false;
  return /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
}

/** Move localhost → 127.0.0.1 so sessions and OAuth stay on an allowlisted origin. */
export function preferLoopbackHost(): void {
  if (typeof window === "undefined") return;
  if (window.location.hostname !== "localhost") return;
  const url = new URL(window.location.href);
  url.hostname = "127.0.0.1";
  window.location.replace(url.toString());
}

/**
 * Full-page Lovable OAuth using the allowlisted 127.0.0.1 origin.
 * Requires Vite proxy of /~oauth → the published Lovable app.
 */
export async function signInWithOAuthLocal(
  provider: OAuthProvider,
): Promise<{ error: null; redirected: true } | { error: Error; redirected?: false }> {
  const state =
    typeof crypto !== "undefined" && crypto.getRandomValues
      ? [...crypto.getRandomValues(new Uint8Array(16))]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
      : Math.random().toString(36).substring(2) + Date.now().toString(36);

  const params = new URLSearchParams({
    provider,
    redirect_uri: localOAuthOrigin(),
    state,
  });

  // Relative /~oauth is proxied in vite.config.ts to the published app.
  window.location.href = `/~oauth/initiate?${params.toString()}`;
  return { error: null, redirected: true };
}
