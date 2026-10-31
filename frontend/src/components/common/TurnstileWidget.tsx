import { useEffect, useReducer, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { initialTurnstile, turnstileReducer } from '@/lib/turnstile'

// Cloudflare's official client: api.js with explicit rendering. https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<TurnstileApi> | null = null
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_URL
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not initialise')))
    s.onerror = () => { s.remove(); reject(new Error('Could not load the verification script')) }
    document.head.appendChild(s)
  }).catch((e) => { scriptPromise = null; throw e }) // allow Retry to attempt the download again
  return scriptPromise
}

interface Props {
  siteKey: string
  action: string
  // Receives the current token, or null whenever it is unavailable (loading, expired, error, reset).
  onToken: (token: string | null) => void
  // Increase this number to force a fresh challenge (e.g. after a failed sign-in: a token is single-use).
  resetSignal?: number
}

export default function TurnstileWidget({ siteKey, action, onToken, resetSignal = 0 }: Props) {
  const [state, dispatch] = useReducer(turnstileReducer, initialTurnstile)
  const host = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const api = useRef<TurnstileApi | null>(null)
  const [loadAttempt, retryLoad] = useReducer((n: number) => n + 1, 0)

  useEffect(() => { onToken(state.token) }, [state.token, onToken])

  useEffect(() => {
    let cancelled = false
    loadTurnstile().then((t) => {
      if (cancelled || !host.current) return
      api.current = t
      widgetId.current = t.render(host.current, {
        sitekey: siteKey, action, theme: 'auto', 'refresh-expired': 'manual',
        callback: (token: string) => dispatch({ type: 'token', token }),
        'expired-callback': () => dispatch({ type: 'expired' }),
        'timeout-callback': () => dispatch({ type: 'timeout' }),
        'error-callback': () => dispatch({ type: 'error' }),
      })
    }).catch((e: Error) => { if (!cancelled) dispatch({ type: 'error', message: e.message }) })
    return () => {
      cancelled = true
      if (widgetId.current && api.current) api.current.remove(widgetId.current)
      widgetId.current = null
    }
  }, [siteKey, action, loadAttempt])

  // Re-challenge whenever the reducer asks (expiry, retry) or the parent bumps resetSignal.
  const firstReset = useRef(true)
  useEffect(() => {
    if (firstReset.current) { firstReset.current = false; return }
    if (widgetId.current && api.current) api.current.reset(widgetId.current)
  }, [state.resets])
  const firstSignal = useRef(true)
  useEffect(() => {
    if (firstSignal.current) { firstSignal.current = false; return }
    dispatch({ type: 'reset' })
  }, [resetSignal])

  const retry = () => {
    if (widgetId.current) dispatch({ type: 'reset' })
    else { dispatch({ type: 'reset' }); retryLoad() } // the script never loaded: start over
  }

  return (
    <div className="space-y-2" aria-live="polite">
      <div ref={host} data-testid="turnstile-widget" />
      {state.status === 'loading' && !state.token && <p className="text-xs text-muted-foreground">Loading human verification…</p>}
      {(state.status === 'error' || state.status === 'expired') && state.message && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-critical">
          {state.message}
          {state.status === 'error' && <Button type="button" size="sm" variant="outline" onClick={retry}>Try again</Button>}
        </p>
      )}
    </div>
  )
}
