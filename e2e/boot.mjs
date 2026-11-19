/**
 * FILE: e2e/boot.mjs
 * НАЗНАЧЕНИЕ: поднять собранный сервер для Playwright, не открывая браузер.
 * ВХОД: TINYBOTS_CONFIG и TINYBOTS_NOW (мгновение для «устарело» и ЧЧ:ММ).
 * ВЫХОД: строка READY <port> в stdout. Часы читает только этот запуск, не npm start.
 */

import { writeSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../apps/server/dist/server.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

const nowIso = process.env.TINYBOTS_NOW?.trim()
const configPath = process.env.TINYBOTS_CONFIG?.trim()
const server = await startServer({
  port: 0,
  configPath: configPath || undefined,
  now: nowIso ? () => new Date(nowIso) : undefined,
})
writeSync(1, `READY ${server.port}\n`)
