/**
 * FILE: apps/web/src/components/ui/radio-group.tsx
 * НАЗНАЧЕНИЕ: группа радиокарточек. Сам input остаётся нативным, чтобы .check() в e2e попадал в него.
 */

import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function RadioGroup({ className, label, children }: { className?: string; label: string; children: ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('wz-radios grid grid-cols-3 gap-2.5', className)}>
      {children}
    </div>
  )
}

export function RadioCard({
  className,
  title,
  hint,
  checked,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { title: string; hint: string }) {
  return (
    <label className={cn('flex gap-2.5 rounded-lg border p-3', checked ? 'border-primary bg-accent/60 shadow-[0_0_0_1px_var(--primary)]' : 'border-border', className)}>
      <input type="radio" className="wz-radio" checked={checked} {...props} />
      <span>
        <b className="block text-sm font-semibold">{title}</b>
        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{hint}</span>
      </span>
    </label>
  )
}
