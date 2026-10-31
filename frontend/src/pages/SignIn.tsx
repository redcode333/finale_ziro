import { ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { mockUsers } from '@/mocks/store'
import type { Role } from '@/types'

const CARDS: { role: Role; title: string; blurb: string; cta: string; icon: typeof ShieldCheck }[] = [
  { role: 'ADMIN', title: 'Admin', icon: ShieldCheck, cta: 'Continue to Admin Sign-in',
    blurb: 'Manage projects, teams, sprints, analytics, AI recommendations and approvals.' },
  { role: 'CONTRIBUTOR', title: 'Contributor', icon: UserRound, cta: 'Continue to Contributor Sign-in',
    blurb: 'View assigned work, update tasks, submit standups, raise blockers and track personal progress.' },
]

// The selected card is only a navigation preference. The backend /me response decides which portal opens.
export default function SignIn() {
  const { me, signIn, rolesFor } = useAuth()
  const navigate = useNavigate()
  const [wanted, setWanted] = useState<Role | null>(null)

  useEffect(() => {
    if (!me) return
    const roles = rolesFor()
    if (wanted && roles.includes(wanted)) navigate(wanted === 'ADMIN' ? '/admin' : '/contributor', { replace: true })
    else if (wanted) navigate('/denied', { replace: true, state: { wanted } })
    else navigate(roles.includes('ADMIN') ? '/admin' : '/contributor', { replace: true })
  }, [me, wanted, navigate, rolesFor])

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-4 py-12">
      <header>
        <p className="font-mono text-sm text-primary">FairSprint AI</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Choose your workspace</h1>
        <p className="mt-2 text-muted-foreground">
          Your access is determined by your project membership, not by this choice.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map(({ role, title, blurb, cta, icon: Icon }) => (
          <Card key={role} className={wanted === role ? 'ring-2 ring-primary' : ''}>
            <CardHeader>
              <Icon className="mb-2 size-6 text-primary" aria-hidden />
              <CardTitle>{title}</CardTitle>
              <CardDescription>{blurb}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant={wanted === role ? 'default' : 'secondary'} onClick={() => setWanted(role)}>
                {cta}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {wanted && (
        <Card>
          <CardHeader>
            <CardTitle>Mock sign-in</CardTitle>
            <CardDescription>Development only. Pick an identity; Supabase Auth replaces this later.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {mockUsers.map((u) => (
              <Button key={u.user_id} size="sm" variant="outline" onClick={() => signIn(u.user_id)}>
                {u.label}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
    </main>
  )
}
