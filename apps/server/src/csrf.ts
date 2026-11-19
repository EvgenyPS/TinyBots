/**
 * FILE: apps/server/src/csrf.ts
 * НАЗНАЧЕНИЕ: токен первого записывающего маршрута.
 * ВХОД: случайные байты на процесс и заголовок X-CSRF-Token.
 * ВЫХОД: совпали ли они. Чужую длину не сравниваем побайтно: timingSafeEqual так нельзя.
 * Страница читает токен с GET /api/setup. CORS не открыт, с другого сайта его не прочитать.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'

export function newCsrfToken(): string {
  return randomBytes(32).toString('hex')
}

export function tokensMatch(expected: string, got: string | undefined): boolean {
  if (got === undefined || got.length === 0 || expected.length === 0) {
    return false
  }
  const left = Buffer.from(expected)
  const right = Buffer.from(got)
  if (left.length !== right.length) {
    return false
  }
  return timingSafeEqual(left, right)
}
