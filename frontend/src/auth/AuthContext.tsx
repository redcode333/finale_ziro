import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api, setAuthHeaderProvider } from '@/api/client'
import { getMentorToken, setMentorToken } from '@/api/live'
import type { Me, Role } from '@/types'

// Two ways in. A mentor token talks to the real backend (api/live.ts). A mock identity uses the mock layer for everything.
// Either way the role comes from the backend's /me answer, never from the UI.
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
  error: string | null
  signIn: (userId: string) => void
  signInWithToken: (token: string) => void
  signOut: () => void
  rolesFor: (projectId?: string) => Role[]
}
const Ctx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [userId, setUserId] = useState<string | null>(read)
  const [token, setToken] = useState<string | null>(getMentorToken)
  const [error, setError] = useState<string | null>(null)

  // Mock-only features still run on the mock layer, which needs a mock identity. A token session acts as the mock mentor there.
  setAuthHeaderProvider(() => (token ? { 'X-Mock-User': 'MENTOR001' } : userId ? { 'X-Mock-User': userId } : ({} as Record<string, string>)))

  // Retry transient failures; only an explicit 401 means the session is gone.
  const q = useQuery({
    queryKey: ['me', userId, token], queryFn: api.me, enabled: !!(userId || token),
    retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 2,
  })
  const unauthenticated = q.error instanceof ApiError && q.error.status === 401
  useEffect(() => {
    if (!unauthenticated) return
    if (token) setError('That mentor token was not accepted.')
    setMentorToken(null); setToken(null); write(null); setUserId(null)
  }, [unauthenticated, token])

  const signIn = useCallback((id: string) => { setError(null); setMentorToken(null); setToken(null); write(id); setUserId(id) }, [])
  const signInWithToken = useCallback((t: string) => { setError(null); write(null); setUserId(null); setMentorToken(t.trim()); setToken(t.trim()) }, [])
  const signOut = useCallback(() => { setError(null); setMentorToken(null); setToken(null); write(null); setUserId(null); qc.clear() }, [qc])

  const value = useMemo<AuthValue>(() => {
    const me = q.data ?? null
    return {
      me, error,
      loading: !!(userId || token) && q.isPending,
      signIn, signInWithToken, signOut,
      rolesFor: (projectId) =>
        (me?.memberships ?? [])
          .filter((m) => m.status === 'ACTIVE' && (!projectId || m.project_id === projectId))
          .map((m) => m.role),
    }
  }, [q.data, q.isPending, userId, token, error, signIn, signInWithToken, signOut])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
