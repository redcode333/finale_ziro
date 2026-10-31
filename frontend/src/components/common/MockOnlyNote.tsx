import { Info } from 'lucide-react'
import { isLiveSession } from '@/api/live'

// Shown only in a live-backend session, on features the backend does not provide yet (they still run on demo data).
export default function MockOnlyNote({ what }: { what: string }) {
  if (!isLiveSession()) return null
  return (
    <p role="note" className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{what} is not connected to the live backend yet. It shows demo data.</span>
    </p>
  )
}
