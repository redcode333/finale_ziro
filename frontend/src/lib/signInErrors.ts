import { ApiError } from '@/api/errors'

const TURNSTILE_MISSING_KEY =
  'This site requires human verification, but it was built without the Turnstile site key (VITE_TURNSTILE_SITE_KEY). Ask the site owner to set it and redeploy.'

/** What to tell the user when a mentor sign-in attempt fails. */
export function signInErrorMessage(err: unknown, opts: { turnstileSiteKey: string }): string {
  if (err instanceof ApiError) {
    // The backend demands verification but the page has no widget to provide it: a deployment mistake, not a user mistake.
    if (err.code === 'turnstile_required' && !opts.turnstileSiteKey) return TURNSTILE_MISSING_KEY
    return err.message
  }
  return 'Could not reach the server. Check your connection and try again.'
}

export type AdminSignInMode = 'live' | 'demo' | 'unavailable'

/**
 * Which admin sign-in a build can actually offer.
 * live: a mentor token against the real backend (needs the API address baked in).
 * demo: mock identities (needs the mock layer, otherwise their calls hit the real server and fail).
 * unavailable: the build has neither, so show how to fix it instead of a form that cannot work.
 */
export function adminSignInMode(o: { liveConfigured: boolean; mocksOn: boolean; wantsDemo: boolean }): AdminSignInMode {
  if (o.liveConfigured && !(o.wantsDemo && o.mocksOn)) return 'live'
  if (o.mocksOn) return 'demo'
  return 'unavailable'
}

/** Contributors have no login on the live backend, so they exist only in demo mode. */
export const contributorSignInAvailable = (mocksOn: boolean) => mocksOn
