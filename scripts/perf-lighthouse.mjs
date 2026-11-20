/**
 * FILE: scripts/perf-lighthouse.mjs
 * НАЗНАЧЕНИЕ: D5. Lighthouse Performance демо-пульта, форма 1440×900.
 * ВХОД: собранные apps/server/dist и apps/web/dist. Пакет lighthouse ставит шаг CI,
 * в package.json его нет: он тяжёлый и нужен только Ubuntu/Node 24.
 * ВЫХОД: код 0, если оценка не ниже 90. Пресет desktop, без отключения троттлинга.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { startServer } from '../apps/server/dist/server.js'

const require = createRequire(import.meta.url)
const loaded = require('lighthouse')
const lighthouse = loaded.default ?? loaded
const chromeLauncher = require('chrome-launcher')
const here = path.dirname(fileURLToPath(import.meta.url))
const desktop = await import(path.join(here, '../node_modules/lighthouse/core/config/desktop-config.js'))

const config = {
  extends: 'lighthouse:default',
  settings: {
    ...desktop.default.settings,
    screenEmulation: { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1, disabled: false },
  },
}

const server = await startServer({ port: 0 })
const url = `http://127.0.0.1:${server.port}/?demo=1`
const chrome = await chromeLauncher.launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
})
let score = 0
try {
  const result = await lighthouse(url, {
    logLevel: 'error',
    onlyCategories: ['performance'],
    port: chrome.port,
    output: 'json',
  }, config)
  score = Math.round((result.lhr?.categories?.performance?.score ?? 0) * 100)
  console.log(`lighthouse performance ${score}`)
} finally {
  await chrome.kill()
  await server.close()
}
if (score < 90) {
  console.error(`lighthouse performance ${score} < 90`)
  process.exit(1)
}
