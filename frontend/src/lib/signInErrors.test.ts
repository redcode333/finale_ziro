import { describe, expect, it } from 'vitest'
import { ApiError, readJson } from '@/api/errors'
import { adminSignInMode, contributorSignInAvailable, signInErrorMessage } from './signInErrors'

describe('signInErrorMessage', () => {
  it('explains a missing Turnstile site key instead of the generic backend text', () => {
    const err = new ApiError(400, { code: 'turnstile_required', message: 'Complete the human verification and try again.' })
    expect(signInErrorMessage(err, { turnstileSiteKey: '' })).toMatch(/VITE_TURNSTILE_SITE_KEY/)
  })

  it('keeps the backend message when the widget exists (the user can act on it)', () => {
    const err = new ApiError(400, { code: 'turnstile_required', message: 'Complete the human verification and try again.' })
    expect(signInErrorMessage(err, { turnstileSiteKey: '0x4AAAA' })).toBe('Complete the human verification and try again.')
  })

  it('passes other backend errors through, and describes network failures', () => {
    expect(signInErrorMessage(new ApiError(401, { code: 'unauthorized', message: 'Invalid mentor token.' }), { turnstileSiteKey: '' })).toBe('Invalid mentor token.')
    expect(signInErrorMessage(new TypeError('Failed to fetch'), { turnstileSiteKey: '' })).toMatch(/Could not reach the server/)
  })
})

describe('adminSignInMode', () => {
  it('uses the live backend whenever its address is baked in, unless demo was asked for and the mock layer is on', () => {
    expect(adminSignInMode({ liveConfigured: true, mocksOn: false, wantsDemo: false })).toBe('live')
    expect(adminSignInMode({ liveConfigured: true, mocksOn: true, wantsDemo: false })).toBe('live')
    expect(adminSignInMode({ liveConfigured: true, mocksOn: true, wantsDemo: true })).toBe('demo')
  })

  it('offers demo only when the mock layer is on', () => {
    expect(adminSignInMode({ liveConfigured: false, mocksOn: true, wantsDemo: true })).toBe('demo')
    // Demo requested but mocks are off: the live form stays, because demo identities could never log in.
    expect(adminSignInMode({ liveConfigured: true, mocksOn: false, wantsDemo: true })).toBe('live')
  })

  it('reports an unusable build instead of showing a form that cannot work', () => {
    expect(adminSignInMode({ liveConfigured: false, mocksOn: false, wantsDemo: true })).toBe('unavailable')
    expect(adminSignInMode({ liveConfigured: false, mocksOn: false, wantsDemo: false })).toBe('unavailable')
  })

  it('contributors exist only in demo mode', () => {
    expect(contributorSignInAvailable(true)).toBe(true)
    expect(contributorSignInAvailable(false)).toBe(false)
  })
})

describe('readJson', () => {
  it('turns the single-page host answering with HTML into a clear error', async () => {
    const html = new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    await expect(readJson(html)).rejects.toMatchObject({ code: 'invalid_response', status: 502, retryable: false })
  })

  it('parses a JSON answer', async () => {
    const ok = new Response(JSON.stringify({ a: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })
    await expect(readJson(ok)).resolves.toEqual({ a: 1 })
  })
})
