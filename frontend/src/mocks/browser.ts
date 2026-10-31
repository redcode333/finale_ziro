import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'
import { livePassthrough } from './livePassthrough'

export const worker = setupWorker(livePassthrough, ...handlers)
