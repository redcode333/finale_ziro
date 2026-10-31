import MockOnlyNote from '@/components/common/MockOnlyNote'
import { GitBranch } from 'lucide-react'
import { useGithub, useGithubConnect, useGithubDisconnect } from '@/api/hooks'
import { ToneBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtTime } from '@/lib/status'
import type { GithubScope } from '@/types'

const COPY: Record<GithubScope, { title: string; blurb: string; access: string[] }> = {
  project: {
    title: 'GitHub repository',
    blurb: 'Connect the project repository so the agent can compare standup claims with commits, pull requests, reviews and issues.',
    access: ['Read-only access to commit, pull request, review and issue metadata', 'No permission to push, merge or change code', 'You can disconnect at any time'],
  },
  me: {
    title: 'Your GitHub account',
    blurb: 'Link your GitHub account so your commits, reviews and pull requests are matched to your tasks. Work outside GitHub still counts.',
    access: ['Used only to match your activity to your own tasks', 'Read-only; nothing is posted or changed on your account', 'Not connecting is never treated as inactivity'],
  },
}

export default function GithubConnectCard({ scope }: { scope: GithubScope }) {
  const { data, isPending, isError } = useGithub(scope)
  const connect = useGithubConnect(scope)
  const disconnect = useGithubDisconnect(scope)
  const copy = COPY[scope]

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2"><GitBranch className="size-4" aria-hidden /> {copy.title}</CardTitle>
        {data && <ToneBadge tone={data.status === 'connected' ? 'success' : data.status === 'error' ? 'critical' : 'neutral'}>{data.status}</ToneBadge>}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isPending ? <Skeleton className="h-16" /> : isError ? (
          <p role="alert" className="text-critical">Could not load the GitHub connection status.</p>
        ) : (
          <>
            <MockOnlyNote what="The GitHub connection" />
            <p className="text-muted-foreground">{copy.blurb}</p>
            {data.status === 'connected' && (
              <dl className="grid grid-cols-[120px_1fr] gap-1 text-xs">
                <dt className="text-muted-foreground">Account</dt><dd className="font-mono">{data.account_login}</dd>
                {data.repository_url && (<><dt className="text-muted-foreground">Repository</dt><dd className="font-mono break-all">{data.repository_url}</dd></>)}
                <dt className="text-muted-foreground">Connected</dt><dd>{data.connected_at ? fmtTime(data.connected_at) : '—'}</dd>
                <dt className="text-muted-foreground">Last sync</dt><dd>{data.last_synced_at ? fmtTime(data.last_synced_at) : 'Not synced yet'}</dd>
              </dl>
            )}
            {data.status === 'error' && <p role="alert" className="text-critical">{data.error ?? 'The connection needs to be re-authorized.'}</p>}
            {data.status !== 'connected' && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{copy.access.map((a) => <li key={a}>{a}</li>)}</ul>
            )}
            <div className="flex gap-2">
              {data.status === 'connected' ? (
                <Button variant="outline" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
                  {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              ) : (
                <Button disabled={connect.isPending} onClick={() => connect.mutate()}>
                  <GitBranch aria-hidden /> {connect.isPending ? 'Redirecting…' : data.status === 'error' ? 'Reconnect GitHub' : 'Connect GitHub'}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
