import { UserMinus } from 'lucide-react'
import { useState } from 'react'
import { useMembers, useRequestReplan, useTasks } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import type { ReplanResult } from '@/types'

interface Props { teamId: string; sprintId: string; defaultMemberId?: string; triggerLabel?: string }

export default function RequestReplanDialog({ teamId, sprintId, defaultMemberId, triggerLabel = 'Request re-plan' }: Props) {
  const { data: members } = useMembers(teamId)
  const { data: tasks } = useTasks(teamId)
  const replan = useRequestReplan()
  const [open, setOpen] = useState(false)
  const [memberId, setMemberId] = useState(defaultMemberId ?? '')
  const [reason, setReason] = useState('')
  const [result, setResult] = useState<ReplanResult | null>(null)

  const available = (members ?? []).filter((m) => m.availability_status === 'available')
  const chosen = members?.find((m) => m.member_id === memberId)
  const openTasks = (tasks ?? []).filter((t) => t.sprint_id === sprintId && t.assignee_id === memberId && t.status !== 'done')

  const onOpenChange = (o: boolean) => {
    setOpen(o)
    if (o) { setMemberId(defaultMemberId ?? ''); setReason(''); setResult(null) }
  }
  const submit = () => replan.mutate({ sprintId, member_id: memberId, reason: reason.trim() || undefined }, { onSuccess: setResult })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}><UserMinus aria-hidden /> {triggerLabel}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a sprint re-plan</DialogTitle>
          <DialogDescription>Mark a member unavailable and get capacity- and dependency-checked proposals for their open tasks.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-2 text-sm" role="status">
            <p>{result.proposals.length ? `${result.proposals.length} proposal${result.proposals.length > 1 ? 's' : ''} created and waiting for your review.` : 'No new proposals were created.'}</p>
            {result.unassigned_task_ids.length > 0 && (
              <p className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-warning">
                No teammate has enough free capacity for {result.unassigned_task_ids.join(', ')}. Those tasks stay with their current owner until you decide.
              </p>
            )}
            <DialogFooter><Button onClick={() => setOpen(false)}>Done</Button></DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <label htmlFor="replan-member">Member who is unavailable</label>
              <select id="replan-member" value={memberId} onChange={(e) => setMemberId(e.target.value)} disabled={replan.isPending}
                className="block h-8 w-full rounded-lg border border-input bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <option value="">Choose a member</option>
                {available.map((m) => <option key={m.member_id} value={m.member_id}>{m.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="replan-reason">Reason (optional)</label>
              <Textarea id="replan-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={replan.isPending} placeholder="e.g. Out for three working days" />
            </div>
            {chosen && (
              <p className="rounded-lg border border-border p-2 text-muted-foreground">
                This marks {chosen.name} unavailable and creates proposals for {openTasks.length} open task{openTasks.length === 1 ? '' : 's'}
                {openTasks.length > 0 && ` (${openTasks.map((t) => t.task_id).join(', ')})`}. Nothing is reassigned until you approve each one.
              </p>
            )}
            <DialogFooter>
              <Button variant="ghost" disabled={replan.isPending} onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!memberId || replan.isPending} onClick={submit}>{replan.isPending ? 'Planning…' : 'Mark unavailable and plan'}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
