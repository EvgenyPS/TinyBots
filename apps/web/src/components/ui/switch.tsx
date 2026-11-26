/**
 * FILE: apps/web/src/components/ui/switch.tsx
 * НАЗНАЧЕНИЕ: переключатель. Под капотом checkbox: e2e вызывает .check() на bot-api.
 * Дорожка 32×18 и бегунок — как в макете.
 */

import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Switch({
  className,
  label,
  hint,
  compact = false,
  flat = false,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; hint?: ReactNode; compact?: boolean; flat?: boolean }) {
  return (
    <label className={cn(
      'flex gap-3 text-left',
      flat ? 'items-center border-0 py-3' : 'rounded-lg border border-border',
      !flat && (compact ? 'items-center bg-muted/50 px-3.5 py-2.5' : 'items-start p-3.5'),
      className,
    )}>
      <input type="checkbox" className="wz-switch" {...props} />
      <span className="min-w-0">
        <b className="block text-sm font-semibold">{label}</b>
        {hint ? <span className="mt-0.5 block text-[13px] font-normal text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  )
}
