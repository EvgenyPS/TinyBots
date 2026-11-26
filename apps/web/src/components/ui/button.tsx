/**
 * FILE: apps/web/src/components/ui/button.tsx
 * НАЗНАЧЕНИЕ: кнопка shadcn (new-york) для мастера.
 * Варианты: заливка primary, контур, ghost, иконка.
 */

import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold cursor-pointer disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-[var(--wz-shadow)]',
        outline: 'border border-input bg-card text-foreground shadow-[var(--wz-shadow)]',
        ghost: 'bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'h-auto bg-transparent p-0 text-primary',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-2.5 text-[13px]',
        icon: 'size-9 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export function Button({
  className,
  variant,
  size,
  asChild = false,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size }), className)} type={asChild ? undefined : type} {...props} />
}
