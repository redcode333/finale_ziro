import type { ApiErrorBody } from '@/types'

export class ApiError extends Error {
  status: number
  code: string
  retryable: boolean
  constructor(status: number, body?: Partial<ApiErrorBody['error']>) {
    super(body?.message ?? `Request failed (${status})`)
    this.status = status
    this.code = body?.code ?? 'unknown'
    this.retryable = body?.retryable ?? status >= 500
  }
}

/**
 * A single-page host answers unknown URLs with its HTML page and a 200, so a missing or wrong API address looks like a
 * success until the body fails to parse. Check the content type first and say what is actually wrong.
 */
export async function readJson<T>(res: Response): Promise<T> {
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('json')) {
    throw new ApiError(502, {
      code: 'invalid_response',
      message: 'The server answered with a web page instead of data. Sign-in is not set up correctly for this site (wrong API address, or demo mode is off).',
      retryable: false,
    })
  }
  return (await res.json()) as T
}
