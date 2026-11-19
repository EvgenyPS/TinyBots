/**
 * FILE: apps/server/src/guard.ts
 * НАЗНАЧЕНИЕ: отсечь чужой Host/Origin (DNS rebinding) на loopback-сервере.
 * ВХОД: заголовки Host и Origin и порт, на котором слушает этот процесс.
 * ВЫХОД: можно ли отдать ответ. Имя loopback без нашего порта не проходит:
 * другой локальный процесс не должен читаться как пульт.
 * Записи по HTTP нет: не-GET отвечает 405. CSRF появится вместе с первым записывающим маршрутом.
 */

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost'])

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
 * Порт по умолчанию (80/443), если его не написали, — это не наш порт.
 */
export function originAllowed(origin: string | undefined, port: number): boolean {
  if (!isListenPort(port)) {
    return false
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
