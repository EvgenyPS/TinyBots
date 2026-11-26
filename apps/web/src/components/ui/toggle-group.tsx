/**
 * FILE: apps/web/src/components/ui/toggle-group.tsx
 * НАЗНАЧЕНИЕ: сегменты «Git-ветка / Снимок». Радио внутри сегмента, testid на input.
 */

import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function ToggleGroup({ className, children, ...props }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('inline-flex overflow-hidden rounded-md border border-input', className)} {...props}>
      {children}
    </div>
  )
}

export function ToggleItem({
  className,
  children,
  checked,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { children: ReactNode }) {
  return (
    <label className={cn('relative inline-flex h-[34px] items-center gap-1.5 px-3 text-[13px] font-semibold', checked ? 'bg-accent text-accent-foreground' : 'bg-card text-muted-foreground', className)}>
      <input type="radio" className="size-3.5 accent-[var(--primary)]" checked={checked} {...props} />
      {children}
    </label>
  )
}
