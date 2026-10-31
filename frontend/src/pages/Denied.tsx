import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'

export default function Denied() {
  const { rolesFor, signOut } = useAuth()
  const wanted = (useLocation().state as { wanted?: string } | null)?.wanted
  const roles = rolesFor()
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">Access denied</h1>
      <p className="text-muted-foreground">
        You do not have the {wanted?.toLowerCase() ?? 'required'} role in this project.
        {roles.length > 0 && ' You can open your own workspace instead.'}
      </p>
      <div className="flex gap-2">
        {roles.map((r) => (
          <Link key={r} to={r === 'ADMIN' ? '/admin' : '/contributor'} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm text-primary-foreground">
            Open {r.toLowerCase()} workspace
          </Link>
        ))}
        <Button variant="outline" onClick={signOut}>Sign out</Button>
      </div>
    </main>
  )
}
