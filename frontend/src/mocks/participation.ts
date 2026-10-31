import dataset from '../../../data/synthetic_dataset/dataset.json'
import { computeStandupStatus } from '@/lib/participation'
import type { StandupStatus } from '@/types'
import { standups } from './contributor'
import { evidence, members, notifications } from './store'

// Stand-in for the backend. A standup is the only thing that counts as "submitted";
// other recorded activity is shown as context so a missed standup is never read as inactivity.
const seed = (dataset.tables.standups as unknown as { date: string }[]).map((s) => s.date).sort()
export const SEED_LATEST = seed.at(-1)!
const MIN = seed[0]
const MAX = new Date().toISOString().slice(0, 10)


// Dedupe key: one reminder per member per day (idempotent).
const reminders = new Set(
  notifications.filter((n) => n.type === 'standup_reminder').map((n) => n.member_id + '|' + n.created_at.slice(0, 10)),
)
export function remind(memberId: string, date: string) {
  const key = `${memberId}|${date}`
  if (reminders.has(key)) return { created: false }
  reminders.add(key)
  notifications.push({
    notification_id: `N${String(notifications.length + 1).padStart(3, '0')}`, member_id: memberId, type: 'standup_reminder',
    status: 'queued', message: `Please submit your standup for ${date}.`, created_at: `${date}T09:00:00Z`,
  } as (typeof notifications)[number])
  return { created: true }
}

export function standupStatus(date = SEED_LATEST): StandupStatus {
  return computeStandupStatus({
    standups, members, evidence, date, minDate: MIN, maxDate: MAX,
    reminded: (memberId, day) => reminders.has(`${memberId}|${day}`),
  })
}
