/**
 * FILE: apps/server/src/llm/ssrf.ts
 * НАЗНАЧЕНИЕ: не пустить base_url во внутреннюю сеть.
 * ВХОД: адрес из конфига и подменяемый резолвер.
 * ВЫХОД: отказ до fetch, если хоть один адрес не публичный
 * (для http://127.0.0.1 и http://localhost — не loopback).
 * Между lookup и connect остаётся окно: резолвер ОС на соединении может вернуть другой адрес.
 * Это остаточный риск, он описан в docs/ARCH.md. Отдельного закрепителя IP нет.
 */

import { lookup } from 'node:dns/promises'
import { addressKind, inspectBaseUrl, type InspectedBaseUrl } from '@tinybots/schema'

export type Resolver = (hostname: string) => Promise<string[]>

export async function lookupAll(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.map((item) => item.address)
}

export async function ensureBaseUrl(
  input: string,
  resolve: Resolver = lookupAll,
): Promise<{ ok: true; inspected: InspectedBaseUrl } | { ok: false; reason: string }> {
  const inspected = inspectBaseUrl(input)
  if (!inspected.ok) {
    return inspected
  }
  let addresses: string[]
  try {
    addresses = await resolve(inspected.hostname)
  } catch {
    return { ok: false, reason: 'имя не резолвится' }
  }
  if (addresses.length === 0) {
    return { ok: false, reason: 'имя не резолвится' }
  }
  for (const address of addresses) {
    const kind = addressKind(address)
    if (inspected.loopback) {
      if (kind !== 'loopback') {
        return { ok: false, reason: 'localhost резолвится не в loopback' }
      }
      continue
    }
    if (kind !== 'public') {
      return { ok: false, reason: 'имя резолвится в частный адрес' }
    }
  }
  return { ok: true, inspected }
}

export function completionsUrl(base: string): string {
  const trimmed = base.endsWith('/') ? base : `${base}/`
  return new URL('chat/completions', trimmed).href
}
