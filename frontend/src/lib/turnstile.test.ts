import { describe, expect, it } from 'vitest'
import { buildMentorLoginRequest, initialTurnstile, turnstileReducer, type TurnstileEvent } from './turnstile'

const run = (...events: TurnstileEvent[]) => events.reduce(turnstileReducer, initialTurnstile)

describe('turnstile widget state', () => {
  it('starts loading with no token', () => {
    expect(initialTurnstile).toMatchObject({ status: 'loading', token: null, resets: 0 })
  })

  it('holds the token once the challenge succeeds', () => {
    expect(run({ type: 'token', token: 'abc' })).toMatchObject({ status: 'ready', token: 'abc', message: null })
  })

  it('drops an expired token and requests a fresh challenge', () => {
    const s = run({ type: 'token', token: 'abc' }, { type: 'expired' })
    expect(s).toMatchObject({ status: 'expired', token: null, resets: 1 })
    expect(s.message).toMatch(/expired/i)
  })

  it('surfaces errors and timeouts without keeping a token, and lets the user retry', () => {
    const failed = run({ type: 'token', token: 'abc' }, { type: 'error' })
    expect(failed).toMatchObject({ status: 'error', token: null })
    expect(failed.message).toBeTruthy()
    expect(run({ type: 'timeout' }).message).toMatch(/timed out/i)
    const retried = turnstileReducer(failed, { type: 'reset' })
    expect(retried).toMatchObject({ status: 'loading', token: null, message: null, resets: failed.resets + 1 })
  })

  it('resets after a failed submission so a spent token is never resent', () => {
    const afterFailure = run({ type: 'token', token: 'spent' }, { type: 'reset' })
    expect(afterFailure.token).toBeNull()
    expect(afterFailure.resets).toBe(1)
  })

  it('counts every re-challenge so the component knows when to call turnstile.reset()', () => {
    expect(run({ type: 'reset' }, { type: 'expired' }, { type: 'reset' }).resets).toBe(3)
  })
})

describe('mentor login request', () => {
  it('sends the Turnstile token in the body and the mentor token only as a bearer header', () => {
    const req = buildMentorLoginRequest('  fsm_secret  ', 'cf-token')
    expect(req.method).toBe('POST')
    expect((req.headers as Record<string, string>).Authorization).toBe('Bearer fsm_secret')
    expect(JSON.parse(req.body as string)).toEqual({ turnstile_token: 'cf-token' })
    expect(req.body as string).not.toContain('fsm_secret')
  })

  it('sends an empty body when no widget is configured', () => {
    expect(JSON.parse(buildMentorLoginRequest('fsm_x', null).body as string)).toEqual({})
  })
})
