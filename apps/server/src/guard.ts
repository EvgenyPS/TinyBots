/**
 * FILE: apps/server/src/guard.ts
 * НАЗНАЧЕНИЕ: отсечь чужой Host/Origin (DNS rebinding) на loopback-сервере.
 * ВХОД: заголовки Host и Origin и порт, на котором слушает этот процесс.
 * ВЫХОД: можно ли отдать ответ. Имя loopback без нашего порта не проходит:
 * другой локальный процесс не должен читаться как пульт.
 * И чтение, и запись сверяют Host/Origin с портом этого процесса (requestAllowed).
 * У записи Origin обязателен, иначе проверка порта у Origin не срабатывает.
 */

import { BIND_HOST, DESKTOP_PORT } from './bind.js'

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost'])

/**
 * Единственный дополнительный Origin. Без звёздочки и без порта:
 * окно Tauri на Windows открыто как http://tauri.localhost.
 */
export const TAURI_ORIGIN = 'http://tauri.localhost'

export function isDesktopHostHeader(host: string | undefined): boolean {
  if (host === undefined) {
    return false
  }
  const value = host.trim().toLowerCase()
  return value === `${BIND_HOST}:${DESKTOP_PORT}` || value === `localhost:${DESKTOP_PORT}`
}

/** Имя хоста из заголовка Host, без порта. null — заголовок сломан. */
export function hostnameFromHostHeader(host: string): string | null {
  const trimmed = host.trim()
  if (trimmed.length === 0) {
    return null
  }
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    if (end <= 1) {
      return null
    }
    return trimmed.slice(1, end).toLowerCase()
  }
  const colon = trimmed.lastIndexOf(':')
  if (colon === -1) {
    return trimmed.toLowerCase().replace(/\.$/, '')
  }
  const maybePort = trimmed.slice(colon + 1)
  if (/^\d+$/.test(maybePort)) {
    return trimmed.slice(0, colon).toLowerCase().replace(/\.$/, '')
  }
  return trimmed.toLowerCase().replace(/\.$/, '')
}

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_NAMES.has(hostname.toLowerCase().replace(/\.$/, ''))
}

function parsePort(value: string): number | null {
  if (!/^\d{1,5}$/.test(value)) {
    return null
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null
  }
  return port
}

/** Порт из Host. Нет порта или он не число — null, такой заголовок не наш. */
export function portFromHostHeader(host: string): number | null {
  const trimmed = host.trim()
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    if (end === -1) {
      return null
    }
    const rest = trimmed.slice(end + 1)
    if (!rest.startsWith(':')) {
      return null
    }
    return parsePort(rest.slice(1))
  }
  const colon = trimmed.lastIndexOf(':')
  if (colon === -1) {
    return null
  }
  return parsePort(trimmed.slice(colon + 1))
}

function isListenPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

/**
 * Нет Origin — обычный заход в браузере и GET с той же страницы.
 * Есть Origin — только http(s) на loopback и только на порт этого сервера.
 * Плюс ровно http://tauri.localhost, без порта и без звёздочки.
 * Порт по умолчанию (80/443), если его не написали, — это не наш порт.
 */
export function originAllowed(origin: string | undefined, port: number): boolean {
  if (!isListenPort(port)) {
    return false
  }
  if (origin === TAURI_ORIGIN) {
    return true
  }
  if (origin === undefined || origin === '') {
    return true
  }
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false
  }
  if (!isLoopbackHostname(url.hostname)) {
    return false
  }
  const originPort = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port)
  return originPort === port
}

/**
 * Чужая вкладка шлёт same-site или cross-site и не должна тратить ключ.
 * Своя страница — same-origin, переход по адресной строке — none, старые клиенты заголовок не ставят.
 */
export function fetchSiteAllowed(header: string | undefined): boolean {
  if (header === undefined) {
    return true
  }
  const value = header.trim().toLowerCase()
  return value.length === 0 || value === 'same-origin' || value === 'none'
}

/**
 * same-site и cross-site по-прежнему закрыты.
 * Исключение одно: страница http://tauri.localhost ходит на 127.0.0.1,
 * браузер помечает это как cross-site. Origin при этом подделать скриптом нельзя.
 */
export function fetchSiteAllowedFor(header: string | undefined, origin: string | undefined): boolean {
  if (fetchSiteAllowed(header)) {
    return true
  }
  if (origin !== TAURI_ORIGIN || header === undefined) {
    return false
  }
  return header.trim().toLowerCase() === 'cross-site'
}

export function requestAllowed(host: string | undefined, origin: string | undefined, port: number): boolean {
  if (!isListenPort(port) || host === undefined) {
    return false
  }
  const hostname = hostnameFromHostHeader(host)
  const hostPort = portFromHostHeader(host)
  if (hostname === null || hostPort === null || hostPort !== port || !isLoopbackHostname(hostname)) {
    return false
  }
  return originAllowed(origin, port)
}
