import { GitBranch } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useGithub, useGithubConnect } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GithubScope } from '@/types'

// Top-bar entry point. Disconnected: one click starts the connection. Connected: a status chip linking to settings.
export default function GithubHeaderButton({ scope, settingsPath }: { scope: GithubScope; settingsPath: string }) {
  const { data } = useGithub(scope)
  const connect = useGithubConnect(scope)
  if (!data) return null

  if (data.status === 'connected') {
    return (
      <Link to={settingsPath} title="GitHub connected. Open settings."
        className={cn('inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-xs transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none')}>
        <span aria-hidden className="size-1.5 rounded-full bg-success" />
        <GitBranch className="size-3.5" aria-hidden />
        <span className="max-w-32 truncate font-mono">{data.account_login}</span>
      </Link>
    )
  }
  return (
    <Button size="sm" variant="outline" disabled={connect.isPending} onClick={() => connect.mutate()}>
      <GitBranch aria-hidden /> {connect.isPending ? 'Redirecting…' : data.status === 'error' ? 'Reconnect GitHub' : 'Connect GitHub'}
    </Button>
  )
}
