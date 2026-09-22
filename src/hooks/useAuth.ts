import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

function hasSupabaseClientEnv(): boolean {
  return Boolean(
    import.meta.env["VITE_SUPABASE_URL"] && import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"],
  );
}

/**
 * Optional Supabase session hook.
 * When Supabase env vars are missing (local-only PaperParse), this is a no-op:
 * session stays null and loading becomes false immediately — no auth listener.
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hasSupabaseClientEnv()) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void import("@/integrations/supabase/client")
      .then(({ supabase }) => {
        if (cancelled) return;

        const { data } = supabase.auth.onAuthStateChange((_event, next) => {
          if (cancelled) return;
          setSession(next);
          setLoading(false);
        });
        unsubscribe = () => data.subscription.unsubscribe();

        return supabase.auth.getSession().then(({ data: { session: current } }) => {
          if (cancelled) return;
          setSession(current);
          setLoading(false);
        });
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return { session, user: session?.user ?? null, loading };
}
