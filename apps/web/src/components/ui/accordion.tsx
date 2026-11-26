/**
 * FILE: apps/web/src/components/ui/accordion.tsx
 * НАЗНАЧЕНИЕ: блок «Дополнительно».
 * Корень — details, не Radix: e2e читает HTMLDetailsElement.open и жмёт Enter на summary.
 * Раскрытие по ошибке валидации — тот же атрибут open, что в 0.3.1.
 */

import { ChevronDown } from 'lucide-react'
import type { DetailsHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Accordion({ className, ...props }: DetailsHTMLAttributes<HTMLDetailsElement>) {
  return <details className={cn('wz-acc', className)} {...props} />
}

export function AccordionTrigger({ className, children, ...props }: HTMLAttributes<HTMLElement> & { children?: ReactNode }) {
  return (
    <summary className={cn('wz-acc-t', className)} {...props}>
      <span>{children}</span>
      <ChevronDown className="wz-chev" width={16} height={16} aria-hidden />
    </summary>
  )
}

export function AccordionContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('wz-acc-c', className)} {...props} />
}
