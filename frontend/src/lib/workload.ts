import type { Member, Task } from '@/types'

export interface Workload { active: number; blocked: number; openHours: number; capacity: number; remaining: number }

// Capacity here is the member's weekly hours against open (not done) estimates: a rough planning signal, not a score.
export function workloadOf(member: Member | undefined, tasks: Task[]): Workload {
  const mine = tasks.filter((t) => t.assignee_id === member?.member_id && t.status !== 'done')
  const openHours = mine.reduce((s, t) => s + t.estimate_hours, 0)
  const capacity = member?.weekly_capacity_hours ?? 0
  return {
    active: mine.length,
    blocked: mine.filter((t) => t.status === 'blocked').length,
    openHours,
    capacity,
    remaining: capacity - openHours,
  }
}

export const nameOf = (members: Member[] | undefined, id: string | null | undefined) =>
  members?.find((m) => m.member_id === id)?.name ?? id ?? '—'
