import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

function hasSupabaseClientEnv(): boolean {
  return Boolean(
    import.meta.env["VITE_SUPABASE_URL"] && import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"],
  );
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hasSupabaseClientEnv()) {
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | undefined;
    void import("@/integrations/supabase/client")
      .then(({ supabase }) => {
        const { data } = supabase.auth.onAuthStateChange((_event, next) => {
          setSession(next);
          setLoading(false);
        });
        unsubscribe = () => data.subscription.unsubscribe();

        return supabase.auth.getSession().then(({ data: { session: current } }) => {
          setSession(current);
          setLoading(false);
        });
      })
      .catch(() => setLoading(false));

    return () => unsubscribe?.();
  }, []);

  return { session, user: session?.user ?? null, loading };
}
