/**
 * FILE: apps/web/src/components/ui/progress.tsx
 * НАЗНАЧЕНИЕ: полоска шага. В shadcn своего степпера нет, прогресс — эта полоска.
 */

export function Progress({ value }: { value: number }) {
  const width = Math.max(0, Math.min(100, value))
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(width)}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
    </div>
  )
}
