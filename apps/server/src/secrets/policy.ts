/**
 * FILE: apps/server/src/secrets/policy.ts
 * НАЗНАЧЕНИЕ: куда закрытый ключ имеет право попасть и куда ходить.
 * ВХОД: URL, заголовки, тело и карточка ключа.
 * ВЫХОД: отказ до сети либо один проход подстановки.
 * В URL, путь и query ссылка не подставляется. В заголовок — только в тот, что задан у ключа.
 * В тело — только если у ключа включён флаг. Повторный проход по значению не делается.
 */

import { addressKind } from '@tinybots/schema'
import type { SecretFile } from './meta.js'

const PLACE = /\{\{secret:([A-Z][A-Z0-9_]{0,63})\}\}/g

export type HeaderSpec = { name: string; prefix: string | null }

export function parseHeader(spec: string): HeaderSpec | null {
  const match = /^([A-Za-z][A-Za-z0-9-]{0,63})(?:: ([A-Za-z0-9._~+/-]{1,64}))?$/.exec(spec)
  if (!match?.[1]) {
    return null
  }
  return { name: match[1], prefix: match[2] ?? null }
}

export function placeholderNames(text: string): string[] {
  return [...text.matchAll(PLACE)].map((item) => item[1] ?? '').filter((item) => item.length > 0)
}

export function hasPlaceholder(text: string): boolean {
  PLACE.lastIndex = 0
  if (PLACE.test(text)) {
    return true
  }
  let decoded = text
  try {
    decoded = decodeURIComponent(text)
  } catch {
    return true
  }
  return /\{\{secret:[A-Z][A-Z0-9_]{0,63}\}\}/.test(decoded)
}

/** Ровно ожидаемый заголовок: префикс из карточки и одна ссылка, без хвоста. */
export function headerValueOk(spec: HeaderSpec, secretName: string, value: string): boolean {
  const token = `{{secret:${secretName}}}`
  const expected = spec.prefix === null ? token : `${spec.prefix} ${token}`
  return value === expected
}

export type Placement =
  | { ok: true; names: string[] }
  | { ok: false; reason: string }

/**
 * Где стоят ссылки. Неизвестное имя сюда не входит: его проверяет вызывающий по карточке.
 * Лишний заголовок отвергается, чтобы значение нельзя было унести в Host или Cookie.
 */
export function checkPlacement(input: {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  secrets: readonly SecretFile[]
}): Placement {
  if (hasPlaceholder(input.url)) {
    return { ok: false, reason: 'секрет в url' }
  }
  const byName = new Map(input.secrets.map((item) => [item.name, item]))
  const used = new Set<string>()
  const headerNames = Object.keys(input.headers)
  if (headerNames.length > 1) {
    return { ok: false, reason: 'лишний заголовок' }
  }
  for (const [header, value] of Object.entries(input.headers)) {
    const names = placeholderNames(value)
    if (names.length !== 1) {
      return { ok: false, reason: 'секрет в заголовке' }
    }
    const name = names[0] ?? ''
    const secret = byName.get(name)
    const spec = secret ? parseHeader(secret.header) : null
    if (!secret || !spec || spec.name.toLowerCase() !== header.toLowerCase() || !headerValueOk(spec, name, value)) {
      return { ok: false, reason: 'секрет в заголовке' }
    }
    used.add(name)
  }
  const body = input.body ?? ''
  const bodyNames = placeholderNames(body)
  for (const name of bodyNames) {
    const secret = byName.get(name)
    if (!secret || !secret.body) {
      return { ok: false, reason: 'секрет в теле' }
    }
    used.add(name)
  }
  if (hasPlaceholder(body) && bodyNames.length === 0) {
    return { ok: false, reason: 'секрет в теле' }
  }
  if (used.size === 0) {
    return { ok: false, reason: 'нет ссылки на ключ' }
  }
  return { ok: true, names: [...used] }
}

/** Один проход. Значение, внутри которого снова ссылка, второй раз не раскрывается. */
export function substituteOnce(text: string, values: ReadonlyMap<string, string>): string {
  return text.replace(/\{\{secret:([A-Z][A-Z0-9_]{0,63})\}\}/g, (whole, name: string) => {
    const value = values.get(name)
    return value === undefined ? whole : value
  })
}

export type UrlGate =
  | { ok: true; hostname: string; path: string }
  | { ok: false; reason: string }

/** https, порт 443, без userinfo. Хост сравнивается уже в punycode, звёздочки нет. */
export function gateUrl(raw: string, method: string, secrets: readonly SecretFile[]): UrlGate {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'адрес не разбирается' }
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, reason: 'в адресе логин или пароль' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'нужен https' }
  }
  if (url.port.length > 0 && url.port !== '443') {
    return { ok: false, reason: 'нужен порт 443' }
  }
  if (url.hostname.includes('*')) {
    return { ok: false, reason: 'хост не в списке' }
  }
  const upper = method.toUpperCase()
  for (const secret of secrets) {
    const row = secret.allow.find((item) => item.host === url.hostname)
    if (!row || !row.methods.includes(upper as SecretFile['allow'][number]['methods'][number])) {
      return { ok: false, reason: 'хост не в списке' }
    }
  }
  return { ok: true, hostname: url.hostname, path: `${url.pathname}${url.search}` }
}

export function privateAddress(address: string): boolean {
  return addressKind(address) !== 'public'
}
