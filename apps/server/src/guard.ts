/**
 * FILE: apps/server/src/guard.ts
 * НАЗНАЧЕНИЕ: отсечь чужой Host/Origin (DNS rebinding) на loopback-сервере.
 * ВХОД: заголовки Host и Origin.
 * ВЫХОД: можно ли отдать ответ.
 * Чтение смотрит только имя хоста. Запись (writeRequestAllowed) требует ещё и одинаковый порт у Host и Origin.
 * Техпроверки ссылки grokbot и очереди к этому слою не относятся.
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

/**
 * Нет Origin — обычный заход в браузере и GET с той же страницы.
 * Есть Origin — только http(s) на 127.0.0.1 или localhost.
 */
export function originAllowed(origin: string | undefined): boolean {
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
  return isLoopbackHostname(url.hostname)
}

export function requestAllowed(host: string | undefined, origin: string | undefined): boolean {
  if (host === undefined) {
    return false
  }
  const hostname = hostnameFromHostHeader(host)
  if (hostname === null || !isLoopbackHostname(hostname)) {
    return false
  }
  return originAllowed(origin)
}

/** Порт из Host. null — порта нет или это не число 1…65535. Для записи порт обязателен. */
export function portFromHostHeader(host: string): number | null {
  const trimmed = host.trim()
  if (trimmed.length === 0) {
    return null
  }
  let raw: string | null = null
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    if (end <= 1) {
      return null
    }
    const rest = trimmed.slice(end + 1)
    if (!rest.startsWith(':')) {
      return null
    }
    raw = rest.slice(1)
  } else {
    const colon = trimmed.lastIndexOf(':')
    if (colon === -1) {
      return null
    }
    raw = trimmed.slice(colon + 1)
  }
  if (!/^\d+$/.test(raw)) {
    return null
  }
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null
  }
  return port
}

function portFromOrigin(url: URL): number | null {
  if (url.port !== '') {
    const port = Number(url.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return null
    }
    return port
  }
  if (url.protocol === 'http:') {
    return 80
  }
  if (url.protocol === 'https:') {
    return 443
  }
  return null
}

/**
 * Запись: Host и Origin оба loopback и с одним и тем же портом.
 * Страница на 127.0.0.1, но с другого порта, конфиг писать не должна.
 * Пустой Origin тоже нет: нашу форму браузер всегда помечает.
 */
export function writeRequestAllowed(host: string | undefined, origin: string | undefined): boolean {
  if (host === undefined || origin === undefined || origin === '') {
    return false
  }
  const hostname = hostnameFromHostHeader(host)
  const hostPort = portFromHostHeader(host)
  if (hostname === null || hostPort === null || !isLoopbackHostname(hostname)) {
    return false
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
  const originPort = portFromOrigin(url)
  return originPort !== null && originPort === hostPort
}
