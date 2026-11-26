/**
 * FILE: apps/web/src/components/ui/input.tsx
 * НАЗНАЧЕНИЕ: поле ввода shadcn. Фокус — кольцо ring на 25%, как в SPEC.
 */

import type { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-[var(--wz-shadow)] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25',
        className,
      )}
      {...props}
    />
  )
}
