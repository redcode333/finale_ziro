import { ShieldCheck, TriangleAlert, UserRound } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { liveConfigured, mentorLogin } from '@/api/live'
import { useAuth } from '@/auth/AuthContext'
import TurnstileWidget from '@/components/common/TurnstileWidget'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { adminSignInMode, contributorSignInAvailable, signInErrorMessage } from '@/lib/signInErrors'
import { mockUsers } from '@/mocks/store'
import type { Role } from '@/types'

const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? ''
const MOCKS_ON = import.meta.env.VITE_USE_MOCKS === 'true'

const CARDS: { role: Role; title: string; blurb: string; cta: string; icon: typeof ShieldCheck }[] = [
  { role: 'ADMIN', title: 'Admin', icon: ShieldCheck, cta: 'Continue to Admin Sign-in',
    blurb: 'Manage projects, teams, sprints, analytics, AI recommendations and approvals.' },
  { role: 'CONTRIBUTOR', title: 'Contributor', icon: UserRound, cta: 'Continue to Contributor Sign-in',
    blurb: 'View assigned work, update tasks, submit standups, raise blockers and track personal progress.' },
]

function NotAvailable({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card role="alert">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><TriangleAlert className="size-4 text-warning" aria-hidden /> {title}</CardTitle>
        <CardDescription>{children}</CardDescription>
      </CardHeader>
    </Card>
  )
}

// The selected card is only a navigation preference. The backend /me response decides which portal opens.
export default function SignIn() {
  const { me, error, signIn, signInWithToken, rolesFor } = useAuth()
  const navigate = useNavigate()
  const [wanted, setWanted] = useState<Role | null>(null)
  const [token, setToken] = useState('')
  const [demo, setDemo] = useState(!liveConfigured)
  const [human, setHuman] = useState<string | null>(null)
  const [resetSignal, setResetSignal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!me) return
    const roles = rolesFor()
    if (wanted && roles.includes(wanted)) navigate(wanted === 'ADMIN' ? '/admin' : '/contributor', { replace: true })
    else if (wanted) navigate('/denied', { replace: true, state: { wanted } })
    else navigate(roles.includes('ADMIN') ? '/admin' : '/contributor', { replace: true })
  }, [me, wanted, navigate, rolesFor])

  // What this build can actually offer. A form that cannot work is replaced by an explanation of how to fix the deployment.
  const adminMode = adminSignInMode({ liveConfigured, mocksOn: MOCKS_ON, wantsDemo: demo })
  const useToken = wanted === 'ADMIN' && adminMode === 'live'
  const showDemo = (wanted === 'ADMIN' && adminMode === 'demo') || (wanted === 'CONTRIBUTOR' && contributorSignInAvailable(MOCKS_ON))
  const adminUnavailable = wanted === 'ADMIN' && adminMode === 'unavailable'
  const contributorUnavailable = wanted === 'CONTRIBUTOR' && !contributorSignInAvailable(MOCKS_ON)

  // The backend verifies the Turnstile token before it checks the mentor token. Whatever the outcome, the token is spent,
  // so a failed attempt always asks the widget for a fresh one.
  async function submitToken(e: FormEvent) {
    e.preventDefault()
    if (!token.trim() || busy) return
    setBusy(true); setFormError(null)
    try {
      await mentorLogin(token, human)
      signInWithToken(token)
    } catch (err) {
      setFormError(signInErrorMessage(err, { turnstileSiteKey: TURNSTILE_SITE_KEY }))
      setHuman(null); setResetSignal((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

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

      {error && <p role="alert" className="rounded-lg border border-critical/40 bg-critical/10 p-2.5 text-sm text-critical">{error}</p>}

      {adminUnavailable && (
        <NotAvailable title="Admin sign-in is not set up on this site">
          This build has no live API address (VITE_LIVE_API_URL) and demo mode is off (VITE_USE_MOCKS), so there is nothing to sign in to.
          Ask the site owner to set them and redeploy.
        </NotAvailable>
      )}

      {contributorUnavailable && (
        <NotAvailable title="Contributor sign-in is not available on this site">
          Contributors exist only in demo mode, and the live backend has no contributor login yet. Demo mode is off in this build.
        </NotAvailable>
      )}

      {useToken && (
        <Card>
          <CardHeader>
            <CardTitle>Mentor sign-in (live backend)</CardTitle>
            <CardDescription>Paste your mentor token. It is kept only for this browser tab and sent to the backend as a bearer token.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={submitToken}>
              <div className="flex flex-wrap gap-2">
                <label htmlFor="mentor-token" className="sr-only">Mentor token</label>
                <Input id="mentor-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="fsm_…" className="min-w-60 flex-1" />
                <Button type="submit" disabled={!token.trim() || busy || (!!TURNSTILE_SITE_KEY && !human)}>{busy ? 'Signing in…' : 'Sign in'}</Button>
              </div>
              {TURNSTILE_SITE_KEY && <TurnstileWidget siteKey={TURNSTILE_SITE_KEY} action="mentor_login" onToken={setHuman} resetSignal={resetSignal} />}
              {formError && <p role="alert" className="rounded-lg border border-critical/40 bg-critical/10 p-2.5 text-sm text-critical">{formError}</p>}
            </form>
            {MOCKS_ON && (
              <button type="button" onClick={() => setDemo(true)} className="mt-3 text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                Use demo data instead
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {showDemo && (
        <Card>
          <CardHeader>
            <CardTitle>Demo sign-in</CardTitle>
            <CardDescription>
              Pick a demo identity; everything uses mock data.
              {liveConfigured && wanted === 'CONTRIBUTOR' && ' Contributor sign-in is not available on the live backend yet.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {mockUsers.map((u) => (
              <Button key={u.user_id} size="sm" variant="outline" onClick={() => signIn(u.user_id)}>{u.label}</Button>
            ))}
            {liveConfigured && wanted === 'ADMIN' && (
              <button type="button" onClick={() => setDemo(false)} className="w-full text-left text-xs text-muted-foreground underline-offset-2 hover:underline">
                Back to mentor token sign-in
              </button>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  )
}
