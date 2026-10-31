import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'

// The backend's analyze request takes a team and a sprint, not a prompt, so there is no text box here:
// typed text would be discarded. Pressing the button reviews every claim in the selected sprint.
export default function AgentCommandBar({ busy, onSubmit }: { busy: boolean; onSubmit: () => void }) {
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!busy) onSubmit()
  }
  return (
    <form onSubmit={submit} className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
      <p id="agent-command-help" className="flex-1 text-sm text-muted-foreground">
        Analyze Sprint checks every standup claim in this sprint against the evidence. Results appear in the timeline, trace and recommendations above. Typed questions are not supported yet.
      </p>
      <Button type="submit" disabled={busy} aria-describedby="agent-command-help"><Play aria-hidden /> {busy ? 'Starting…' : 'Analyze Sprint'}</Button>
    </form>
  )
}
