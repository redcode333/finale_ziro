import { useTasks, useUpdateTask } from '@/api/hooks'
import { useMyContext } from '@/auth/useMyContext'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TASK_STATUSES, TaskStatusBadge } from './TaskStatusBadge'

export default function MyTasks() {
  const { teamId } = useMyContext()
  const { data: tasks, isPending } = useTasks(teamId)
  const update = useUpdateTask()

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">My tasks</h1>
        <p className="text-sm text-muted-foreground">Update the status of your own tasks. A task marked done is still checked against available evidence.</p>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {isPending ? <Skeleton className="m-4 h-24" /> : (tasks ?? []).length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No tasks assigned to you.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>{['Task', 'Priority', 'Due', 'Dependencies', 'Status'].map((h) => <th key={h} scope="col" className="px-4 py-2 font-normal">{h}</th>)}</tr>
              </thead>
              <tbody>
                {tasks!.map((t) => (
                  <tr key={t.task_id} className="border-t border-border">
                    <td className="px-4 py-2"><span className="font-mono text-xs text-muted-foreground">{t.task_id}</span> {t.title}</td>
                    <td className="px-4 py-2">{t.priority}</td>
                    <td className="px-4 py-2 font-mono text-xs">{t.due_date}</td>
                    <td className="px-4 py-2 font-mono text-xs">{t.dependency_task_ids.join(', ') || '—'}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <TaskStatusBadge status={t.status} />
                        <label className="sr-only" htmlFor={`st-${t.task_id}`}>Status for {t.title}</label>
                        <select id={`st-${t.task_id}`} value={t.status} disabled={update.isPending}
                          onChange={(e) => update.mutate({ id: t.task_id, status: e.target.value })}
                          className="h-7 rounded-md border border-input bg-card px-1 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                          {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
