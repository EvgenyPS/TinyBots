/**
 * FILE: apps/server/src/secrets/request.ts
 * НАЗНАЧЕНИЕ: один инструмент http_request. Фиксированных команд нет.
 * ВХОД: аргументы модели, карточки ключей и читатель хранилища.
 * ВЫХОД: маскированный текст для модели и строка журнала без значения.
 * После DNS частный, loopback и link-local адрес, включая 169.254.169.254, отвергается.
 * Соединение идёт на уже проверенный IP: повторный резолв ОС не выбирает другой адрес.
 * Редирект не выполняется. Частота ограничена по имени ключа.
 */

import { lookup } from 'node:dns/promises'
import { appendFileSync, mkdirSync } from 'node:fs'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { isIP } from 'node:net'
import path from 'node:path'
import { knownSecrets, rememberSecret } from '../redact.js'
import { readCachedOsSecret } from '../llm/os-secret.js'
import { SECRET_MASK_MIN, maskClosedChannel, maskParts } from './mask.js'
import { readSecretFile, type SecretFile } from './meta.js'
import { checkPlacement, gateUrl, privateAddress, substituteOnce } from './policy.js'

/** Сколько байт ответа отдаём боту. Длиннее — обрыв, тело не показывается. */
export const SECRET_RESPONSE_MAX = 64 * 1024

/** Вызовов одного ключа за окно. Дальше сеть не открывается. */
export const SECRET_RATE_LIMIT = 10

export const SECRET_RATE_WINDOW_MS = 60_000

const hits = new Map<string, number[]>()

export function resetSecretRate(): void {
  hits.clear()
}

export function takeSecretRate(name: string, now: number): boolean {
  const from = now - SECRET_RATE_WINDOW_MS
  const prev = (hits.get(name) ?? []).filter((stamp) => stamp > from)
  if (prev.length >= SECRET_RATE_LIMIT) {
    hits.set(name, prev)
    return false
  }
  prev.push(now)
  hits.set(name, prev)
  return true
}

export type SecretLookup = (hostname: string) => Promise<string[]>

export type SecretDialInput = {
  hostname: string
  pinned: string
  method: string
  path: string
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export type SecretDialResult = {
  status: number
  headers: string
  body: string
  tooBig?: boolean
}

export type SecretDial = (input: SecretDialInput) => Promise<SecretDialResult>

let lookupOverride: SecretLookup | null = null
let dialOverride: SecretDial | null = null

/** Подмена DNS и соединения в тесте. null возвращает настоящие. */
export function useSecretTransport(next: { lookup?: SecretLookup; dial?: SecretDial } | null): void {
  lookupOverride = next?.lookup ?? null
  dialOverride = next?.dial ?? null
}

async function resolveHost(hostname: string): Promise<string[]> {
  if (lookupOverride) {
    return lookupOverride(hostname)
  }
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.map((item) => item.address)
}

/** lookup для tls: всегда тот IP, который уже прошёл проверку. */
export function pinnedLookup(address: string): NonNullable<RequestOptions['lookup']> {
  const family = isIP(address) === 6 ? 6 : 4
  return ((_hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback
    done(null, address, family)
  }) as NonNullable<RequestOptions['lookup']>
}

function realDial(input: SecretDialInput): Promise<SecretDialResult> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      protocol: 'https:',
      hostname: input.hostname,
      port: 443,
      method: input.method,
      path: input.path,
      headers: input.headers,
      servername: input.hostname,
      lookup: pinnedLookup(input.pinned),
      timeout: 10_000,
      rejectUnauthorized: true,
    }, (res) => {
      const chunks: Buffer[] = []
      let size = 0
      let tooBig = false
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > SECRET_RESPONSE_MAX) {
          tooBig = true
          chunks.length = 0
          res.destroy()
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        const headers = Object.entries(res.headers)
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value ?? ''}`)
          .join('\n')
        resolve({
          status: res.statusCode ?? 0,
          headers,
          body: tooBig ? '' : Buffer.concat(chunks).toString('utf8'),
          tooBig,
        })
      })
      res.on('error', () => {
        if (tooBig) {
          resolve({ status: res.statusCode ?? 0, headers: '', body: '', tooBig: true })
          return
        }
        reject(new Error('сеть'))
      })
    })
    const stop = (): void => {
      req.destroy(new Error('таймаут'))
    }
    if (input.signal) {
      if (input.signal.aborted) {
        stop()
      } else {
        input.signal.addEventListener('abort', stop, { once: true })
      }
    }
    req.on('timeout', stop)
    req.on('error', reject)
    if (input.body !== undefined) {
      req.write(input.body)
    }
    req.end()
  })
}

function journal(dataDir: string, row: { name: string; host: string; method: string; status: number }): void {
  const line = maskClosedChannel(JSON.stringify({
    at: new Date().toISOString(),
    name: row.name,
    host: row.host,
    method: row.method,
    status: row.status,
  }), knownSecrets())
  const dir = path.join(dataDir, 'secrets')
  mkdirSync(dir, { recursive: true })
  appendFileSync(path.join(dir, 'journal.jsonl'), `${line}\n`, { mode: 0o600 })
}

function toolError(reason: string): string {
  return JSON.stringify({ ok: false, error: reason })
}

const argsSchemaSafe = (raw: string): { url: string; method: string; headers: Record<string, string>; body?: string } | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const record = parsed as Record<string, unknown>
  const keys = Object.keys(record)
  for (const key of keys) {
    if (key !== 'url' && key !== 'method' && key !== 'headers' && key !== 'body') {
      return null
    }
  }
  if (typeof record.url !== 'string' || record.url.length === 0 || record.url.length > 2048) {
    return null
  }
  if (typeof record.method !== 'string' || record.method.length === 0 || record.method.length > 16) {
    return null
  }
  const headers: Record<string, string> = {}
  if (record.headers !== undefined) {
    if (record.headers === null || typeof record.headers !== 'object' || Array.isArray(record.headers)) {
      return null
    }
    for (const [key, value] of Object.entries(record.headers)) {
      if (typeof value !== 'string' || key.length > 128 || value.length > 4096) {
        return null
      }
      headers[key] = value
    }
  }
  if (record.body !== undefined && (typeof record.body !== 'string' || record.body.length > 65_536)) {
    return null
  }
  return {
    url: record.url,
    method: record.method.toUpperCase(),
    headers,
    body: typeof record.body === 'string' ? record.body : undefined,
  }
}

function visible(text: string, secrets: readonly string[]): string {
  const masked = maskClosedChannel(text, secrets)
  if (Buffer.byteLength(masked) > SECRET_RESPONSE_MAX) {
    return maskClosedChannel(masked.slice(0, SECRET_RESPONSE_MAX), secrets)
  }
  return masked
}

export function httpToolDefinition(items: readonly { name: string; description: string }[]): unknown {
  const lines = items.map((item) => `{{secret:${item.name}}} — ${item.description}`)
  return {
    type: 'function',
    function: {
      name: 'http_request',
      description: [
        'Один HTTPS-запрос. Ссылка на ключ подставляется один раз.',
        'Только в заголовок этого ключа. В тело — только если у ключа это разрешено.',
        'В URL, путь и query ссылку класть нельзя.',
        ...lines,
      ].join('\n'),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string' },
          method: { type: 'string' },
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          body: { type: 'string' },
        },
        required: ['url', 'method'],
      },
    },
  }
}

export async function runHttpRequest(input: {
  dataDir: string
  botId: string
  argsText: string
  now?: number
  signal?: AbortSignal
}): Promise<string> {
  const args = argsSchemaSafe(input.argsText)
  if (!args) {
    return toolError('аргументы')
  }
  const names = new Set<string>()
  const collect = (text: string): void => {
    for (const match of text.matchAll(/\{\{secret:([A-Z][A-Z0-9_]{0,63})\}\}/g)) {
      if (match[1]) {
        names.add(match[1])
      }
    }
  }
  collect(args.url)
  collect(args.body ?? '')
  for (const value of Object.values(args.headers)) {
    collect(value)
  }
  const cards: SecretFile[] = []
  for (const name of names) {
    const card = readSecretFile(input.dataDir, name)
    if (!card || !card.bots.includes(input.botId)) {
      journal(input.dataDir, { name, host: '', method: args.method, status: 403 })
      return toolError('нет доступа')
    }
    cards.push(card)
  }
  const placed = checkPlacement({
    url: args.url,
    method: args.method,
    headers: args.headers,
    body: args.body,
    secrets: cards,
  })
  if (!placed.ok) {
    const name = cards[0]?.name ?? [...names][0] ?? 'UNKNOWN'
    journal(input.dataDir, { name, host: '', method: args.method, status: 400 })
    return toolError(placed.reason)
  }
  const used = cards.filter((card) => placed.names.includes(card.name))
  const gated = gateUrl(args.url, args.method, used)
  if (!gated.ok) {
    journal(input.dataDir, { name: used[0]?.name ?? 'UNKNOWN', host: '', method: args.method, status: 400 })
    return toolError(gated.reason)
  }
  const now = input.now ?? Date.now()
  for (const card of used) {
    if (!takeSecretRate(card.name, now)) {
      journal(input.dataDir, { name: card.name, host: gated.hostname, method: args.method, status: 429 })
      return toolError('слишком часто')
    }
  }
  let addresses: string[]
  try {
    addresses = await resolveHost(gated.hostname)
  } catch {
    journal(input.dataDir, { name: used[0]?.name ?? 'UNKNOWN', host: gated.hostname, method: args.method, status: 422 })
    return toolError('имя не резолвится')
  }
  if (addresses.length === 0 || addresses.some((address) => privateAddress(address))) {
    journal(input.dataDir, { name: used[0]?.name ?? 'UNKNOWN', host: gated.hostname, method: args.method, status: 422 })
    return toolError('адрес не публичный')
  }
  const pinned = addresses[0] ?? ''
  const values = new Map<string, string>()
  for (const card of used) {
    const value = await readCachedOsSecret(card.name)
    if (value === null || value.length < SECRET_MASK_MIN) {
      journal(input.dataDir, { name: card.name, host: gated.hostname, method: args.method, status: 422 })
      return toolError('ключа нет')
    }
    rememberSecret(value)
    values.set(card.name, value)
  }
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(args.headers)) {
    headers[key] = substituteOnce(value, values)
  }
  const body = args.body === undefined ? undefined : substituteOnce(args.body, values)
  const dial = dialOverride ?? realDial
  let result: SecretDialResult
  try {
    result = await dial({
      hostname: gated.hostname,
      pinned,
      method: args.method,
      path: gated.path,
      headers,
      body,
      signal: input.signal,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'сеть'
    journal(input.dataDir, { name: used[0]?.name ?? 'UNKNOWN', host: gated.hostname, method: args.method, status: 502 })
    return toolError(visible(message, [...values.values()]))
  }
  for (const card of used) {
    journal(input.dataDir, { name: card.name, host: gated.hostname, method: args.method, status: result.status })
  }
  const secretValues = [...values.values()]
  if (result.status >= 300 && result.status < 400) {
    return toolError('редирект запрещён')
  }
  if (result.tooBig) {
    return toolError('ответ больше лимита')
  }
  const text = visible(maskParts([result.headers, result.body], secretValues).join(''), secretValues)
  return JSON.stringify({ ok: true, status: result.status, text })
}
