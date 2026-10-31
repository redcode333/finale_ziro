import dataset from '../../../data/synthetic_dataset/dataset.json'
import type { Blocker, GithubConnection, Invitation, Standup } from '@/types'
import { PROJECT_ID, TEAM_ID } from './store'

const rows = dataset.tables.standups as unknown as Record<string, string>[]

export const standups: Standup[] = rows.map((s) => ({
  standup_id: s.standup_id, team_id: s.team_id, member_id: s.member_id, date: s.date,
  yesterday: s.yesterday, today: s.today, blockers: s.blockers,
  claimed_task_ids: (s.claimed_task_ids ?? '').split(';').filter(Boolean),
  submitted_at: s.submitted_at, source_label: 'synthetic' as const,
}))

// Seed open blockers from standups that name one, so the page has real fixture data.
export const blockers: Blocker[] = standups
  .filter((s) => s.blockers && s.blockers.toLowerCase() !== 'none')
  .map((s, i) => ({
    blocker_id: `B${String(i + 1).padStart(3, '0')}`, team_id: TEAM_ID, member_id: s.member_id,
    task_id: s.claimed_task_ids[0] ?? null, description: s.blockers, status: 'open' as const,
    created_at: s.submitted_at, resolved_at: null,
  }))

// Idempotency-Key -> stored response, so a replayed submit never creates a duplicate.
const seen = new Map<string, unknown>()
export function once<T>(key: string | null, create: () => T): T {
  if (key && seen.has(key)) return seen.get(key) as T
  const v = create()
  if (key) seen.set(key, v)
  return v
}

export const invitations: Invitation[] = [
  { invitation_id: 'INV001', project_id: PROJECT_ID, email: 'priya@example.test', role: 'CONTRIBUTOR', status: 'pending',
    invited_by: 'MENTOR001', created_at: '2026-10-29T09:00:00Z', expires_at: '2026-11-05T09:00:00Z' },
]

// GitHub link state: one project-level link (admin) and one per member. Tokens never exist in the browser.
// Persisted to localStorage because the OAuth redirect is a full page load, which resets the in-memory mock.
const KEY = 'mock.githubLinks'
const load = (): Map<string, GithubConnection> => {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(KEY) ?? '{}'))) } catch { return new Map() }
}
const links = load()
export const githubLinks = {
  get: (k: string) => links.get(k),
  set: (k: string, v: GithubConnection) => { links.set(k, v); save() },
  delete: (k: string) => { links.delete(k); save() },
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(links))) } catch { /* storage unavailable */ }
}
export const emptyGithub = (scope: GithubConnection['scope']): GithubConnection => ({
  scope, status: 'disconnected', account_login: null, repository_url: null, connected_at: null, last_synced_at: null, error: null,
})
