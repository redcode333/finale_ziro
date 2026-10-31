import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import type { Role } from '@/types'

// UX-only guard. The backend re-checks membership and role on every request.
export function RequireRole({ role }: { role: Role }) {
  const { me, loading, rolesFor } = useAuth()
  if (loading) return <div className="p-8 text-muted-foreground">Loading workspace…</div>
  if (!me) return <Navigate to="/signin" replace />
  if (!rolesFor().includes(role)) return <Navigate to="/denied" replace state={{ wanted: role }} />
  return <Outlet />
}
