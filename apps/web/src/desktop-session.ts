/**
 * FILE: apps/web/src/desktop-session.ts
 * НАЗНАЧЕНИЕ: в окне Tauri подставить токен сессии к запросам /api.
 * ВХОД: window.__TINYBOTS_SESSION__, его кладёт инициализация окна и сразу стирает с window.
 * ВЫХОД: fetch на http://127.0.0.1:8787. В браузере (npm start) функция ничего не меняет.
 * Токен остаётся в замыкании, в консоль и на диск не пишется.
 */

const API = 'http://127.0.0.1:8787'

type DesktopWindow = Window & { __TINYBOTS_SESSION__?: unknown }

export function installDesktopSession(): void {
  const holder = window as DesktopWindow
  const token = holder.__TINYBOTS_SESSION__
  delete holder.__TINYBOTS_SESSION__
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
    return
  }
  const native = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!raw.startsWith('/api')) {
      return native(input, init)
    }
    const headers = new Headers(init?.headers)
    headers.set('X-Tinybots-Session', token)
    return native(`${API}${raw}`, { ...init, headers })
  }
}
