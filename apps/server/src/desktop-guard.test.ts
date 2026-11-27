/**
 * FILE: apps/server/src/desktop-guard.test.ts
 * НАЗНАЧЕНИЕ: защита десктопа. Host, Origin окна, токен и отсутствие значения ключа в ответах.
 * Сервер по-прежнему слушает только 127.0.0.1. Звёздочка в Origin не появляется.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { stringify } from 'yaml'
import { BIND_HOST } from './bind.js'
import { TAURI_ORIGIN } from './guard.js'
import { resetOsSecretCache, useOsSecretReader, useOsSecretWriter } from './llm/os-secret.js'
import { forgetSecrets, logSafe } from './redact.js'
import { repoRoot } from './root.js'
import { createApp, startServer, type RunningServer } from './server.js'

const TOKEN = 'ab'.repeat(32)
const CANARY = 'canary-key-value-9f3a'
const NAME = 'PARTNER_API_KEY'
const dirs: string[] = []

afterEach(() => {
  useOsSecretReader(null)
  useOsSecretWriter(null)
  resetOsSecretCache()
  forgetSecrets()
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function desktopApp() {
  return createApp({
    boundPort: { current: 8787 },
    sessionToken: TOKEN,
    desktopHost: true,
  })
}

test('без токена /api закрыт, Host только два, Origin окна один', async () => {
  const app = desktopApp()
  const headers = {
    host: '127.0.0.1:8787',
    origin: TAURI_ORIGIN,
    'x-tinybots-session': TOKEN,
  }
  const ok = await app.request('http://127.0.0.1:8787/api/bots', { headers })
  expect(ok.status).toBe(200)
  expect(ok.headers.get('access-control-allow-origin')).toBe(TAURI_ORIGIN)
  expect(ok.headers.get('access-control-allow-origin')).not.toBe('*')

  const missing = await app.request('http://127.0.0.1:8787/api/bots', {
    headers: { host: '127.0.0.1:8787', origin: TAURI_ORIGIN },
  })
  expect(missing.status).toBe(401)

  const wrong = await app.request('http://127.0.0.1:8787/api/bots', {
    headers: { host: '127.0.0.1:8787', 'x-tinybots-session': 'cd'.repeat(32) },
  })
  expect(wrong.status).toBe(401)

  const short = await app.request('http://127.0.0.1:8787/api/launcher', {
    headers: { host: '127.0.0.1:8787', 'x-tinybots-session': TOKEN.slice(0, 16) },
  })
  expect(short.status).toBe(401)

  const health = await app.request('http://127.0.0.1:8787/health', { headers: { host: '127.0.0.1:8787' } })
  expect(health.status).toBe(200)

  for (const host of ['127.0.0.1:8788', '10.1.2.3:8787', 'evil.example:8787', '127.0.0.1:08787', '[::1]:8787']) {
    const res = await app.request('http://127.0.0.1:8787/api/bots', {
      headers: { host, 'x-tinybots-session': TOKEN },
    })
    expect(res.status, host).toBe(403)
  }

  const localhost = await app.request('http://127.0.0.1:8787/api/bots', {
    headers: { host: 'localhost:8787', 'x-tinybots-session': TOKEN },
  })
  expect(localhost.status).toBe(200)

  const star = await app.request('http://127.0.0.1:8787/api/bots', {
    headers: { host: '127.0.0.1:8787', origin: '*', 'x-tinybots-session': TOKEN },
  })
  expect(star.status).toBe(403)

  const cross = await app.request('http://127.0.0.1:8787/api/bots', {
    headers: {
      host: '127.0.0.1:8787',
      origin: TAURI_ORIGIN,
      'sec-fetch-site': 'cross-site',
      'x-tinybots-session': TOKEN,
    },
  })
  expect(cross.status).toBe(200)

  const evilCross = await app.request('http://127.0.0.1:8787/api/bots', {
    headers: {
      host: '127.0.0.1:8787',
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
      'x-tinybots-session': TOKEN,
    },
  })
  expect(evilCross.status).toBe(403)

  const preflight = await app.request('http://127.0.0.1:8787/api/bots', {
    method: 'OPTIONS',
    headers: { host: '127.0.0.1:8787', origin: TAURI_ORIGIN },
  })
  expect(preflight.status).toBe(204)
  expect(preflight.headers.get('access-control-allow-origin')).toBe(TAURI_ORIGIN)

  const otherOptions = await app.request('http://127.0.0.1:8787/api/bots', {
    method: 'OPTIONS',
    headers: { host: '127.0.0.1:8787', origin: 'http://evil.example' },
  })
  expect(otherOptions.status).toBe(405)
})

test('живой процесс с токеном слушает только loopback', async () => {
  const running = await startServer({ port: 0, sessionToken: TOKEN })
  try {
    expect(running.address).toBe(BIND_HOST)
    const denied = await fetch(`http://${BIND_HOST}:${running.port}/api/bots`)
    expect(denied.status).toBe(401)
    const ok = await fetch(`http://${BIND_HOST}:${running.port}/api/bots`, {
      headers: { 'X-Tinybots-Session': TOKEN },
    })
    expect(ok.status).toBe(200)
    const text = await ok.text()
    expect(text.includes(TOKEN)).toBe(false)
  } finally {
    await running.close()
  }
})

test('токен сессии не попадает в журнал', async () => {
  const running = await startServer({ port: 0, sessionToken: TOKEN })
  const lines: string[] = []
  const previous = console.info
  console.info = (message?: unknown) => {
    lines.push(String(message))
  }
  try {
    logSafe(`сессия ${TOKEN}`)
  } finally {
    console.info = previous
    await running.close()
  }
  expect(lines.join('\n').includes(TOKEN)).toBe(false)
  expect(lines.join('\n')).toContain('[secret]')
})

test('ответы API не содержат значение ключа', async () => {
  mkdirSync(path.join(repoRoot(), 'data'), { recursive: true })
  const dir = mkdtempSync(path.join(repoRoot(), 'data', 'vitest-desktop-'))
  dirs.push(dir)
  mkdirSync(path.join(dir, 'demo-project'), { recursive: true })
  const config = {
    schema_version: 1,
    owner: { name: 'Ника', confirms_merge: true },
    data_dir: '.',
    delivery: 'clipboard',
    bots: [{
      id: 'nora',
      name: 'Нора',
      role: 'справка',
      instructions: 'Коротко.',
      provider: 'deepseek',
      model: 'deepseek-chat',
      base_url: 'http://127.0.0.1:9/v1',
      api_key_env: 'DEEPSEEK_API_KEY',
    }],
    projects: [{
      id: 'demo-keys',
      title: 'Demo Keys',
      lead: 'nora',
      owner: 'owner',
      merge_executor: 'nora',
      source: { files: { path: 'demo-project' } },
      chats: [{
        id: 'build',
        title: 'Сборка',
        lead: 'nora',
        members: ['nora'],
        rules: { do: 'код', dont: 'чужое' },
        context: [],
        economy: { wake: 'mentioned_only', reply_limit: 'short' },
      }],
    }],
    economy: {
      defaults: { wake: 'mentioned_only', reply_limit: 'short', max_wakes_per_task: 3 },
      stale_after_hours: 6,
    },
  }
  writeFileSync(path.join(dir, 'config.yaml'), stringify(config), 'utf8')
  const configPath = path.relative(repoRoot(), path.join(dir, 'config.yaml')).split(path.sep).join('/')
  const store = new Map<string, string>([[NAME, CANARY]])
  useOsSecretReader((name) => store.get(name) ?? null)
  useOsSecretWriter(async (name, value) => {
    store.set(name, value)
    return 'ok' as const
  })
  let server: RunningServer | undefined
  try {
    server = await startServer({ port: 0, configPath, sessionToken: TOKEN })
    const origin = `http://${BIND_HOST}:${server.port}`
    const headers = {
      Origin: origin,
      'X-Tinybots-Session': TOKEN,
      'Content-Type': 'application/json',
    }
    const opened = await fetch(`${origin}/api/launcher`, { headers })
    const openedText = await opened.text()
    expect(openedText.includes(CANARY)).toBe(false)
    expect(openedText.includes(TOKEN)).toBe(false)
    const csrf = (JSON.parse(openedText) as { csrf?: string }).csrf ?? ''
    const paths = [
      '/api/bots',
      '/api/launcher',
      '/api/projects',
      '/api/roster',
      '/api/chats',
      '/api/notes',
      '/api/tasks',
      '/api/sync',
      '/api/setup',
      '/api/secrets',
      '/api/git?project=demo-keys',
      '/api/files?project=demo-keys',
      '/api/chat?bot=nora',
      '/api/brief?project=demo-keys&chat=build&task=missing',
      '/health',
    ]
    for (const pathname of paths) {
      const res = await fetch(`${origin}${pathname}`, { headers })
      const text = await res.text()
      expect(text.includes(CANARY), pathname).toBe(false)
      expect(text.includes(TOKEN), pathname).toBe(false)
    }
    const saved = await fetch(`${origin}/api/secrets`, {
      method: 'POST',
      headers: { ...headers, 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        name: NAME,
        description: 'ключ партнёра',
        header: 'Authorization: Bearer',
        body: false,
        allow: [{ host: 'example.com', methods: ['GET'] }],
        bots: ['nora'],
        value: CANARY,
      }),
    })
    const savedText = await saved.text()
    expect(saved.status).toBe(200)
    expect(savedText.includes(CANARY)).toBe(false)
    expect(savedText).toContain('"set":true')
    const listed = await fetch(`${origin}/api/secrets`, { headers })
    const listedText = await listed.text()
    expect(listedText.includes(CANARY)).toBe(false)
    expect(listedText).toContain('"set":true')
    expect(store.get(NAME)).toBe(CANARY)
  } finally {
    await server?.close()
  }
})
