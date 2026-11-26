/**
 * FILE: apps/server/src/llm/secret.test.ts
 * НАЗНАЧЕНИЕ: ключ своего бота из хранилища ОС, затем из .env.
 * Хранилище важнее окружения. Сбой модуля не роняет чтение и не печатает значение.
 * Ответ /api/launcher, /api/roster и /api/chat значение не содержит.
 */

import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { stringify } from 'yaml'
import { afterEach, expect, test } from 'vitest'
import { API_KEY_ENV_PATTERN } from '@tinybots/schema'
import { BIND_HOST } from '../bind.js'
import { logSafe } from '../redact.js'
import { repoRoot } from '../root.js'
import { startServer, type RunningServer } from '../server.js'
import { readOsSecret, resetOsKeyringCache, type OsKeyring } from './os-secret.js'
import { apiKeyNameSchema, readApiKey, useOsSecretReader } from './secret.js'

const NAME = 'DEEPSEEK_API_KEY'
const FROM_STORE = 'os-store-canary-value'
const FROM_ENV = 'env-file-canary-value'

const dirs: string[] = []

afterEach(() => {
  useOsSecretReader(null)
  resetOsKeyringCache()
  delete process.env[NAME]
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function capture(): { text: () => string; stop: () => void } {
  const chunks: string[] = []
  const stdout = process.stdout.write
  const stderr = process.stderr.write
  const info = console.info
  const error = console.error
  const log = console.log
  const sink = ((chunk: string | Uint8Array) => {
    chunks.push(Buffer.from(chunk).toString('utf8'))
    return true
  }) as typeof process.stdout.write
  const keep = (...args: unknown[]) => {
    chunks.push(args.map((item) => String(item)).join(' '))
  }
  process.stdout.write = sink
  process.stderr.write = sink
  console.info = keep
  console.error = keep
  console.log = keep
  return {
    text: () => chunks.join(''),
    stop: () => {
      process.stdout.write = stdout
      process.stderr.write = stderr
      console.info = info
      console.error = error
      console.log = log
    },
  }
}

function keyring(getPassword: () => string | null, failCtor = false): OsKeyring {
  return {
    Entry: class {
      constructor() {
        if (failCtor) {
          throw new Error(`хранилище ${FROM_STORE}`)
        }
      }
      getPassword(): string | null {
        return getPassword()
      }
    },
  }
}

test('имя ключа — zod, только A–Z, цифры и _ с суффиксом _API_KEY', () => {
  expect(apiKeyNameSchema.safeParse(NAME).success).toBe(true)
  expect(apiKeyNameSchema.safeParse('A1_API_KEY').success).toBe(true)
  expect(API_KEY_ENV_PATTERN.test(NAME)).toBe(true)
  for (const bad of ['GITHUB_TOKEN', 'PATH', 'deepseek_api_key', 'DEEPSEEK-API-KEY', '1API_KEY', '', 'DEEPSEEK_API_KEY ']) {
    expect(apiKeyNameSchema.safeParse(bad).success, bad).toBe(false)
    expect(readApiKey(bad, { [NAME]: FROM_ENV }).ok).toBe(false)
  }
})

test('хранилище важнее .env, пустая запись падает в окружение', () => {
  useOsSecretReader(() => FROM_STORE)
  const picked = readApiKey(NAME, { [NAME]: FROM_ENV })
  expect(picked).toEqual({ ok: true, value: FROM_STORE })

  useOsSecretReader(() => '   ')
  expect(readApiKey(NAME, { [NAME]: FROM_ENV })).toEqual({ ok: true, value: FROM_ENV })

  useOsSecretReader(() => null)
  expect(readApiKey(NAME, {})).toEqual({ ok: false, reason: 'ключа нет' })
})

test('ошибка модуля и ошибка хранилища не печатают значение и не роняют чтение', () => {
  const boom = 'module-boom-canary-value'
  const envOnly = 'env-only-canary-value'
  const logs = capture()
  try {
    expect(readOsSecret(NAME, () => {
      throw new Error(`модуль ${boom}`)
    })).toBeNull()
    expect(readOsSecret(NAME, () => keyring(() => {
      throw new Error(`чтение ${boom}`)
    }))).toBeNull()
    expect(readOsSecret(NAME, () => keyring(() => boom, true))).toBeNull()
    useOsSecretReader((account) => readOsSecret(account, () => {
      throw new Error(`модуль ${boom}`)
    }))
    expect(readApiKey(NAME, { [NAME]: envOnly })).toEqual({ ok: true, value: envOnly })
  } finally {
    logs.stop()
  }
  expect(logs.text().includes(boom)).toBe(false)
  expect(logs.text().includes(envOnly)).toBe(false)
  const redacted = capture()
  try {
    logSafe(`ключ ${envOnly}`)
  } finally {
    redacted.stop()
  }
  expect(redacted.text().includes(envOnly)).toBe(false)
  expect(redacted.text().includes('[secret]')).toBe(true)
})

test('учётная запись — имя ключа, сервис tinybots, на Linux только Secret Service', () => {
  let seen: { service: string; account: string; options: unknown } | null = null
  const got = readOsSecret(NAME, () => ({
    Entry: class {
      constructor(service: string, account: string, options?: unknown) {
        seen = { service, account, options }
      }
      getPassword(): string | null {
        return FROM_STORE
      }
    },
  }))
  expect(got).toBe(FROM_STORE)
  expect(seen).toEqual({
    service: 'tinybots',
    account: NAME,
    options: { linux: { store: 'secret-service' } },
  })
})

test('чужое имя не читает хранилище', () => {
  let called = false
  useOsSecretReader(() => {
    called = true
    return FROM_STORE
  })
  expect(readApiKey('GITHUB_TOKEN', { GITHUB_TOKEN: FROM_ENV }).ok).toBe(false)
  expect(called).toBe(false)
})

function project(baseUrl: string): string {
  mkdirSync(path.join(repoRoot(), 'data'), { recursive: true })
  const dir = mkdtempSync(path.join(repoRoot(), 'data', 'vitest-os-secret-'))
  dirs.push(dir)
  const config = {
    schema_version: 1,
    owner: { name: 'Ника', confirms_merge: true },
    data_dir: '.',
    delivery: 'clipboard',
    bots: [
      {
        id: 'nora',
        name: 'Нора',
        role: 'справка',
        instructions: 'Отвечай коротко.',
        provider: 'deepseek',
        model: 'deepseek-chat',
        base_url: baseUrl,
        api_key_env: NAME,
      },
    ],
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
        rules: { do: 'код', dont: 'секреты' },
        context: [],
        economy: { wake: 'mentioned_only', reply_limit: 'short' },
      }],
    }],
    economy: {
      defaults: { wake: 'mentioned_only', reply_limit: 'short', max_wakes_per_task: 3 },
      stale_after_hours: 6,
    },
  }
  mkdirSync(path.join(dir, 'demo-project'), { recursive: true })
  writeFileSync(path.join(dir, 'config.yaml'), stringify(config), 'utf8')
  return path.relative(repoRoot(), path.join(dir, 'config.yaml')).split(path.sep).join('/')
}

test('значение не попадает в ответ конфига, бота, чата и журнал', async () => {
  useOsSecretReader(() => FROM_STORE)
  process.env[NAME] = FROM_ENV
  let authorization = ''
  const mock = http.createServer((req, res) => {
    authorization = req.headers.authorization ?? ''
    res.end(JSON.stringify({ choices: [{ message: { content: `эхо ${FROM_STORE}` } }] }))
  })
  await new Promise<void>((resolve) => {
    mock.listen(0, '127.0.0.1', () => resolve())
  })
  const address = mock.address()
  const port = address && typeof address === 'object' ? address.port : 0
  const configPath = project(`http://127.0.0.1:${port}/v1`)
  let server: RunningServer | undefined
  const logs = capture()
  try {
    server = await startServer({ port: 0, configPath })
    const origin = `http://${BIND_HOST}:${server.port}`
    const launcherRes = await fetch(`${origin}/api/launcher`)
    const rosterRes = await fetch(`${origin}/api/roster`)
    const launcherText = await launcherRes.text()
    const rosterText = await rosterRes.text()
    expect(launcherRes.status).toBe(200)
    expect(rosterRes.status).toBe(200)
    expect(launcherText.includes(FROM_STORE)).toBe(false)
    expect(launcherText.includes(FROM_ENV)).toBe(false)
    expect(rosterText.includes(FROM_STORE)).toBe(false)
    expect(rosterText.includes(FROM_ENV)).toBe(false)
    const roster = JSON.parse(rosterText) as { bots: Array<{ name: string; provider: string | null }> }
    expect(roster.bots.some((bot) => bot.name === 'Нора' && bot.provider === 'deepseek')).toBe(true)

    const csrf = (JSON.parse(launcherText) as { csrf?: string }).csrf ?? ''
    const chatRes = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
      },
      body: JSON.stringify({ bot: 'nora', text: 'привет' }),
    })
    const chatText = await chatRes.text()
    expect(chatRes.status).toBe(200)
    expect(authorization).toBe(`Bearer ${FROM_STORE}`)
    expect(chatText.includes(FROM_STORE)).toBe(false)
    expect(chatText.includes(FROM_ENV)).toBe(false)
    expect(chatText.includes('[secret]')).toBe(true)
    const configDir = path.dirname(path.join(repoRoot(), configPath))
    const stored = readFileSync(path.join(configDir, 'chats', 'nora.json'), 'utf8')
    expect(stored.includes(FROM_STORE)).toBe(false)
    expect(stored.includes(FROM_ENV)).toBe(false)
    expect(readFileSync(path.join(configDir, 'config.yaml'), 'utf8').includes(FROM_STORE)).toBe(false)
  } finally {
    logs.stop()
    await server?.close()
    await new Promise<void>((resolve, reject) => {
      mock.close((error) => (error ? reject(error) : resolve()))
    })
  }
  expect(logs.text().includes(FROM_STORE)).toBe(false)
  expect(logs.text().includes(FROM_ENV)).toBe(false)
})
