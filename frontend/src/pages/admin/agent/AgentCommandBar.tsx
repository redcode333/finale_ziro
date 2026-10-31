import { Play } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function AgentCommandBar({ busy, onSubmit }: { busy: boolean; onSubmit: (command?: string) => void }) {
  const [text, setText] = useState('')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    onSubmit(text.trim() || undefined)
    setText('')
  }
  return (
    <form onSubmit={submit} className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
      <label htmlFor="agent-command" className="sr-only">Ask the agent</label>
      <Input id="agent-command" value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Ask the agent to analyze or investigate, e.g. “Why is T008 at risk?”" disabled={busy} />
      <Button type="submit" disabled={busy}><Play aria-hidden /> {busy ? 'Starting…' : 'Analyze Sprint'}</Button>
    </form>
  )
}
