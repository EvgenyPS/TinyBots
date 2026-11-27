/**
 * FILE: apps/server/src/session.ts
 * НАЗНАЧЕНИЕ: токен сессии десктопа и выбор режима запуска.
 * ВХОД: argv процесса. Окружение не включает режим без токена: sidecar его наследует.
 * ВЫХОД: план «браузер» или «десктоп», и проверка токена за постоянное время.
 * Токен — 32 байта CSPRNG, в hex. На диск этот модуль ничего не пишет.
 */

import { timingSafeEqual } from 'node:crypto'

/** Заголовок, который окно Tauri добавляет к /api. Имя не секрет, значение — секрет. */
export const SESSION_HEADER = 'x-tinybots-session'

/** Явный флаг браузерного режима. Переменная окружения с тем же смыслом не читается. */
export const BROWSER_FLAG = '--browser'

/** Sidecar читает токен одной строкой из stdin, не из argv и не из окружения. */
export const SESSION_STDIN_FLAG = '--session-stdin'

export const SESSION_TOKEN_BYTES = 32

const TOKEN_PATTERN = /^[0-9a-f]{64}$/

export type LaunchPlan =
  | { kind: 'browser' }
  | { kind: 'desktop' }
  | { kind: 'refuse'; message: string }

/**
 * sea=true — собранный sidecar. Без токена он не стартует, флаг браузера тоже не помогает.
 * env принимается, чтобы тест показал: содержимое окружения на план не влияет.
 */
export function planLaunch(argv: readonly string[], sea: boolean, _env?: NodeJS.ProcessEnv): LaunchPlan {
  void _env
  const browser = argv.includes(BROWSER_FLAG)
  const desktop = argv.includes(SESSION_STDIN_FLAG)
  if (browser && desktop) {
    return { kind: 'refuse', message: 'Флаги --browser и --session-stdin вместе не используются' }
  }
  if (sea) {
    if (!desktop) {
      return { kind: 'refuse', message: 'Собранный sidecar не стартует без токена сессии' }
    }
    return { kind: 'desktop' }
  }
  if (browser) {
    return { kind: 'browser' }
  }
  if (desktop) {
    return { kind: 'desktop' }
  }
  return { kind: 'refuse', message: 'Нужен флаг --browser или --session-stdin' }
}

/** Hex ровно 32 байт. Другая длина и чужой алфавит — не токен. */
export function acceptSessionToken(value: string): boolean {
  return TOKEN_PATTERN.test(value)
}

/**
 * Сравнение за постоянное время. Разная длина не отдаётся в timingSafeEqual:
 * та функция в этом случае бросает исключение.
 */
export function sessionTokensMatch(expected: string, got: string | undefined): boolean {
  if (got === undefined || !acceptSessionToken(expected) || expected.length !== got.length) {
    return false
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(got))
}

/** Первая строка stdin. Пустой результат — токен не принят, саму строку наружу не кладём. */
export function takeTokenLine(buffer: string): { done: false } | { done: true; ok: boolean } {
  if (buffer.length > 80 && !buffer.includes('\n')) {
    return { done: true, ok: false }
  }
  const nl = buffer.indexOf('\n')
  if (nl === -1) {
    return { done: false }
  }
  const line = buffer.slice(0, nl).replace(/\r$/, '')
  return { done: true, ok: acceptSessionToken(line) ? true : false }
}

/** Токен из уже отделённой строки. Наружу строка не возвращается, если она не токен. */
export function tokenFromLine(line: string): string | null {
  const trimmed = line.replace(/\r$/, '')
  if (!acceptSessionToken(trimmed)) {
    return null
  }
  return trimmed
}
