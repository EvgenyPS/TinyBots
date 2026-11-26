/**
 * FILE: apps/web/src/components/ui/checkbox.tsx
 * НАЗНАЧЕНИЕ: флажок shadcn на нативном input. Участники чата и замена конфига.
 */

import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Checkbox({
  className,
  label,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return (
    <label className={cn('flex items-center gap-2 text-sm', className)}>
      <input type="checkbox" className="size-4 accent-[var(--primary)]" {...props} />
      <span>{label}</span>
    </label>
  )
}
