/**
 * FILE: apps/server/src/open-browser.ts
 * НАЗНАЧЕНИЕ: открыть демо-страницу после старта.
 * Ошибка запуска браузера не роняет сервер: URL уже напечатан.
 * TINYBOTS_NO_BROWSER=1 отключает вызов (удобно в проверках).
 */

import { spawn } from 'node:child_process'

export function openBrowser(url: string): void {
  if (process.env.TINYBOTS_NO_BROWSER === '1') {
    return
  }
  // URL собирает сам сервер, в shell его не отдаём.
  const command =
    process.platform === 'win32'
      ? { cmd: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] }
      : process.platform === 'darwin'
        ? { cmd: 'open', args: [url] }
        : { cmd: 'xdg-open', args: [url] }

  const child = spawn(command.cmd, command.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.on('error', () => {
    // Утилиты может не быть (сервер без рабочего стола). Страница доступна по URL.
  })
  child.unref()
}
