import type { EvidenceRecord, Member, ParticipationMember, StandupStatus } from '@/types'

// Standup participation, computed from stored records. Used by the mock backend and, until the real backend serves
// /teams/{id}/standup-status itself, by the live adapter. A standup is the only thing that counts as "submitted";
// other recorded activity is context, so a missed standup is never read as inactivity.
export const SILENT_AFTER_DAYS = 2
const MAX_STREAK = 14

export interface ParticipationInput {
  standups: { member_id: string; date: string; submitted_at: string | null }[]
  members: Pick<Member, 'member_id' | 'availability_status'>[]
  evidence: Pick<EvidenceRecord, 'id' | 'member_id' | 'source_type' | 'title' | 'observed_at'>[]
  date: string
  minDate: string
  maxDate: string
  reminded: (memberId: string, date: string) => boolean
}

const dayBefore = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() - 864e5).toISOString().slice(0, 10)

export function computeStandupStatus(i: ParticipationInput): StandupStatus {
  const hasStandup = (id: string, d: string) => i.standups.some((s) => s.member_id === id && s.date === d)
  const activity = (id: string) => i.evidence.filter((e) => e.member_id === id && e.source_type !== 'standup')
  const activityOn = (id: string, d: string) => activity(id).filter((e) => e.observed_at.slice(0, 10) === d)

  const members: ParticipationMember[] = i.members.map((m) => {
    const sub = i.standups.find((s) => s.member_id === m.member_id && s.date === i.date)
    const other = activityOn(m.member_id, i.date).map((e) => ({ id: e.id, source_type: e.source_type, title: e.title }))
    const last = activity(m.member_id).filter((e) => e.observed_at.slice(0, 10) <= i.date).map((e) => e.observed_at).sort().at(-1) ?? null

    // Count consecutive days without a standup, ending on the chosen day, and note any activity in that stretch.
    let missed = 0
    let activityInStreak = other.length > 0
    if (!sub) {
      for (let d = i.date; d >= i.minDate && !hasStandup(m.member_id, d) && missed < MAX_STREAK; d = dayBefore(d)) {
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
      other_activity: other, last_activity_at: last, reminder_sent: i.reminded(m.member_id, i.date),
    }
  })

  return {
    date: i.date, min_date: i.minDate, max_date: i.maxDate, expected: i.members.length,
    submitted: members.filter((x) => x.state === 'submitted').length, members,
  }
}
