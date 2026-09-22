import { createMiddleware } from '@tanstack/react-start'

function hasSupabaseClientEnv(): boolean {
  const url = import.meta.env['VITE_SUPABASE_URL'] || process.env['SUPABASE_URL']
  const key =
    import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'] || process.env['SUPABASE_PUBLISHABLE_KEY']
  return Boolean(url && key)
}

// Must be registered as a global `functionMiddleware` in `src/start.ts`; otherwise
// the browser never attaches the bearer token to serverFn RPCs.
// When Supabase is not configured (local-only mode), this is a no-op.
export const attachSupabaseAuth = createMiddleware({ type: 'function' }).client(
  async ({ next }) => {
    if (!hasSupabaseClientEnv()) {
      return next({ headers: {} })
    }
    try {
      const { supabase } = await import('./client')
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      return next({
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
    } catch {
      return next({ headers: {} })
    }
  },
)
