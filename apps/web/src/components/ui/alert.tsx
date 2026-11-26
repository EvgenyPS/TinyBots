/**
 * FILE: apps/web/src/components/ui/alert.tsx
 * НАЗНАЧЕНИЕ: плашка shadcn. warning — цвета из SPEC, обычная — акцент.
 */

import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Alert({
  className,
  variant = 'default',
  icon,
  title,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'warning'; icon?: ReactNode; title?: string }) {
  return (
    <div
      className={cn(
        'flex gap-3 rounded-lg border px-4 py-3',
        variant === 'warning' ? 'border-[var(--warn-bd)] bg-[var(--warn-bg)] text-[var(--warn-fg)]' : 'border-border bg-accent/60',
        className,
      )}
      {...props}
    >
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="min-w-0">
        {title ? <b className="block text-[13.5px] font-semibold">{title}</b> : null}
        <div className={cn('text-[13px]', variant === 'default' && 'text-muted-foreground', title && 'mt-0.5')}>{children}</div>
      </div>
    </div>
  )
}
