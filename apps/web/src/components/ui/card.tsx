/**
 * FILE: apps/web/src/components/ui/card.tsx
 * НАЗНАЧЕНИЕ: карточка шага. Шапка, тело и футер — слоты shadcn Card.
 */

import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('flex min-h-0 min-w-0 flex-col', className)} {...props} />
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-7 pt-6 pb-1', className)} {...props} />
}

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(function CardTitle({ className, ...props }, ref) {
  return <h2 ref={ref} className={cn('text-xl font-bold tracking-tight', className)} {...props} />
})

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1 text-sm text-muted-foreground', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-1 flex-col gap-3.5 overflow-auto px-7 py-4', className)} {...props} />
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between gap-3 border-t border-border px-7 py-3.5', className)} {...props} />
}
