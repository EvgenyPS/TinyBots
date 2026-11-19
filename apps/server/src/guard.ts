/**
 * FILE: apps/server/src/guard.ts
 * НАЗНАЧЕНИЕ: отсечь чужой Host/Origin (DNS rebinding) на loopback-сервере.
 * ВХОД: заголовки Host и Origin.
 * ВЫХОД: можно ли отдать ответ.
 * TODO(PR 3): CSRF-токен на все записывающие маршруты и сверка Origin с портом из конфига.
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
