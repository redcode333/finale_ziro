import GithubConnectCard from '@/components/common/GithubConnectCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function Integrations() {
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">Data sources the agent can read. Credentials stay on the server and are never shown in the browser.</p>
      </div>
      <GithubConnectCard scope="project" />
      <Card>
        <CardHeader><CardTitle>Other sources</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Task and worklog data come from the project database. Optional automation (standup reminders, report delivery) is not configured.
        </CardContent>
      </Card>
    </section>
  )
}
