/**
 * FILE: apps/web/src/components/ui/label.tsx
 * НАЗНАЧЕНИЕ: подпись поля. Radix Label, чтобы клик вёл на связанный контрол.
 */

import * as LabelPrimitive from '@radix-ui/react-label'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('flex items-center gap-1.5 text-[13px] font-semibold', className)} {...props} />
}
