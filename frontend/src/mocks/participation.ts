import dataset from '../../../data/synthetic_dataset/dataset.json'
import type { ParticipationMember, StandupStatus } from '@/types'
import { standups } from './contributor'
import { evidence, members, notifications } from './store'

// Stand-in for the backend. A standup is the only thing that counts as "submitted";
// other recorded activity is shown as context so a missed standup is never read as inactivity.
const seed = (dataset.tables.standups as unknown as { date: string }[]).map((s) => s.date).sort()
export const SEED_LATEST = seed.at(-1)!
const MIN = seed[0]
const MAX = new Date().toISOString().slice(0, 10)
const SILENT_AFTER_DAYS = 2

const dayBefore = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() - 864e5).toISOString().slice(0, 10)
const hasStandup = (id: string, d: string) => standups.some((s) => s.member_id === id && s.date === d)
const activityOn = (id: string, d: string) => evidence.filter((e) => e.member_id === id && e.source_type !== 'standup' && e.observed_at.slice(0, 10) === d)

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
  const out: ParticipationMember[] = members.map((m) => {
    const sub = standups.find((s) => s.member_id === m.member_id && s.date === date)
    const other = activityOn(m.member_id, date).map((e) => ({ id: e.id, source_type: e.source_type, title: e.title }))
    const lastEv = evidence.filter((e) => e.member_id === m.member_id && e.source_type !== 'standup' && e.observed_at.slice(0, 10) <= date)
      .map((e) => e.observed_at).sort().at(-1) ?? null

    let missed = 0
    let activityInStreak = other.length > 0
    if (!sub) {
      for (let d = date; d >= MIN && !hasStandup(m.member_id, d) && missed < 14; d = dayBefore(d)) {
        missed++
        if (activityOn(m.member_id, d).length > 0) activityInStreak = true
      }
    }
    let state: ParticipationMember['state'] = 'submitted'
    if (!sub) {
      if (m.availability_status !== 'available') state = 'unavailable'
      else if (missed >= SILENT_AFTER_DAYS && !activityInStreak) state = 'silent'
      else state = 'missing'
    }
    return {
      member_id: m.member_id, state, submitted_at: sub?.submitted_at ?? null, missed_days: missed,
      other_activity: other, last_activity_at: lastEv, reminder_sent: reminders.has(`${m.member_id}|${date}`),
    }
  })
  return { date, min_date: MIN, max_date: MAX, expected: members.length, submitted: out.filter((x) => x.state === 'submitted').length, members: out }
}
