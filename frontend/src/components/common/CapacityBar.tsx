import { cn } from '@/lib/utils'

// Planning signal only: open estimated hours against weekly capacity. Not a performance measure.
export default function CapacityBar({ used, capacity, label }: { used: number; capacity: number; label: string }) {
  const pct = capacity > 0 ? Math.min(100, Math.round((used / capacity) * 100)) : 0
  const over = used > capacity
  return (
    <div className="space-y-1">
      <div
        role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={used}
        aria-valuetext={`${used} of ${capacity} hours${over ? ', over capacity' : ''}`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className={cn('h-full rounded-full transition-all duration-200', over ? 'bg-warning' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
      <p className={cn('font-mono text-xs', over ? 'text-warning' : 'text-muted-foreground')}>
        {used}h / {capacity}h{over ? ' · over capacity' : ''}
      </p>
    </div>
  )
}
