/**
 * FILE: apps/web/src/components/ui/tabs.tsx
 * НАЗНАЧЕНИЕ: вкладки ботов. Radix Tabs, триггер держит аватар 22px и имя.
 */

import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn(className)} {...props} />
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('inline-flex gap-0.5 rounded-lg bg-muted p-[3px]', className)} {...props} />
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-[calc(var(--radius)-3px)] border border-transparent px-3 pr-3 pl-1.5 text-[13px] font-semibold text-muted-foreground data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-[var(--wz-shadow)]',
        className,
      )}
      {...props}
    />
  )
}
