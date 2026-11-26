/**
 * FILE: apps/server/src/secrets/channel.test.ts
 * НАЗНАЧЕНИЕ: закрытый канал. Значение пишется и больше никуда не выходит.
 * ВХОД: карточка ключа, подмена хранилища и соединения.
 * ВЫХОД: отказ на URL, тело без флага, редирект и частный адрес. Маска и журнал без значения.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { stringify } from 'yaml'
import { configSchema } from '@tinybots/schema'
import { BIND_HOST } from '../bind.js'
import { saveBotTools } from '../config/bot-tools.js'
import { loadConfigAt } from '../config/load.js'
import { resetOsSecretCache, useOsSecretReader, useOsSecretWriter } from '../llm/os-secret.js'
import { systemPrompt } from '../llm/prompt.js'
import { deliverBrief, deliverChat } from '../llm/turn.js'
import { createProposal } from '../proposals/engine.js'
import { forgetSecrets, rememberSecret } from '../redact.js'
import { repoRoot } from '../root.js'
import { startServer, type RunningServer } from '../server.js'
import { writeChat, writeNote } from '../llm/store.js'
import { SECRET_LOOKS_LIKE, SECRET_MASK_MIN, maskClosedChannel, maskParts } from './mask.js'
import { writeSecretFile } from './meta.js'
import { resetSecretRate, runHttpRequest, useSecretTransport, type SecretDialResult } from './request.js'

const VALUE = 'channel-canary-value'
const NAME = 'PARTNER'
const dirs: string[] = []

afterEach(() => {
  useOsSecretReader(null)
  useOsSecretWriter(null)
  useSecretTransport(null)
  resetOsSecretCache()
  resetSecretRate()
  forgetSecrets()
  delete process.env.DEEPSEEK_API_KEY
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function memory(store: Map<string, string>): void {
  useOsSecretReader((name) => store.get(name) ?? null)
  useOsSecretWriter(async (name, value, replace) => {
    const current = store.get(name)
    if (current && current.trim().length > 0 && !replace) {
      return 'exists'
    }
    store.set(name, value)
    return 'ok'
  })
}

function box(): string {
  mkdirSync(path.join(repoRoot(), 'data'), { recursive: true })
  const dir = mkdtempSync(path.join(repoRoot(), 'data', 'vitest-channel-'))
  dirs.push(dir)
  return dir
}

function configText(baseUrl: string): Record<string, unknown> {
  return {
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
      base_url: baseUrl,
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
}

async function card(dir: string, body = false, bots = ['nora']): Promise<void> {
  const saved = await writeSecretFile(dir, {
    name: NAME,
    description: 'ключ партнёра',
    header: 'Authorization: Bearer',
    body,
    allow: [{ host: 'example.com', methods: ['GET', 'POST'] }],
    bots,
  }, new Date('2026-11-26T12:00:00.000Z'))
  expect(saved).not.toBeNull()
}

function call(url: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ url, method: 'GET', ...extra })
}

test('маска закрывает буквальное значение и кодировки, короче порога не трогает', () => {
  expect(SECRET_MASK_MIN).toBe(8)
  const short = 'short'
  expect(maskClosedChannel(short, [short])).toBe(short)
  const forms = [
    VALUE,
    Buffer.from(VALUE).toString('base64'),
    Buffer.from(`user:${VALUE}`).toString('base64'),
    encodeURIComponent(VALUE),
    Buffer.from(VALUE).toString('hex'),
    JSON.stringify(VALUE).slice(1, -1),
  ]
  for (const form of forms) {
    expect(maskClosedChannel(`до ${form} после`, [VALUE]).includes(form)).toBe(false)
  }
  expect(maskClosedChannel(`смотри {{secret:${NAME}}}`, [])).toBe('смотри [secret]')
  const split = maskParts([`aa${VALUE.slice(0, 6)}`, `${VALUE.slice(6)}zz`], [VALUE]).join('')
  expect(split.includes(VALUE)).toBe(false)
  expect(split.includes('[secret]')).toBe(true)
})

test('маска закрывает кодировки, куски от 8 символов и отказ, если кусок нельзя вырезать', () => {
  const sample = 'abcd/efgh+ijkl/mnop+qrstuvwx'
  expect(sample.includes('/')).toBe(true)
  expect(sample.includes('+')).toBe(true)
  const unicode = sample.replace(/[^A-Za-z0-9]/gu, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
  const wrapped = Buffer.from(`${sample}${sample}${sample}`, 'utf8').toString('base64').replace(/(.{76})/gu, '$1\n')
  const forms = [
    sample.replaceAll('/', '\\/'),
    unicode,
    encodeURIComponent(sample).replace(/%[0-9A-F]{2}/gu, (item) => item.toLowerCase()),
    wrapped,
    sample.slice(0, Math.ceil(sample.length / 2)),
    sample.slice(Math.floor(sample.length / 2)),
  ]
  for (const form of forms) {
    const masked = maskClosedChannel(`до ${form} после`, [sample])
    expect(masked.includes(form), form).toBe(false)
    expect(masked.includes(sample), form).toBe(false)
    expect(masked.includes('[secret]'), form).toBe(true)
  }
  const torn = sample.split('').join(' ')
  expect(maskClosedChannel(torn, [sample])).toBe(SECRET_LOOKS_LIKE)
  const reversed = [...sample].reverse().join('')
  const revMasked = maskClosedChannel(`до ${reversed} после`, [sample])
  expect(revMasked.includes(reversed)).toBe(false)
  expect(revMasked.includes(sample)).toBe(false)
  expect(maskClosedChannel('обычный ответ сервера', [sample])).toBe('обычный ответ сервера')
})

test('http_request: url, тело без флага, чужой бот и неизвестное имя', async () => {
  const dir = box()
  const store = new Map<string, string>([[NAME, VALUE]])
  memory(store)
  await card(dir, false)
  let dialed = 0
  useSecretTransport({
    lookup: async () => ['1.1.1.1'],
    dial: async () => {
      dialed += 1
      return { status: 200, headers: '', body: 'ok' }
    },
  })
  const url = await runHttpRequest({
    dataDir: dir,
    botId: 'nora',
    argsText: call(`https://example.com/{{secret:${NAME}}}`),
  })
  expect(url).toContain('секрет в url')
  const body = await runHttpRequest({
    dataDir: dir,
    botId: 'nora',
    argsText: call('https://example.com/v1', {
      headers: { Authorization: `Bearer {{secret:${NAME}}}` },
      body: `token={{secret:${NAME}}}`,
    }),
  })
  expect(body).toContain('секрет в теле')
  const stranger = await runHttpRequest({
    dataDir: dir,
    botId: 'other',
    argsText: call('https://example.com/v1', { headers: { Authorization: `Bearer {{secret:${NAME}}}` } }),
  })
  expect(stranger).toContain('нет доступа')
  const missing = await runHttpRequest({
    dataDir: dir,
    botId: 'nora',
    argsText: call('https://example.com/v1', { headers: { Authorization: 'Bearer {{secret:NOPE}}' } }),
  })
  expect(missing).toContain('нет доступа')
  expect(dialed).toBe(0)
  expect(url.includes(VALUE) || body.includes(VALUE) || stranger.includes(VALUE)).toBe(false)
})

test('приватный адрес, userinfo, редирект и закреплённый IP', async () => {
  const dir = box()
  memory(new Map([[NAME, VALUE]]))
  await card(dir, false)
  const dials: string[] = []
  useSecretTransport({
    lookup: async () => ['169.254.169.254'],
    dial: async (input) => {
      dials.push(input.pinned)
      return { status: 200, headers: '', body: VALUE }
    },
  })
  const linkLocal = await runHttpRequest({
    dataDir: dir,
    botId: 'nora',
    argsText: call('https://example.com/latest', { headers: { Authorization: `Bearer {{secret:${NAME}}}` } }),
  })
  expect(linkLocal).toContain('адрес не публичный')
  expect(dials).toEqual([])

  useSecretTransport({
    lookup: async () => ['10.0.0.8', '1.1.1.1'],
    dial: async () => {
      throw new Error('не должны сюда')
    },
  })
  const splitHorizon = await runHttpRequest({
    dataDir: dir,
    botId: 'nora',
    argsText: call('https://example.com/latest', { headers: { Authorization: `Bearer {{secret:${NAME}}}` } }),
  })
  expect(splitHorizon).toContain('адрес не публичный')

  const userinfo = await runHttpRequest({
    dataDir: dir,
    botId: 'nora',
    argsText: call(`https://a@example.com/v1`, { headers: { Authorization: `Bearer {{secret:${NAME}}}` } }),
  })
  expect(userinfo).toContain('логин или пароль')

  useSecretTransport({
    lookup: async () => ['1.1.1.1'],
    dial: async (input) => {
      dials.push(input.pinned)
      expect(input.headers.Authorization).toBe(`Bearer ${VALUE}`)
      return { status: 302, headers: `location: https://evil/${VALUE}`, body: VALUE }
    },
  })
  const redirect = await runHttpRequest({
    dataDir: dir,
    botId: 'nora',
    argsText: call('https://example.com/v1', { headers: { Authorization: `Bearer {{secret:${NAME}}}` } }),
  })
  expect(redirect).toContain('редирект запрещён')
  expect(redirect.includes(VALUE)).toBe(false)
  expect(dials).toEqual(['1.1.1.1'])

  useSecretTransport({
    lookup: async () => ['1.1.1.1'],
    dial: async () => ({
      status: 200,
      headers: `x:${VALUE.slice(0, 8)}`,
      body: `${VALUE.slice(8)} ${Buffer.from(VALUE).toString('base64')} ${Buffer.from(VALUE).toString('hex')}`,
    } satisfies SecretDialResult),
  })
  const ok = await runHttpRequest({
    dataDir: dir,
    botId: 'nora',
    argsText: call('https://example.com/v1', { headers: { Authorization: `Bearer {{secret:${NAME}}}` } }),
  })
  expect(ok.includes(VALUE)).toBe(false)
  expect(ok.includes(Buffer.from(VALUE).toString('base64'))).toBe(false)
  expect(ok.includes('[secret]')).toBe(true)
  const journal = readFileSync(path.join(dir, 'secrets', 'journal.jsonl'), 'utf8')
  expect(journal.includes(VALUE)).toBe(false)
  expect(journal.includes(NAME)).toBe(true)
  expect(journal.includes('example.com')).toBe(true)
  expect(process.env.PARTNER).toBeUndefined()
})

test('частота одного ключа, один проход и тело только с флагом', async () => {
  const dir = box()
  const nested = `{{secret:OTHER}}`
  memory(new Map([[NAME, nested]]))
  await card(dir, true)
  const bodies: string[] = []
  useSecretTransport({
    lookup: async () => ['1.1.1.1'],
    dial: async (input) => {
      bodies.push(input.body ?? '')
      return { status: 200, headers: '', body: 'ok' }
    },
  })
  const sent = await runHttpRequest({
    dataDir: dir,
    botId: 'nora',
    argsText: call('https://example.com/v1', {
      method: 'POST',
      headers: { Authorization: `Bearer {{secret:${NAME}}}` },
      body: `go {{secret:${NAME}}}`,
    }),
  })
  expect(sent.includes('ok')).toBe(true)
  expect(bodies[0]).toBe(`go ${nested}`)
  expect(bodies[0]?.includes('{{secret:OTHER}}')).toBe(true)
  for (let index = 0; index < 9; index += 1) {
    await runHttpRequest({
      dataDir: dir,
      botId: 'nora',
      argsText: call('https://example.com/v1', { headers: { Authorization: `Bearer {{secret:${NAME}}}` } }),
      now: 1_000,
    })
  }
  const limited = await runHttpRequest({
    dataDir: dir,
    botId: 'nora',
    argsText: call('https://example.com/v1', { headers: { Authorization: `Bearer {{secret:${NAME}}}` } }),
    now: 1_000,
  })
  expect(limited).toContain('слишком часто')
  expect(bodies).toHaveLength(10)
})

test('GET не возвращает значение, POST пишет его, бот и config.yaml политику не меняют', async () => {
  const dir = box()
  mkdirSync(path.join(dir, 'demo-project'), { recursive: true })
  const store = new Map<string, string>()
  memory(store)
  const config = configText('http://127.0.0.1:9/v1')
  writeFileSync(path.join(dir, 'config.yaml'), stringify(config), 'utf8')
  const configPath = path.relative(repoRoot(), path.join(dir, 'config.yaml')).split(path.sep).join('/')
  const dirty = { ...config, secrets: [{ name: NAME, allow: [{ host: '*.evil.com', methods: ['GET'] }] }] }
  expect(configSchema.safeParse(dirty).success).toBe(false)
  expect(loadConfigAt(repoRoot(), configPath).ok).toBe(true)
  const tools = await saveBotTools(repoRoot(), { configPath }, {
    bot_id: 'nora',
    project_id: 'demo-keys',
    allow_bot_tools: false,
    respect_gitignore: true,
    allow: [{ host: 'evil.com', methods: ['GET'] }],
    bots: ['nora'],
  })
  expect(tools.status).toBe(422)
  let server: RunningServer | undefined
  try {
    server = await startServer({ port: 0, configPath })
    const origin = `http://${BIND_HOST}:${server.port}`
    const opened = await fetch(`${origin}/api/launcher`)
    const csrf = ((await opened.json()) as { csrf?: string }).csrf ?? ''
    const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }
    const tooShort = await fetch(`${origin}/api/secrets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: NAME,
        description: 'ключ партнёра',
        header: 'Authorization: Bearer',
        body: false,
        allow: [{ host: 'example.com', methods: ['GET'] }],
        bots: ['nora'],
        value: 'short12',
      }),
    })
    expect(tooShort.status).toBe(422)
    expect(await tooShort.text()).toContain('short')
    expect(store.has(NAME)).toBe(false)
    const saved = await fetch(`${origin}/api/secrets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: NAME,
        description: 'ключ партнёра',
        header: 'Authorization: Bearer',
        body: false,
        allow: [{ host: 'пример.рф', methods: ['GET'] }],
        bots: ['nora'],
        value: VALUE,
      }),
    })
    const savedText = await saved.text()
    expect(saved.status).toBe(200)
    expect(savedText.includes(VALUE)).toBe(false)
    expect(store.get(NAME)).toBe(VALUE)
    const puny = new URL('https://пример.рф').hostname
    expect(savedText.includes(puny)).toBe(true)
    const listed = await fetch(`${origin}/api/secrets`)
    const listedText = await listed.text()
    expect(listedText.includes(VALUE)).toBe(false)
    expect(listedText).toContain('"set":true')
    const file = readFileSync(path.join(dir, 'secrets', 'keys', `${NAME}.json`), 'utf8')
    expect(file.includes(VALUE)).toBe(false)
    const replaced = await fetch(`${origin}/api/secrets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: NAME,
        description: 'ключ партнёра',
        header: 'Authorization: Bearer',
        body: false,
        allow: [{ host: 'example.com', methods: ['GET'] }],
        bots: ['nora'],
        value: `${VALUE}-2`,
      }),
    })
    expect(replaced.status).toBe(409)
    expect(store.get(NAME)).toBe(VALUE)
    const star = await fetch(`${origin}/api/secrets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'OTHER',
        description: 'нет',
        header: 'X-Api-Key',
        allow: [{ host: '*.example.com', methods: ['GET'] }],
        bots: ['nora'],
        value: VALUE,
      }),
    })
    expect(star.status).toBe(422)
    const cross = await fetch(`${origin}/api/secrets`, {
      method: 'POST',
      headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ name: 'OTHER', description: 'нет', header: 'X-Api-Key', allow: [{ host: 'example.com', methods: ['GET'] }], bots: [] }),
    })
    expect(cross.status).toBe(403)
    const sameSite = await fetch(`${origin}/api/secrets`, {
      method: 'POST',
      headers: { ...headers, 'Sec-Fetch-Site': 'same-site' },
      body: JSON.stringify({ name: 'OTHER', description: 'нет', header: 'X-Api-Key', allow: [{ host: 'example.com', methods: ['GET'] }], bots: [] }),
    })
    expect(sameSite.status).toBe(403)
    const removed = await fetch(`${origin}/api/secrets`, { method: 'DELETE', headers })
    expect(removed.status).toBe(405)
    expect(store.has(NAME)).toBe(true)
  } finally {
    await server?.close()
  }
})

test('значение и ссылка не оседают в промпте, ответе, предложении, брифе, записке, журнале и чате', async () => {
  const prompt = systemPrompt({
    role: 'справка',
    instructions: 'Коротко.',
    rulesBase: 'правила',
    replyLimit: 'short',
    secrets: [{ name: NAME, description: 'ключ партнёра' }],
  })
  expect(prompt).toContain(`{{secret:${NAME}}}`)
  expect(prompt).toContain('ключ партнёра')
  expect(prompt.includes(VALUE)).toBe(false)

  const dir = box()
  mkdirSync(path.join(dir, 'demo-project'), { recursive: true })
  mkdirSync(path.join(dir, 'tasks'), { recursive: true })
  memory(new Map([[NAME, VALUE]]))
  await card(dir, false)
  rememberSecret(VALUE)
  writeFileSync(path.join(dir, 'tasks', 'task-01.yaml'), stringify({
    schema_version: 1,
    updated_at: '2026-11-26T12:00:00.000Z',
    id: 'task-01',
    project: 'demo-keys',
    chat: 'build',
    assignee: 'nora',
    goal: `Цель ${VALUE} {{secret:${NAME}}}`,
    inputs: [],
    output: 'записка',
    done_when: 'готово',
    out_of_scope: 'нет',
    reply_limit: 'short',
    due: '2026-11-27',
    status: 'working',
  }), 'utf8')
  const config = configText('http://127.0.0.1:9/v1')
  writeFileSync(path.join(dir, 'config.yaml'), stringify(config), 'utf8')
  const configPath = path.relative(repoRoot(), path.join(dir, 'config.yaml')).split(path.sep).join('/')
  process.env.DEEPSEEK_API_KEY = 'model-key-canary-value'
  const bodies: string[] = []
  const fetchImpl: typeof fetch = async (_url, init) => {
    const payload = String(init?.body ?? '')
    bodies.push(payload)
    expect(payload.includes(VALUE)).toBe(false)
    const note = {
      schema_version: 1,
      updated_at: '2026-11-26T12:00:00.000Z',
      task_id: 'task-01',
      state: 'working',
      links: ['https://example.com'],
      verified: 'да',
      not_done: VALUE,
      question_to_owner: `{{secret:${NAME}}}`,
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(note) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const brief = await deliverBrief({
    root: repoRoot(),
    options: { configPath },
    projectId: 'demo-keys',
    chatId: 'build',
    taskId: 'task-01',
    deps: { fetchImpl, lookup: async () => ['127.0.0.1'] },
  })
  expect(brief.ok).toBe(true)
  if (brief.ok) {
    expect(brief.reply.includes(VALUE)).toBe(false)
    expect(brief.reply.includes(`{{secret:${NAME}}}`)).toBe(false)
    expect(brief.text?.includes(VALUE)).toBe(false)
  }
  const chat = readFileSync(path.join(dir, 'chats', 'nora.json'), 'utf8')
  const note = readFileSync(path.join(dir, 'status', 'nora.json'), 'utf8')
  expect(chat.includes(VALUE)).toBe(false)
  expect(chat.includes(`{{secret:${NAME}}}`)).toBe(false)
  expect(note.includes(VALUE)).toBe(false)
  expect(note.includes(`{{secret:${NAME}}}`)).toBe(false)
  expect(bodies[0]?.includes(`{{secret:${NAME}}}`)).toBe(true)

  const proposed = await createProposal({
    projectReal: dir,
    dataDir: dir,
    dataReal: dir,
    launcherCwd: repoRoot(),
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary: `правка {{secret:${NAME}}} ${VALUE}`,
    diff: `--- a/note.txt\n+++ b/note.txt\n${VALUE}\n`,
    now: new Date(),
  })
  expect(proposed).toEqual({ ok: false, error: 'секрет в предложении' })

  await writeChat(dir, 'nora', [{ role: 'assistant', text: `${VALUE} {{secret:${NAME}}}`, at: '2026-11-26T12:00:00.000Z' }], new Date())
  expect(readFileSync(path.join(dir, 'chats', 'nora.json'), 'utf8').includes(VALUE)).toBe(false)
  await writeNote(dir, 'mira', {
    schema_version: 1,
    updated_at: '2026-11-26T12:00:00.000Z',
    task_id: 'task-01',
    state: 'working',
    links: [VALUE],
    verified: VALUE,
    not_done: `{{secret:${NAME}}}`,
    question_to_owner: 'нет',
  })
  const second = readFileSync(path.join(dir, 'status', 'mira.json'), 'utf8')
  expect(second.includes(VALUE)).toBe(false)
  expect(second.includes(`{{secret:${NAME}}}`)).toBe(false)

  const chatTurn = await deliverChat({
    root: repoRoot(),
    options: { configPath },
    botId: 'nora',
    text: `скажи ${VALUE}`,
    projectId: 'demo-keys',
    chatId: 'build',
    deps: {
      lookup: async () => ['127.0.0.1'],
      fetchImpl: async (_url, init) => {
        const payload = String(init?.body ?? '')
        expect(payload.includes(VALUE)).toBe(false)
        expect(payload.includes('http_request')).toBe(true)
        return new Response(JSON.stringify({
          choices: [{ message: { content: `эхо ${VALUE}` } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }), { status: 200 })
      },
    },
  })
  expect(chatTurn.ok).toBe(true)
  if (chatTurn.ok) {
    expect(chatTurn.reply.includes(VALUE)).toBe(false)
  }
})
