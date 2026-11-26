/**
 * FILE: apps/web/src/components/ui/popover.tsx
 * НАЗНАЧЕНИЕ: всплывашка shadcn на Radix. Контейнер передаёт мастер, чтобы токены light/dark не потерялись за порталом в body.
 */

import * as PopoverPrimitive from '@radix-ui/react-popover'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Popover({ children, ...props }: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props}>{children}</PopoverPrimitive.Root>
}

export function PopoverTrigger({ ...props }: ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger {...props} />
}

export function PopoverContent({
  className,
  container,
  align = 'start',
  sideOffset = 8,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content> & { container?: HTMLElement | null }) {
  return (
    <PopoverPrimitive.Portal container={container ?? undefined}>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn('z-50 rounded-lg border border-border bg-popover text-popover-foreground shadow-[0_12px_32px_-8px_rgba(20,10,60,0.25)] outline-none', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export function PopoverClose({ children, ...props }: ComponentProps<typeof PopoverPrimitive.Close> & { children?: ReactNode }) {
  return <PopoverPrimitive.Close {...props}>{children}</PopoverPrimitive.Close>
}
