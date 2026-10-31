import StandupParticipation from './StandupParticipation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboard } from '@/api/hooks'
import { useAuth } from '@/auth/AuthContext'

// Placeholder that proves the pipeline end to end: auth -> API client -> MSW -> dataset.
export default function Overview() {
  const { me } = useAuth()
  const teamId = me?.memberships[0]?.team_id ?? ''
  const { data, isPending, isError } = useDashboard(teamId)

  if (isError) return <p role="alert" className="text-critical">Could not load the dashboard.</p>

  const kpis = data && [
    ['Tasks analyzed', data.kpis.tasks_analyzed],
    ['Evidence collected', data.kpis.evidence_collected],
    ['Risks detected', data.kpis.risks_detected],
    ['Actions pending', data.kpis.actions_pending],
    ['Evidence coverage', `${Math.round(data.kpis.evidence_coverage * 100)}%`],
  ] as const

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Overview</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {isPending
          ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)
          : kpis?.map(([label, value]) => (
              <Card key={label}>
                <CardHeader><CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle></CardHeader>
                <CardContent className="font-mono text-2xl">{value}</CardContent>
              </Card>
            ))}
      </div>
      <StandupParticipation teamId={teamId} />
    </section>
  )
}
