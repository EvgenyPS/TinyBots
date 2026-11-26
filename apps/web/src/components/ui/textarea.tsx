/**
 * FILE: apps/web/src/components/ui/textarea.tsx
 * НАЗНАЧЕНИЕ: многострочное поле shadcn для инструкций и правил чата.
 */

import type { TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'flex min-h-16 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-[var(--wz-shadow)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25',
        className,
      )}
      {...props}
    />
  )
}
