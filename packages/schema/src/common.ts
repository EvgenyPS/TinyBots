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

/**
 * Папка проекта в мастере. Может лежать где угодно, в том числе вне папки лаунчера.
 * data_dir сюда не относится: у него своё правило isSafeDataDir.
 * Управляющие символы отвергаем, иначе путь нельзя ни показать, ни открыть.
 */
/** U+0000…U+001F. Регулярку не берём: линтер режет управляющие символы в литерале. */
function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x1f) {
      return true
    }
  }
  return false
}

/**
 * UNC и device-путь Windows. До диска и git такое не доходит:
 * \\server\share и //server открывают сеть, \\?\ и \\.\ — устройство.
 * Слэши сначала приводим к одному виду: \/evil и /\evil — тот же UNC.
 * Обычный /var или C:/work сюда не попадает: у них один слеш в начале.
 */
function isUncOrDevicePath(value: string): boolean {
  const slashes = value.replace(/\\/g, '/')
  return slashes.startsWith('//')
}

/**
 * Имена устройств Windows. С расширением (CON.txt) и с пробелом перед точкой это всё ещё устройство.
 * COM0/LPT0, CONIN$/CONOUT$/CLOCK$ и надстрочные COM¹–COM³, LPT¹–LPT³ — тоже.
 * Одна копия: песочница инструментов берёт isReservedDeviceName, а не свой список.
 */
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|com[\u00b9\u00b2\u00b3]|lpt[\u00b9\u00b2\u00b3]|conin\$|conout\$|clock\$)$/

/**
 * NTFS срезает хвостовые точки и пробелы и ведущие пробелы.
 * Сравнение с запретным именем делаем уже по срезанному сегменту.
 */
function stripSegmentEdges(segment: string): string {
  return segment.replace(/[. ]+$/u, '').replace(/^ +/u, '')
}

export function isReservedDeviceName(segment: string): boolean {
  const lower = stripSegmentEdges(segment).toLowerCase()
  const dot = lower.indexOf('.')
  // «CON .txt»: пробел перед точкой не спасает, Windows всё равно видит CON.
  const stem = (dot === -1 ? lower : lower.slice(0, dot)).replace(/ /g, '')
  return stem.length > 0 && RESERVED_DEVICE.test(stem)
}

export function isProjectFolderPath(value: string): boolean {
  if (value.length === 0 || value.length > 300) {
    return false
  }
  if (hasControlChar(value) || isUncOrDevicePath(value)) {
    return false
  }
  return true
}

/**
 * Файл запроса в режиме files. Относительный путь внутри папки проекта.
 * Сегмент .git (в любом регистре), в том числе .git/hooks, не переносим:
 * иначе мерж записал бы хуки репозитория.
 * backups/ и staging/ — служебные каталоги снимка, их запрос не затирает.
 * «.», пустой сегмент, NUL и имена устройств Windows тоже отказ.
 * Хвостовые точки и пробелы сегмента отвергаем, а не срезаем молча:
 * на NTFS `backups.` и `.git ` совпали бы со служебными именами.
 * Двоеточие — поток NTFS (`note.txt:stream`), такой путь не переносим.
 */
export function isMergeFilePath(value: string): boolean {
  if (value.includes(':') || hasControlChar(value) || !isContainedPath(value)) {
    return false
  }
  const segments = value.split('/')
  if (segments.some((part) => part.length === 0 || part === '.')) {
    return false
  }
  for (const segment of segments) {
    const cleaned = stripSegmentEdges(segment)
    if (cleaned.length === 0 || cleaned !== segment) {
      return false
    }
    const lower = cleaned.toLowerCase()
    if (lower === '.git' || lower === 'backups' || lower === 'staging') {
      return false
    }
    if (isReservedDeviceName(segment)) {
      return false
    }
  }
  return true
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

/**
 * data_dir — каталог записок, не служебный файл репозитория и не устройство Windows.
 * Сегмент `.git`, `package.json`, `node_modules`, `.github` или `scripts`
 * (в любом регистре) отклоняем: иначе мастер положит данные поверх репозитория.
 * CON, NUL, PRN, AUX, COM1–9, LPT1–9 — тоже, включая `CON.txt`.
 * Перед проверкой срезаем хвостовые точки и пробелы и ведущие пробелы,
 * иначе `node_modules.` или ` scripts ` проскочили бы мимо списка.
 * Управляющие символы (\u0000–\u001f) отвергаем целиком, до разбора сегментов.
 */
const BLOCKED_DATA_DIR = new Set(['.git', 'package.json', 'node_modules', '.github', 'scripts'])

export function isSafeDataDir(value: string): boolean {
  if (hasControlChar(value)) {
    return false
  }
  if (!isContainedPath(value)) {
    return false
  }
  const segments = value.split('/').filter((part) => part.length > 0 && part !== '.')
  for (const segment of segments) {
    const cleaned = stripSegmentEdges(segment)
    if (cleaned.length === 0) {
      return false
    }
    const lower = cleaned.toLowerCase()
    if (BLOCKED_DATA_DIR.has(lower)) {
      return false
    }
    if (isReservedDeviceName(cleaned)) {
      return false
    }
  }
  return true
}
