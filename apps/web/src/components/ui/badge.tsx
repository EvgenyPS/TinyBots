/**
 * FILE: apps/web/src/components/ui/badge.tsx
 * НАЗНАЧЕНИЕ: бейдж shadcn. outline — рамка файла конфига, soft — «реком.» и «авто».
 */

import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Badge({
  className,
  variant = 'outline',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: 'outline' | 'soft' | 'mono' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 text-xs font-semibold',
        variant === 'outline' && 'h-[22px] border-border bg-card text-muted-foreground',
        variant === 'soft' && 'h-5 border-transparent bg-accent text-[11px] text-accent-foreground',
        variant === 'mono' && 'h-[22px] border-border bg-card font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}
