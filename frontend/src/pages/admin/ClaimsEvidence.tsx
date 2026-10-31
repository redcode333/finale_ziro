import MockOnlyNote from '@/components/common/MockOnlyNote'
import { ArrowRight, ExternalLink, Info } from 'lucide-react'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useClaims, useMembers } from '@/api/hooks'
import { useAuth } from '@/auth/AuthContext'
import { ToneBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { evidenceMeta, fmtTime } from '@/lib/status'
import { cn } from '@/lib/utils'
import { nameOf } from '@/lib/workload'
import type { Claim, EvidenceStatus } from '@/types'

const ORDER: EvidenceStatus[] = ['unverified', 'insufficient_evidence', 'partially_verified', 'verified']
const needsClarification = (c: Claim) => c.verification !== 'verified'

function ClaimCard({ claim, memberName, ownerName }: { claim: Claim; memberName: string; ownerName: string }) {
  const meta = evidenceMeta[claim.verification]
  return (
    <article aria-label={`Claim on ${claim.task_id}`} className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{claim.task_title} <span className="font-mono text-xs text-muted-foreground">{claim.task_id}</span></p>
          <p className="text-xs text-muted-foreground">
            {claim.standup_id} · {fmtTime(claim.claimed_at)} · {claim.kind === 'completed' ? 'Claims completion' : 'Reports work on this task'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {needsClarification(claim) && <ToneBadge tone="warning">Needs clarification</ToneBadge>}
          <ToneBadge tone={meta.tone}>{meta.label}</ToneBadge>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
        <section aria-label="What was reported" className="space-y-1 rounded-lg border border-border p-3">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Reported by {memberName}</h3>
          <p>“{claim.claim_text}”</p>
          <p className="text-xs text-muted-foreground">Task status now: <span className="font-mono">{claim.task_status.replace('_', ' ')}</span> · owner {ownerName}</p>
        </section>
        <ArrowRight className="hidden size-4 self-center text-muted-foreground md:block" aria-hidden />
        <section aria-label="Matched evidence" className="space-y-1.5 rounded-lg border border-border p-3">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Matched evidence ({claim.matched_evidence.length})</h3>
          {claim.matched_evidence.length === 0 ? (
            <p className="text-muted-foreground">No linked records found.</p>
          ) : (
            <ul className="space-y-1">
              {claim.matched_evidence.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="font-mono text-xs">{e.id}</span> <span className="text-xs text-muted-foreground">{e.source_type.replace('_', ' ')} · {fmtTime(e.observed_at)}</span>
                    <span className="block truncate">{e.title}</span>
                  </span>
                  {e.source_url && (
                    <a href={e.source_url} target="_blank" rel="noopener noreferrer" aria-label={`Open source for ${e.id}`} className="mt-0.5 shrink-0 text-primary">
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="space-y-1">
        <p>{claim.explanation}</p>
        {claim.gaps.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground" aria-label="Gaps">
            {claim.gaps.map((g) => <li key={g}>{g}</li>)}
          </ul>
        )}
      </div>
    </article>
  )
}

export default function ClaimsEvidence() {
  const { me } = useAuth()
  const teamId = me?.memberships.find((m) => m.role === 'ADMIN')?.team_id ?? ''
  const { data: claims, isPending } = useClaims(teamId)
  const { data: members } = useMembers(teamId)
  const [params, setParams] = useSearchParams()

  const byMember = useMemo(() => {
    const map = new Map<string, Claim[]>()
    for (const c of claims ?? []) map.set(c.member_id, [...(map.get(c.member_id) ?? []), c])
    return map
  }, [claims])

  // Members with something to clarify come first so the review starts where it matters.
  const roster = useMemo(() => [...byMember.entries()]
    .map(([id, list]) => ({ id, list, open: list.filter(needsClarification).length }))
    .sort((a, b) => b.open - a.open || (members ? nameOf(members, a.id).localeCompare(nameOf(members, b.id)) : 0)), [byMember, members])

  const selected = params.get('member') ?? roster[0]?.id
  const list = (selected ? byMember.get(selected) : undefined) ?? []
  const sorted = [...list].sort((a, b) => ORDER.indexOf(a.verification) - ORDER.indexOf(b.verification))
  const counts = ORDER.map((s) => [s, list.filter((c) => c.verification === s).length] as const).filter(([, n]) => n > 0)

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Claims vs evidence</h1>
        <p className="text-sm text-muted-foreground">Each standup claim is matched to commits, reviews, comments and worklogs by fixed rules, not by guesswork.</p>
      </div>

      <MockOnlyNote what="Claims vs evidence" />
      <p role="note" className="flex gap-2 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          “Needs clarification” means the available records do not yet support the claim. It is a question for the member, not a finding of inactivity or misconduct.
          Work in design, testing, research and meetings may not appear in GitHub.
        </span>
      </p>

      {isPending ? <Skeleton className="h-48" /> : roster.length === 0 ? (
        <p className="text-sm text-muted-foreground">No standup claims to review yet.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <nav aria-label="Members" className="space-y-1">
            {roster.map(({ id, list: l, open }) => (
              <button key={id} type="button" aria-current={id === selected ? 'true' : undefined}
                onClick={() => setParams({ member: id }, { replace: true })}
                className={cn('flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  id === selected && 'border-primary bg-primary/10')}>
                <span>{nameOf(members, id)}<span className="block text-xs text-muted-foreground">{l.length} claims</span></span>
                {open > 0 ? <ToneBadge tone="warning">{open} to clarify</ToneBadge> : <ToneBadge tone="success">Supported</ToneBadge>}
              </button>
            ))}
          </nav>

          <div className="space-y-3">
            <Card>
              <CardHeader><CardTitle>{nameOf(members, selected)}</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {counts.map(([s, n]) => <ToneBadge key={s} tone={evidenceMeta[s].tone}>{n} {evidenceMeta[s].label.toLowerCase()}</ToneBadge>)}
              </CardContent>
            </Card>
            {sorted.map((c) => (
              <ClaimCard key={c.claim_id} claim={c} memberName={nameOf(members, c.member_id)} ownerName={nameOf(members, c.task_owner_id)} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
