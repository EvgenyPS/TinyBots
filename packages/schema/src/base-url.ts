/**
 * FILE: packages/schema/src/base-url.ts
 * НАЗНАЧЕНИЕ: синтаксис base_url до DNS и до fetch.
 * ВХОД: строка из конфига.
 * ВЫХОД: можно ли вообще рассматривать адрес. Резолв имени делает сервер.
 * Числовые и усечённые IPv4 WHATWG схлопывает в обычный адрес (2130706433 → 127.0.0.1).
 * Поэтому смотрим сырой хост, а не только то, что осталось после разбора.
 */

import { BlockList, isIP } from 'node:net'

const blocked = new BlockList()

for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(address, prefix, 'ipv4')
}

blocked.addSubnet('fc00::', 7, 'ipv6')
blocked.addSubnet('fe80::', 10, 'ipv6')
blocked.addSubnet('ff00::', 8, 'ipv6')
blocked.addAddress('::', 'ipv6')

export type AddressKind = 'loopback' | 'blocked' | 'public' | 'invalid'

export type InspectedBaseUrl = {
  ok: true
  /** http и хост в адресе написан ровно как localhost или 127.0.0.1. */
  loopback: boolean
  hostname: string
}

export type RejectedBaseUrl = { ok: false; reason: string }

function fail(reason: string): RejectedBaseUrl {
  return { ok: false, reason }
}

/** Хост из строки до нормализации URL. Скобки IPv6 сохраняем. */
export function rawHostname(input: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(input.trim())
  if (!match?.[1] || match[1].includes('@')) {
    return null
  }
  const authority = match[1]
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    if (end <= 1) {
      return null
    }
    return authority.slice(0, end + 1)
  }
  const colon = authority.lastIndexOf(':')
  if (colon === -1) {
    return authority
  }
  const port = authority.slice(colon + 1)
  if (/^\d+$/.test(port)) {
    return authority.slice(0, colon)
  }
  return authority
}

/** Десятичное слово, hex, октальные нули и усечённый IPv4. Канонические четыре октета сюда не входят. */
export function isObfuscatedIpv4(host: string): boolean {
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (bare.includes(':')) {
    return false
  }
  if (/0x/i.test(bare)) {
    return true
  }
  if (!/^[\d.]+$/.test(bare)) {
    return false
  }
  const parts = bare.split('.')
  if (parts.some((part) => part.length === 0) || parts.length !== 4) {
    return true
  }
  return parts.some((part) => part.length > 1 && part.startsWith('0'))
}

function unbracket(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1)
  }
  return host
}

/** ::ffff:a00:1 и ::ffff:10.0.0.1 → обычный IPv4, чтобы частный адрес не прошёл как «неизвестный v6». */
function mappedV4(ip: string): string | null {
  const lower = ip.toLowerCase()
  const mark = '::ffff:'
  if (!lower.startsWith(mark)) {
    return null
  }
  const rest = lower.slice(mark.length)
  if (isIP(rest) === 4) {
    return rest
  }
  const parts = rest.split(':')
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    return null
  }
  const hi = Number.parseInt(parts[0], 16)
  const lo = Number.parseInt(parts[1], 16)
  if (!Number.isInteger(hi) || !Number.isInteger(lo) || hi < 0 || lo < 0 || hi > 0xffff || lo > 0xffff) {
    return null
  }
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
}

export function addressKind(ip: string): AddressKind {
  const mapped = mappedV4(ip)
  const value = mapped ?? ip
  const family = isIP(value)
  if (family === 0) {
    return 'invalid'
  }
  if (family === 4) {
    if (value.startsWith('127.')) {
      return 'loopback'
    }
    return blocked.check(value, 'ipv4') ? 'blocked' : 'public'
  }
  if (value.toLowerCase() === '::1') {
    return 'loopback'
  }
  return blocked.check(value, 'ipv6') ? 'blocked' : 'public'
}

export function inspectBaseUrl(input: string): InspectedBaseUrl | RejectedBaseUrl {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return fail('адрес не разбирается')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return fail('в адресе логин или пароль')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return fail('нужен https')
  }
  const raw = rawHostname(input)
  if (raw === null || raw.length === 0) {
    return fail('нет хоста')
  }
  if (isObfuscatedIpv4(raw)) {
    return fail('числовая форма адреса')
  }
  const loopbackName = raw === '127.0.0.1' || raw.toLowerCase() === 'localhost'
  if (url.protocol === 'http:' && !loopbackName) {
    return fail('http только для 127.0.0.1 и localhost')
  }
  const hostname = unbracket(url.hostname)
  if (isIP(hostname) !== 0) {
    const kind = addressKind(hostname)
    if (url.protocol === 'http:' && loopbackName) {
      if (kind !== 'loopback') {
        return fail('исключение только для loopback')
      }
    } else if (kind !== 'public') {
      return fail('адрес не публичный')
    }
  }
  return {
    ok: true,
    loopback: url.protocol === 'http:' && loopbackName,
    hostname,
  }
}
