/**
 * FILE: packages/schema/src/common.ts
 * НАЗНАЧЕНИЕ: общие куски контракта, одинаковые у всех файлов data_dir.
 * ВХОД: сырые строки и числа из yaml/json.
 * ВЫХОД: проверенные schema_version, время и короткие id.
 * Почему так: CONTRACT требует schema_version и ISO с зоной. Свой regex, а не z.iso,
 * чтобы не зависеть от того, как конкретная версия zod трактует смещение.
 */

import { z } from 'zod'

/** Версия контракта. Пока одна, смена формата — это новая цифра, не тихая правка. */
export const SCHEMA_VERSION = 1

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

export const schemaVersionSchema = z.literal(SCHEMA_VERSION)

/** Время с Z или ±HH:MM. Без зоны файл не принимаем: локальное «голое» время потом нельзя сравнить. */
export const isoSchema = z.string().regex(ISO_WITH_ZONE, 'ISO-время с зоной')

/** Срок задачи: календарный день или тот же ISO. */
export const dueSchema = z.string().refine(
  (value) => DATE_ONLY.test(value) || ISO_WITH_ZONE.test(value),
  'дата YYYY-MM-DD или ISO с зоной',
)

/** Id файла и ссылки. Строчные, чтобы имя файла не зависело от регистра. */
export const idSchema = z.string().regex(SLUG, 'id: строчные буквы, цифры и дефис')

export const versionFields = {
  schema_version: schemaVersionSchema,
  updated_at: isoSchema,
}

/** Путь внутри конфига: относительный, без выхода наверх и без диска. Чужие абсолютные пути здесь не живут. */
export function isContainedPath(value: string): boolean {
  if (value.length === 0 || value.includes('..') || value.includes('\\')) {
    return false
  }
  if (value.startsWith('/') || value.startsWith('~')) {
    return false
  }
  return !/^[A-Za-z]:/.test(value)
}

export const containedPathSchema = z.string().refine(isContainedPath, 'только относительный путь')

/** Имена устройств Windows. С расширением (CON.txt) это всё ещё устройство. */
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/

/**
 * data_dir — каталог записок, не служебный файл репозитория и не устройство Windows.
 * Сегмент `.git` или `package.json` (в любом регистре) отклоняем: иначе мастер
 * положит данные поверх репозитория. CON, NUL, PRN, AUX, COM1–9, LPT1–9 — тоже,
 * включая `CON.txt` и хвостовые точки.
 */
export function isSafeDataDir(value: string): boolean {
  if (!isContainedPath(value)) {
    return false
  }
  const segments = value.split('/').filter((part) => part.length > 0 && part !== '.')
  for (const segment of segments) {
    const cleaned = segment.replace(/[. ]+$/u, '')
    if (cleaned.length === 0) {
      return false
    }
    const lower = cleaned.toLowerCase()
    if (lower === '.git' || lower === 'package.json') {
      return false
    }
    const dot = lower.indexOf('.')
    const stem = dot === -1 ? lower : lower.slice(0, dot)
    if (stem.length > 0 && RESERVED_DEVICE.test(stem)) {
      return false
    }
  }
  return true
}
