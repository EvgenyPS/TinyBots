/**
 * FILE: apps/web/src/components/ui/select.tsx
 * НАЗНАЧЕНИЕ: выпадающий список мастера.
 * Это нативный select, а не меню Radix: e2e вызывает selectOption и читает option.
 * Внешний вид — как триггер shadcn (высота 36, рамка input, шеврон).
 */

import type { SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'wz-select flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-[var(--wz-shadow)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25',
        className,
      )}
      {...props}
    />
  )
}

/** Разделитель групп. В списке моделей не используется: лишний option сломал бы текст пунктов в e2e. */
export function SelectSeparator() {
  return <hr className="my-1 border-border" />
}
