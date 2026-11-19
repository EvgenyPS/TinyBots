/**
 * FILE: apps/server/src/main.ts
 * НАЗНАЧЕНИЕ: команда npm start после сборки.
 * ВХОД: необязательный .env (PORT). HOST, если он не loopback, игнорируется.
 * ВЫХОД: процесс, который слушает 127.0.0.1 и открывает браузер.
 */

import path from 'node:path'
import { BIND_HOST, resolvePort } from './bind.js'
import { loadDotEnv } from './env.js'
import { openBrowser } from './open-browser.js'
import { repoRoot } from './root.js'
import { startServer } from './server.js'

const root = repoRoot()
process.chdir(root)
loadDotEnv(path.join(root, '.env'))

const requestedHost = process.env.HOST
if (
  requestedHost !== undefined &&
  requestedHost.trim() !== '' &&
  requestedHost !== BIND_HOST &&
  requestedHost.toLowerCase() !== 'localhost'
) {
  // Само значение не печатаем: в переменной мог оказаться не адрес.
  console.warn('HOST проигнорирован: сервер слушает только 127.0.0.1')
}

const port = resolvePort(process.env.PORT, 8787)
const running = await startServer({ port })
const url = `http://${BIND_HOST}:${running.port}`
console.log(`TinyBots: ${url}`)
openBrowser(url)
