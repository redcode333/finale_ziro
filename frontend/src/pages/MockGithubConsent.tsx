import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Development-only stand-in for GitHub's consent screen, used while the mock backend is on.
// In production the backend returns GitHub's real authorize URL and this route is not registered.
export default function MockGithubConsent() {
  const [params] = useSearchParams()
  const scope = params.get('scope') === 'project' ? 'project' : 'me'
  const rawBack = params.get('return_to') ?? '/'
  const back = rawBack.startsWith('/') && !rawBack.startsWith('//') ? rawBack : '/'
  const [busy, setBusy] = useState(false)

  const finish = async (outcome: 'authorize' | 'cancel') => {
    setBusy(true)
    let user: string | null = null
    try { user = localStorage.getItem('fairsprint.mockUser') } catch { /* storage unavailable */ }
    await fetch('/__mock/github/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(user ? { 'X-Mock-User': user } : {}) },
      body: JSON.stringify({ scope, outcome }),
    })
    const sep = back.includes('?') ? '&' : '?'
    window.location.assign(`${back}${sep}github=${outcome === 'authorize' ? 'connected' : 'cancelled'}`)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
      <p role="note" className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
        Mock GitHub authorization. Development only; nothing is sent to GitHub.
      </p>
      <Card>
        <CardHeader><CardTitle>Authorize FairSprint AI</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {scope === 'project' ? 'Allow read-only access to the project repository.' : 'Allow read-only access to link your account.'}
          </p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => finish('authorize')}>{busy ? 'Working…' : 'Authorize'}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => finish('cancel')}>Cancel</Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
