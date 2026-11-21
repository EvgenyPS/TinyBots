/**
 * FILE: apps/server/src/tools/turn.test.ts
 * НАЗНАЧЕНИЕ: I1 и I2. Выключенные инструменты не добавляют поле tools.
 * Включённые отдают только чтение, а неизвестное имя не пишет диск.
 */

import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { stringify } from 'yaml'
import { afterEach, expect, test } from 'vitest'
import { repoRoot } from '../root.js'
import { deliverChat } from '../llm/turn.js'

const dirs: string[] = []
afterEach(() => {
  delete process.env.DEEPSEEK_API_KEY
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function place(baseUrl: string, tools: 'off' | 'read' | 'propose', allow: boolean): { dir: string; configPath: string; file: string } {
  mkdirSync(path.join(repoRoot(), 'data'), { recursive: true })
  const dir = mkdtempSync(path.join(repoRoot(), 'data', 'vitest-tools-'))
  dirs.push(dir)
  const file = path.join(dir, 'demo-project', 'note.txt')
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, 'old\n')
  const bot: Record<string, unknown> = {
    id: 'nora',
    name: 'Нора',
    role: 'справка',
    instructions: 'Коротко.',
    provider: 'deepseek',
    model: 'deepseek-chat',
    base_url: baseUrl,
    api_key_env: 'DEEPSEEK_API_KEY',
  }
  if (tools !== 'off') {
    bot.project_tools = tools
  }
  const config = {
    schema_version: 1,
    owner: { name: 'Ника', confirms_merge: true },
    data_dir: '.',
    delivery: 'clipboard',
    bots: [bot, { id: 'bitk', name: 'Бит', role: 'код' }],
    projects: [{
      id: 'demo-keys',
      title: 'Demo',
      lead: 'nora',
      owner: 'owner',
      merge_executor: 'bitk',
      ...(allow ? { allow_bot_tools: true } : {}),
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
    economy: { defaults: { wake: 'mentioned_only', reply_limit: 'short', max_wakes_per_task: 3 }, stale_after_hours: 6 },
  }
  writeFileSync(path.join(dir, 'config.yaml'), stringify(config))
  return {
    dir,
    configPath: path.relative(repoRoot(), path.join(dir, 'config.yaml')).split(path.sep).join('/'),
    file,
  }
}

function listen(handler: (body: string) => unknown): Promise<{ url: string; close: () => Promise<void>; bodies: string[] }> {
  const bodies: string[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      bodies.push(raw)
      const payload = handler(raw)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address && typeof address !== 'string' ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        bodies,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

const deps = {
  lookup: () => Promise.resolve(['127.0.0.1']),
  env: { DEEPSEEK_API_KEY: 'demo-deepseek-key' },
  now: () => new Date('2026-11-21T12:00:00.000Z'),
}

test('I1 выключенные инструменты не добавляют tools', async () => {
  const mock = await listen(() => ({
    choices: [{ message: { content: 'тихо' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }))
  try {
    const off = place(mock.url, 'off', true)
    const read = place(mock.url, 'read', false)
    const first = await deliverChat({
      root: repoRoot(),
      options: { configPath: off.configPath },
      botId: 'nora',
      text: 'привет',
      projectId: 'demo-keys',
      chatId: 'build',
      deps,
    })
    const second = await deliverChat({
      root: repoRoot(),
      options: { configPath: read.configPath },
      botId: 'nora',
      text: 'привет',
      projectId: 'demo-keys',
      chatId: 'build',
      deps,
    })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(mock.bodies).toHaveLength(2)
    expect(mock.bodies[0]).toBe(mock.bodies[1])
    expect(mock.bodies[0]?.includes('"tools"')).toBe(false)
  } finally {
    await mock.close()
  }
})

test('I2 неизвестный инструмент и лишнее поле не меняют файл', async () => {
  let step = 0
  const mock = await listen(() => {
    step += 1
    if (step === 1) {
      return {
        choices: [{
          message: {
            content: '',
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'apply_patch', arguments: '{}' } },
              { id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"path":"note.txt","project":"other"}' } },
              { id: 'c3', type: 'function', function: { name: 'read_file', arguments: '{oops' } },
            ],
          },
        }],
        usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
      }
    }
    return {
      choices: [{ message: { content: 'не вышло' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }
  })
  try {
    const made = place(mock.url, 'propose', true)
    const spoken = await deliverChat({
      root: repoRoot(),
      options: { configPath: made.configPath },
      botId: 'nora',
      text: 'прочитай',
      projectId: 'demo-keys',
      chatId: 'build',
      deps,
    })
    expect(spoken.ok).toBe(true)
    expect(readFileSync(made.file, 'utf8')).toBe('old\n')
    const names = mock.bodies[0] ?? ''
    expect(names).toContain('list_dir')
    expect(names).toContain('propose_patch')
    expect(names).not.toContain('apply_patch')
  } finally {
    await mock.close()
  }
})
