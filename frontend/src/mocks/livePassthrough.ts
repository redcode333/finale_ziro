import { http, passthrough } from 'msw'

// When one service serves both the app and the API, the live backend shares the app's origin, so the relative mock
// handlers would also match live calls. Live calls always carry a mentor bearer token (the mock layer only sends
// X-Mock-User), so those go to the network untouched and everything else keeps falling through to the mock handlers.
export const livePassthrough = http.all('*', ({ request }) => (request.headers.has('authorization') ? passthrough() : undefined))
