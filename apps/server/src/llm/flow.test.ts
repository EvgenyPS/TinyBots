/**
 * FILE: apps/server/src/llm/flow.test.ts
 * НАЗНАЧЕНИЕ: H3, H8–H12 и H14 на своих ботах.
 * Мок вместо провайдера. Записка со status done и script не двигает задачу.
 * Два параллельных пробуждения при счётчике 2 доходят до мока один раз.
 */

import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { stringify } from 'yaml'
import { afterEach, expect, test } from 'vitest'
import { BIND_HOST } from '../bind.js'
import { repoRoot } from '../root.js'
import { startServer, type RunningServer } from '../server.js'
import { deliverBrief, deliverChat } from './turn.js'
import { noteBytes, readTask, readWakeCount } from './store.js'

const KEY = 'demo-deepseek-key'
const FILE_CANARY = 'CANARY_FILE_BODY'
const CHAT_CANARY = 'CANARY_OTHER_CHAT'
const dirs: string[] = []

afterEach(() => {
  delete process.env.DEEPSEEK_API_KEY
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function project(baseUrl: string, model = 'deepseek-chat', paused = false): { dir: string; configPath: string } {
  mkdirSync(path.join(repoRoot(), 'data'), { recursive: true })
  const dir = mkdtempSync(path.join(repoRoot(), 'data', 'vitest-llm-'))
  dirs.push(dir)
  mkdirSync(path.join(dir, 'tasks'), { recursive: true })
  mkdirSync(path.join(dir, 'demo-project'), { recursive: true })
  writeFileSync(path.join(dir, 'demo-project', 'secret.txt'), FILE_CANARY, 'utf8')
  mkdirSync(path.join(dir, 'chats'), { recursive: true })
  writeFileSync(path.join(dir, 'chats', 'bitk.json'), JSON.stringify({ text: CHAT_CANARY }), 'utf8')
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
        instructions: 'Отвечай по карточке.',
        provider: 'deepseek',
        model,
        base_url: baseUrl,
        api_key_env: 'DEEPSEEK_API_KEY',
        ...(paused ? { paused: true } : {}),
      },
      { id: 'bitk', name: 'Бит', role: 'код', grok_id: 'demo-bit', executor_for_merge: true },
    ],
    projects: [{
      id: 'demo-keys',
      title: 'Demo Keys',
      lead: 'nora',
      owner: 'owner',
      merge_executor: 'bitk',
      source: { files: { path: 'demo-project' } },
      chats: [{
        id: 'build',
        title: 'Сборка',
        lead: 'nora',
        members: ['nora', 'bitk'],
        rules: { do: 'код', dont: 'чужие чаты' },
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
  writeFileSync(path.join(dir, 'tasks', 'task-01.yaml'), stringify({
    schema_version: 1,
    updated_at: '2026-11-19T09:15:00Z',
    id: 'task-01',
    project: 'demo-keys',
    chat: 'build',
    assignee: 'nora',
    goal: 'Собрать справку',
    inputs: [{ kind: 'path', value: 'src/app.txt' }],
    output: 'короткая записка',
    done_when: 'записка на месте',
    out_of_scope: 'чужие чаты и файлы',
    reply_limit: 'short',
    due: '2026-11-20',
    status: 'working',
  }), 'utf8')
  return { dir, configPath: path.relative(repoRoot(), path.join(dir, 'config.yaml')).split(path.sep).join('/') }
}

function localLookup(): Promise<string[]> {
  return Promise.resolve(['127.0.0.1'])
}

test('записка со status done и script не закрывает задачу и не портит прежний файл', async () => {
  process.env.DEEPSEEK_API_KEY = KEY
  const made = project('http://127.0.0.1:9/v1')
  const prior = `${JSON.stringify({
    schema_version: 1,
    updated_at: '2026-11-19T09:15:00Z',
    task_id: 'task-01',
    state: 'working',
    links: [],
    verified: 'было',
    not_done: '',
    question_to_owner: '',
  }, null, 2)}\n`
  mkdirSync(path.join(made.dir, 'status'), { recursive: true })
  writeFileSync(path.join(made.dir, 'status', 'nora.json'), prior, 'utf8')
  mkdirSync(path.join(made.dir, 'merge_requests'), { recursive: true })
  const merge = `${JSON.stringify({
    schema_version: 1,
    updated_at: '2026-11-19T09:15:00Z',
    project: 'demo-keys',
    pr_url: 'https://example.invalid/demo/pull/1',
    head_sha: '0123456789abcdef0123456789abcdef01234567',
    tasks: ['task-01'],
    checks: 'green',
    summary: 'Черновик',
    state: 'awaiting_owner',
    history: [{ state: 'awaiting_owner', at: '2026-11-19T09:15:00Z', by: 'nora', why: 'старт' }],
    affected_chats: ['build'],
    owner: 'owner',
    lead: 'nora',
  })}\n`
  writeFileSync(path.join(made.dir, 'merge_requests', 'mr-01.json'), merge, 'utf8')
  const junk = JSON.stringify({
    schema_version: 1,
    updated_at: '2026-11-19T10:00:00.000Z',
    task_id: 'task-01',
    state: 'working',
    status: 'done',
    links: [],
    verified: '<script>alert(1)</script>',
    not_done: 'javascript:alert(1)',
    question_to_owner: '',
  })
  let body = ''
  const first = await deliverBrief({
    root: repoRoot(),
    options: { configPath: made.configPath },
    projectId: 'demo-keys',
    chatId: 'build',
    taskId: 'task-01',
    deps: {
      lookup: localLookup,
      env: process.env,
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        body = String(init?.body)
        return new Response(JSON.stringify({ choices: [{ message: { content: junk } }] }), { status: 200 })
      }) as typeof fetch,
    },
  })
  expect(first.ok).toBe(true)
  if (first.ok) {
    expect(first.reply.includes('<script>')).toBe(true)
    expect(first.reply.includes('javascript:')).toBe(true)
    expect(first.note).toBe('rejected')
    expect(first.reply.includes(KEY)).toBe(false)
  }
  expect(noteBytes(made.dir, 'nora')).toBe(prior)
  expect(readTask(made.dir, 'task-01')?.status).toBe('working')
  expect(readTask(made.dir, 'task-01')?.assignee).toBe('nora')
  expect(readFileSync(path.join(made.dir, 'config.yaml'), 'utf8').includes('lead: nora')).toBe(true)
  expect(readFileSync(path.join(made.dir, 'merge_requests', 'mr-01.json'), 'utf8')).toBe(merge)
  expect(body.includes(FILE_CANARY)).toBe(false)
  expect(body.includes(CHAT_CANARY)).toBe(false)
  expect(body.includes('Базовые правила включены всегда')).toBe(true)
  expect(body.includes('выключить их нельзя')).toBe(true)
  expect(body.includes('не больше 6 строк')).toBe(true)
  expect(JSON.parse(body).stream).toBe(false)

  const valid = JSON.stringify({
    schema_version: 1,
    updated_at: '2026-11-19T10:05:00.000Z',
    task_id: 'task-01',
    state: 'done',
    links: [],
    verified: '<script>alert(1)</script>',
    not_done: '',
    question_to_owner: '',
  })
  const second = await deliverBrief({
    root: repoRoot(),
    options: { configPath: made.configPath },
    projectId: 'demo-keys',
    chatId: 'build',
    taskId: 'task-01',
    deps: {
      lookup: localLookup,
      env: process.env,
      fetchImpl: (async () => new Response(JSON.stringify({
        choices: [{ message: { content: valid } }],
        usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
      }), { status: 200 })) as typeof fetch,
    },
  })
  expect(second.ok).toBe(true)
  if (second.ok) {
    expect(second.note).toBe('saved')
    expect(second.usage_label).toBe('prompt 4 · completion 5')
  }
  expect(readTask(made.dir, 'task-01')?.status).toBe('working')
  expect(readTask(made.dir, 'task-01')?.assignee).toBe('nora')
  const written = noteBytes(made.dir, 'nora') ?? ''
  expect(written.includes('<script>alert(1)</script>')).toBe(true)
  expect(written.includes(KEY)).toBe(false)
  expect(readFileSync(path.join(made.dir, 'merge_requests', 'mr-01.json'), 'utf8')).toBe(merge)
})

test('пауза и четвёртое пробуждение не доходят до мока', async () => {
  process.env.DEEPSEEK_API_KEY = KEY
  const paused = project('http://127.0.0.1:9/v1', 'deepseek-chat', true)
  let hits = 0
  const held = await deliverBrief({
    root: repoRoot(),
    options: { configPath: paused.configPath },
    projectId: 'demo-keys',
    chatId: 'build',
    taskId: 'task-01',
    deps: {
      lookup: localLookup,
      fetchImpl: (async () => {
        hits += 1
        return new Response('{}', { status: 200 })
      }) as typeof fetch,
    },
  })
  expect(held.ok).toBe(false)
  expect(hits).toBe(0)

  const limited = project('http://127.0.0.1:9/v1')
  mkdirSync(path.join(limited.dir, 'wakes'), { recursive: true })
  writeFileSync(path.join(limited.dir, 'wakes', 'task-01.json'), JSON.stringify({
    schema_version: 1,
    updated_at: '2026-11-19T09:00:00.000Z',
    task_id: 'task-01',
    count: 3,
  }), 'utf8')
  const blocked = await deliverBrief({
    root: repoRoot(),
    options: { configPath: limited.configPath },
    projectId: 'demo-keys',
    chatId: 'build',
    taskId: 'task-01',
    deps: {
      lookup: localLookup,
      fetchImpl: (async () => {
        hits += 1
        return new Response('{}', { status: 200 })
      }) as typeof fetch,
    },
  })
  expect(blocked.ok).toBe(false)
  if (!blocked.ok) {
    expect(blocked.error).toBe('wake_limit')
  }
  expect(hits).toBe(0)
  expect(readWakeCount(limited.dir, 'task-01')).toBe(3)
  expect(readTask(limited.dir, 'task-01')?.status).toBe('blocked')
  expect(readTask(limited.dir, 'task-01')?.assignee).toBe('nora')
})

test('два параллельных пробуждения при счётчике 2 доходят до мока один раз', async () => {
  process.env.DEEPSEEK_API_KEY = KEY
  const made = project('http://127.0.0.1:9/v1')
  mkdirSync(path.join(made.dir, 'wakes'), { recursive: true })
  writeFileSync(path.join(made.dir, 'wakes', 'task-01.json'), JSON.stringify({
    schema_version: 1,
    updated_at: '2026-11-19T09:00:00.000Z',
    task_id: 'task-01',
    count: 2,
  }), 'utf8')
  let hits = 0
  const fetchImpl = (async () => {
    hits += 1
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ок' } }] }), { status: 200 })
  }) as typeof fetch
  await Promise.all([
    deliverBrief({
      root: repoRoot(),
      options: { configPath: made.configPath },
      projectId: 'demo-keys',
      chatId: 'build',
      taskId: 'task-01',
      deps: { lookup: localLookup, fetchImpl },
    }),
    deliverBrief({
      root: repoRoot(),
      options: { configPath: made.configPath },
      projectId: 'demo-keys',
      chatId: 'build',
      taskId: 'task-01',
      deps: { lookup: localLookup, fetchImpl },
    }),
  ])
  expect(hits).toBe(1)
  expect(readWakeCount(made.dir, 'task-01')).toBe(3)
})

test('смена модели видна со следующего запроса', async () => {
  process.env.DEEPSEEK_API_KEY = KEY
  const made = project('http://127.0.0.1:9/v1', 'deepseek-chat')
  const models: string[] = []
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    models.push(JSON.parse(String(init?.body)).model as string)
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ок' } }] }), { status: 200 })
  }) as typeof fetch
  await deliverBrief({
    root: repoRoot(),
    options: { configPath: made.configPath },
    projectId: 'demo-keys',
    chatId: 'build',
    taskId: 'task-01',
    deps: { lookup: localLookup, fetchImpl },
  })
  const raw = readFileSync(path.join(made.dir, 'config.yaml'), 'utf8')
  writeFileSync(path.join(made.dir, 'config.yaml'), raw.replace('deepseek-chat', 'qwen-plus'), 'utf8')
  await deliverBrief({
    root: repoRoot(),
    options: { configPath: made.configPath },
    projectId: 'demo-keys',
    chatId: 'build',
    taskId: 'task-01',
    deps: { lookup: localLookup, fetchImpl },
  })
  expect(models).toEqual(['deepseek-chat', 'qwen-plus'])
})

test('ключ в реплике и в ответе мока прячется в API и в файле чата', async () => {
  process.env.DEEPSEEK_API_KEY = KEY
  const made = project('http://127.0.0.1:9/v1')
  const fetchImpl = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: `ответ ${KEY}` } }],
  }), { status: 200 })) as typeof fetch
  const chat = await deliverChat({
    root: repoRoot(),
    options: { configPath: made.configPath },
    botId: 'nora',
    text: `вопрос ${KEY}`,
    projectId: 'demo-keys',
    chatId: 'build',
    deps: { lookup: localLookup, env: process.env, fetchImpl },
  })
  expect(chat.ok).toBe(true)
  if (chat.ok) {
    expect(chat.reply.includes(KEY)).toBe(false)
    expect(chat.reply.includes('[secret]')).toBe(true)
    expect(chat.messages.some((message) => message.text.includes(KEY))).toBe(false)
    expect(chat.messages.some((message) => message.role === 'user' && message.text.includes('[secret]'))).toBe(true)
    expect(chat.messages.some((message) => message.role === 'assistant' && message.text.includes('[secret]'))).toBe(true)
  }
  const chatFile = readFileSync(path.join(made.dir, 'chats', 'nora.json'), 'utf8')
  expect(chatFile.includes(KEY)).toBe(false)
  expect(chatFile.includes('[secret]')).toBe(true)

  const brief = await deliverBrief({
    root: repoRoot(),
    options: { configPath: made.configPath },
    projectId: 'demo-keys',
    chatId: 'build',
    taskId: 'task-01',
    deps: { lookup: localLookup, env: process.env, fetchImpl },
  })
  expect(brief.ok).toBe(true)
  if (brief.ok) {
    expect(brief.reply.includes(KEY)).toBe(false)
    expect(brief.reply.includes('[secret]')).toBe(true)
  }
  const afterBrief = readFileSync(path.join(made.dir, 'chats', 'nora.json'), 'utf8')
  expect(afterBrief.includes(KEY)).toBe(false)
})

test('H14: same-site и cross-site не вызывают модель', async () => {
  process.env.DEEPSEEK_API_KEY = KEY
  let hits = 0
  const mock = http.createServer((req, res) => {
    if (req.method === 'POST') {
      hits += 1
    }
    res.end(JSON.stringify({ choices: [{ message: { content: 'ок' } }] }))
  })
  await new Promise<void>((resolve) => {
    mock.listen(0, '127.0.0.1', () => resolve())
  })
  const address = mock.address()
  const mockPort = address && typeof address === 'object' ? address.port : 0
  const made = project(`http://127.0.0.1:${mockPort}/v1`)
  let server: RunningServer | undefined
  try {
    server = await startServer({ port: 0, configPath: made.configPath })
    const origin = `http://${BIND_HOST}:${server.port}`
    const launcher = await fetch(`${origin}/api/launcher`)
    const csrf = ((await launcher.json()) as { csrf?: string }).csrf ?? ''
    async function send(site: string | undefined): Promise<number> {
      const headers: Record<string, string> = {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
      }
      if (site !== undefined) {
        headers['Sec-Fetch-Site'] = site
      }
      const res = await fetch(`${origin}/api/brief/send`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ project: 'demo-keys', chat: 'build', task: 'task-01' }),
      })
      return res.status
    }
    hits = 0
    expect(await send('same-site')).toBe(403)
    expect(hits).toBe(0)
    expect(await send('cross-site')).toBe(403)
    expect(hits).toBe(0)
    for (const site of ['same-origin', 'none', undefined]) {
      const before = hits
      expect(await send(site)).toBe(200)
      expect(hits).toBe(before + 1)
    }
  } finally {
    await server?.close()
    await new Promise<void>((resolve) => {
      mock.close(() => resolve())
    })
  }
})

test('H14: чат и бриф без токена, с чужим токеном и без Origin не вызывают модель', async () => {
  process.env.DEEPSEEK_API_KEY = KEY
  let hits = 0
  const mock = http.createServer((req, res) => {
    if (req.method === 'POST') {
      hits += 1
    }
    res.end(JSON.stringify({ choices: [{ message: { content: 'ок' } }] }))
  })
  await new Promise<void>((resolve) => {
    mock.listen(0, '127.0.0.1', () => resolve())
  })
  const address = mock.address()
  const mockPort = address && typeof address === 'object' ? address.port : 0
  const made = project(`http://127.0.0.1:${mockPort}/v1`)
  let server: RunningServer | undefined
  try {
    server = await startServer({ port: 0, configPath: made.configPath })
    const origin = `http://${BIND_HOST}:${server.port}`
    const launcher = await fetch(`${origin}/api/launcher`)
    const csrf = ((await launcher.json()) as { csrf?: string }).csrf ?? ''
    expect(csrf.length).toBeGreaterThan(10)
    const routes = [
      { path: '/api/chat', body: { bot: 'nora', text: 'привет', project: 'demo-keys', chat: 'build' } },
      { path: '/api/brief/send', body: { project: 'demo-keys', chat: 'build', task: 'task-01' } },
    ]
    for (const route of routes) {
      const cases: Array<{ name: string; headers: Record<string, string> }> = [
        { name: 'без токена', headers: { Origin: origin, 'Content-Type': 'application/json' } },
        { name: 'чужой токен', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': 'not-the-token' } },
        { name: 'без Origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } },
      ]
      for (const item of cases) {
        hits = 0
        const res = await fetch(`${origin}${route.path}`, {
          method: 'POST',
          headers: item.headers,
          body: JSON.stringify(route.body),
        })
        expect(res.status, `${route.path} ${item.name}`).toBe(403)
        expect(hits, `${route.path} ${item.name}`).toBe(0)
      }
    }
  } finally {
    await server?.close()
    await new Promise<void>((resolve) => {
      mock.close(() => resolve())
    })
  }
})

test('POST /api/chat на паузе не вызывает модель', async () => {
  process.env.DEEPSEEK_API_KEY = KEY
  let hits = 0
  const mock = http.createServer((req, res) => {
    if (req.method === 'POST') {
      hits += 1
    }
    res.end(JSON.stringify({ choices: [{ message: { content: 'ок' } }] }))
  })
  await new Promise<void>((resolve) => {
    mock.listen(0, '127.0.0.1', () => resolve())
  })
  const address = mock.address()
  const mockPort = address && typeof address === 'object' ? address.port : 0
  const made = project(`http://127.0.0.1:${mockPort}/v1`, 'deepseek-chat', true)
  let server: RunningServer | undefined
  try {
    server = await startServer({ port: 0, configPath: made.configPath })
    const origin = `http://${BIND_HOST}:${server.port}`
    const launcher = await fetch(`${origin}/api/launcher`)
    const csrf = ((await launcher.json()) as { csrf?: string }).csrf ?? ''
    const res = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
      },
      body: JSON.stringify({ bot: 'nora', text: 'привет', project: 'demo-keys', chat: 'build' }),
    })
    expect(res.status).toBe(409)
    expect(hits).toBe(0)
  } finally {
    await server?.close()
    await new Promise<void>((resolve) => {
      mock.close(() => resolve())
    })
  }
})
