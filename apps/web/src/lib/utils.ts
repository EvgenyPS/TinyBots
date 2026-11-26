/**
 * FILE: apps/web/src/lib/utils.ts
 * НАЗНАЧЕНИЕ: склейка классов Tailwind без драки одинаковых утилит.
 * ВХОД: строки, массивы и условные классы.
 * ВЫХОД: одна строка className. Нужна компонентам shadcn.
 */

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
