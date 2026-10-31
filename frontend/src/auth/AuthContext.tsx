import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api, setAuthHeaderProvider } from '@/api/client'
import type { Me, Role } from '@/types'

// Mock auth for early development. Production swaps this for Supabase Auth (bearer token);
// the role always comes from the backend's /me response, never from the UI.
const KEY = 'fairsprint.mockUser'
const read = () => {
  try { return localStorage.getItem(KEY) } catch { return null }
}
const write = (v: string | null) => {
  try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
}

interface AuthValue {
  me: Me | null
  loading: boolean
  signIn: (userId: string) => void
  signOut: () => void
  rolesFor: (projectId?: string) => Role[]
}
const Ctx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [userId, setUserId] = useState<string | null>(read)

  setAuthHeaderProvider(() => (userId ? { 'X-Mock-User': userId } : ({} as Record<string, string>)))

  // Retry transient failures; only an explicit 401 means the session is gone.
  const q = useQuery({
    queryKey: ['me', userId], queryFn: api.me, enabled: !!userId,
    retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 2,
  })
  const unauthenticated = q.error instanceof ApiError && q.error.status === 401
  useEffect(() => {
    if (unauthenticated) { write(null); setUserId(null) }
  }, [unauthenticated])

  const signIn = useCallback((id: string) => { write(id); setUserId(id) }, [])
  const signOut = useCallback(() => { write(null); setUserId(null); qc.clear() }, [qc])

  const value = useMemo<AuthValue>(() => {
    const me = q.data ?? null
    return {
      me,
      loading: !!userId && q.isPending,
      signIn,
      signOut,
      rolesFor: (projectId) =>
        (me?.memberships ?? [])
          .filter((m) => m.status === 'ACTIVE' && (!projectId || m.project_id === projectId))
          .map((m) => m.role),
    }
  }, [q.data, q.isPending, userId, signIn, signOut])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
