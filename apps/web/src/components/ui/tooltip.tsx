/**
 * FILE: apps/web/src/components/ui/tooltip.tsx
 * НАЗНАЧЕНИЕ: подсказка shadcn на Radix. Портал кладём внутрь мастера, чтобы токены доехали.
 */

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={300}>{children}</TooltipPrimitive.Provider>
}

export function Tooltip({ children, ...props }: ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root {...props}>{children}</TooltipPrimitive.Root>
}

export function TooltipTrigger({ ...props }: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger {...props} />
}

export function TooltipContent({
  className,
  sideOffset = 6,
  container,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content> & { container?: HTMLElement | null }) {
  return (
    <TooltipPrimitive.Portal container={container ?? undefined}>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn('z-50 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background', className)}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}
