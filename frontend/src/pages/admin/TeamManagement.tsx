import MockOnlyNote from '@/components/common/MockOnlyNote'
import { useState } from 'react'
import { useInvitations, useInvite, useMembers, useRevokeInvitation, useSprints, useTasks } from '@/api/hooks'
import { useAuth } from '@/auth/AuthContext'
import CapacityBar from '@/components/common/CapacityBar'
import { ToneBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtTime } from '@/lib/status'
import { workloadOf } from '@/lib/workload'
import type { Invitation } from '@/types'
import RequestReplanDialog from './replan/RequestReplanDialog'

const INV_TONE = { pending: 'warning', accepted: 'success', revoked: 'neutral', expired: 'neutral' } as const

export default function TeamManagement() {
  const { me } = useAuth()
  const membership = me?.memberships.find((m) => m.role === 'ADMIN')
  const teamId = membership?.team_id ?? ''
  const projectId = membership?.project_id ?? ''
  const { data: members, isPending } = useMembers(teamId)
  const { data: tasks } = useTasks(teamId)
  const { data: sprints } = useSprints(teamId)
  const activeSprint = sprints?.find((x) => x.status === 'active')?.sprint_id ?? sprints?.[0]?.sprint_id ?? ''
  const { data: invitations } = useInvitations(projectId)
  const invite = useInvite(projectId)
  const revoke = useRevokeInvitation()
  const [email, setEmail] = useState('')

  const onInvite = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || invite.isPending) return
    invite.mutate(email, { onSuccess: () => setEmail('') })
  }
  const expired = (i: Invitation) => i.status === 'pending' && new Date(i.expires_at).getTime() < Date.now()

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">Members, capacity and invitations. Capacity compares open estimates with weekly hours; it is a planning signal, not a performance rating.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Members</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {isPending ? <Skeleton className="m-4 h-32" /> : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>{['Member', 'Role and skills', 'Availability', 'Active / blocked', 'Capacity (open vs weekly)', ''].map((h) => <th key={h} scope="col" className="px-4 py-2 font-normal">{h}</th>)}</tr>
              </thead>
              <tbody>
                {members!.map((m) => {
                  const w = workloadOf(m, tasks ?? [])
                  const available = m.availability_status === 'available'
                  return (
                    <tr key={m.member_id} className="border-t border-border align-top">
                      <td className="px-4 py-2">{m.name}<span className="block font-mono text-xs text-muted-foreground">{m.member_id} · {m.github_username}</span></td>
                      <td className="px-4 py-2">{m.role}<span className="block text-xs text-muted-foreground">{m.skills.join(', ')}</span></td>
                      <td className="px-4 py-2"><ToneBadge tone={available ? 'success' : 'warning'}>{m.availability_status.replaceAll('_', ' ')}</ToneBadge></td>
                      <td className="px-4 py-2 font-mono">{w.active} / {w.blocked}</td>
                      <td className="min-w-40 px-4 py-2"><CapacityBar used={w.openHours} capacity={w.capacity} label={`Capacity for ${m.name}`} /></td>
                      <td className="px-4 py-2 text-right">
                        {available && activeSprint && <RequestReplanDialog teamId={teamId} sprintId={activeSprint} defaultMemberId={m.member_id} triggerLabel="Mark unavailable" />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Invite a contributor</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <MockOnlyNote what="Invitations" />
          <form onSubmit={onInvite} className="flex flex-wrap items-end gap-2">
            <div className="min-w-60 flex-1 space-y-1">
              <label htmlFor="invite-email" className="text-sm">Email address</label>
              <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={invite.isPending} placeholder="name@example.com" />
            </div>
            <Button type="submit" disabled={!email.trim() || invite.isPending}>{invite.isPending ? 'Sending…' : 'Send invitation'}</Button>
          </form>
          <p className="text-xs text-muted-foreground">Invitations create a Contributor membership for this project only. They expire after 7 days, can be revoked, and work once.</p>

          <ul className="space-y-2">
            {(invitations ?? []).length === 0 && <li className="text-sm text-muted-foreground">No invitations yet.</li>}
            {(invitations ?? []).map((i) => (
              <li key={i.invitation_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm">
                <span>
                  {i.email}
                  <span className="block text-xs text-muted-foreground">{i.invitation_id} · sent {fmtTime(i.created_at)} · expires {fmtTime(i.expires_at)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <ToneBadge tone={expired(i) ? 'neutral' : INV_TONE[i.status]}>{expired(i) ? 'expired' : i.status}</ToneBadge>
                  {i.status === 'pending' && !expired(i) && (
                    <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(i.invitation_id)}>Revoke</Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}
