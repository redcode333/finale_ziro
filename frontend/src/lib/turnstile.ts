// Pure logic behind the Turnstile widget and the sign-in request, kept free of React and the DOM so it can be unit-tested.
// The widget's success is only a token to forward: the backend verifies it with Cloudflare, which is the only proof.

export type TurnstileStatus = 'loading' | 'ready' | 'expired' | 'error'

export interface TurnstileState {
  status: TurnstileStatus
  token: string | null
  message: string | null
  // Bumped whenever the widget must be re-challenged; the component calls turnstile.reset() when it changes.
  resets: number
}

export type TurnstileEvent =
  | { type: 'token'; token: string }
  | { type: 'expired' }
  | { type: 'timeout' }
  | { type: 'error'; message?: string }
  | { type: 'reset' }

export const initialTurnstile: TurnstileState = { status: 'loading', token: null, message: null, resets: 0 }

export function turnstileReducer(state: TurnstileState, event: TurnstileEvent): TurnstileState {
  switch (event.type) {
    case 'token':
      return { ...state, status: 'ready', token: event.token, message: null }
    case 'expired':
      // A token is single-use and short-lived: drop it and ask for a fresh challenge.
      return { status: 'expired', token: null, message: 'Verification expired. Refreshing…', resets: state.resets + 1 }
    case 'timeout':
      return { status: 'error', token: null, message: 'Verification timed out. Try again.', resets: state.resets }
    case 'error':
      return { status: 'error', token: null, message: event.message ?? 'Verification could not be completed. Try again.', resets: state.resets }
    case 'reset':
      return { status: 'loading', token: null, message: null, resets: state.resets + 1 }
  }
}

// The mentor token travels only in the Authorization header; the Turnstile token goes in the JSON body.
export function buildMentorLoginRequest(mentorToken: string, turnstileToken: string | null): RequestInit {
  return {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${mentorToken.trim()}` },
    body: JSON.stringify(turnstileToken ? { turnstile_token: turnstileToken } : {}),
  }
}

