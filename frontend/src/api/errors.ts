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
