/**
 * FILE: e2e/h-api-bots.spec.ts
 * НАЗНАЧЕНИЕ: H1, H3, H8, H9 и H11 на локальном моке.
 * Ключ вымышленный. В журнал и в историю он не попадает. Провайдер не вызывается.
 */

import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { stringify } from 'yaml'
import { boot, origin } from './harness'

const KEY = 'demo-deepseek-key'
const PROMPT = 'КАНАР-ПРОМПТ'
const REPLY = 'КАНАР-ОТВЕТ'

test.use({ viewport: { width: 1440, height: 900 } })

test('H1 и H8: Нора в орбите, у главного проекта и в выборе чата мержа', async ({ page }) => {
  const server = await boot('demo/sets/api-keys/config.yaml')
  try {
    const base = origin(server.port)
    const roster = await (await page.request.get(`${base}/api/roster`)).text()
    expect(roster.includes(KEY)).toBe(false)
    expect(roster.includes('DEEPSEEK_API_KEY')).toBe(false)
    const body = JSON.parse(roster) as { bots: Array<{ id: string; name: string; transport: string; model: string | null }> }
    const nora = body.bots.find((bot) => bot.id === 'nora')
    const bit = body.bots.find((bot) => bot.id === 'bitk')
    expect(nora?.name).toBe('Нора')
    expect(nora?.transport).toBe('api')
    expect(nora?.model).toBe('deepseek-chat')
    expect(bit?.transport).toBe('grok')
    expect(bit?.model).toBeNull()
    await page.goto(base)
    await expect(page.locator('.rail')).toBeVisible()
    await expect(page.getByTestId('project-lead')).toHaveText('главный Нора')
    await expect(page.getByTestId('orbit-bot-nora')).toContainText('Нора')
    await expect(page.getByTestId('chat-build')).toContainText('Нора')
    await page.getByTestId('merge-requests').click()
    await expect(page.getByTestId('chat-chip-build')).toBeVisible()
    expect(server.logs().includes(KEY)).toBe(false)
  } finally {
    await server.stop()
  }
})

test('H3, H9 и H11: бриф и чат идут в мок, script остаётся текстом', async ({ page }) => {
  const models: string[] = []
  const mock = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.length > 0) {
        models.push(JSON.parse(raw).model as string)
      }
      const script = JSON.stringify({
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
      const content = models.length === 1 ? script : REPLY
      res.end(JSON.stringify({
        choices: [{ message: { content } }],
        usage: models.length === 1 ? undefined : { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      }))
    })
  })
  await new Promise<void>((resolve) => {
    mock.listen(0, '127.0.0.1', () => resolve())
  })
  const address = mock.address()
  const mockPort = address && typeof address === 'object' ? address.port : 0
  mkdirSync(path.join(process.cwd(), 'data'), { recursive: true })
  const dir = mkdtempSync(path.join(process.cwd(), 'data', 'e2e-api-'))
  mkdirSync(path.join(dir, 'tasks'), { recursive: true })
  mkdirSync(path.join(dir, 'demo-project'), { recursive: true })
  const config = {
    schema_version: 1,
    owner: { name: 'Ника', confirms_merge: true },
    data_dir: '.',
    delivery: 'clipboard',
    timezone: 'Europe/Moscow',
    bots: [
      {
        id: 'nora',
        name: 'Нора',
        role: 'справка',
        instructions: 'Отвечай по карточке.',
        provider: 'deepseek',
        model: 'deepseek-chat',
        base_url: `http://127.0.0.1:${mockPort}/v1`,
        api_key_env: 'DEEPSEEK_API_KEY',
      },
      { id: 'bitk', name: 'Бит', role: 'код', grok_id: 'demo-bit' },
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
  writeFileSync(path.join(dir, 'config.yaml'), stringify(config))
  writeFileSync(path.join(dir, 'tasks', 'task-01.yaml'), stringify({
    schema_version: 1,
    updated_at: '2026-11-19T09:15:00Z',
    id: 'task-01',
    project: 'demo-keys',
    chat: 'build',
    assignee: 'nora',
    goal: 'КАНАР-БРИФ',
    inputs: [{ kind: 'path', value: 'src/app.txt' }],
    output: 'записка',
    done_when: 'текст на месте',
    out_of_scope: 'файлы проекта',
    reply_limit: 'short',
    due: '2026-11-20',
    status: 'working',
  }))
  const configPath = path.relative(process.cwd(), path.join(dir, 'config.yaml')).split(path.sep).join('/')
  const server = await boot(configPath, undefined, { DEEPSEEK_API_KEY: KEY })
  try {
    await page.addInitScript(() => {
      const win = window as unknown as { __alerted?: boolean }
      win.__alerted = false
      window.alert = () => {
        win.__alerted = true
      }
    })
    const base = origin(server.port)
    await page.goto(base)
    await page.getByTestId('brief-task-task-01').click()
    await expect(page.getByTestId('brief-reply')).toContainText('<script>')
    await expect(page.getByTestId('brief-reply')).toContainText('javascript:')
    await expect(page.getByTestId('open-lead-chat')).toHaveCount(0)
    await expect(page.getByTestId('brief-note-error')).toBeVisible()
    expect(await page.locator('a[href^="javascript:"]').count()).toBe(0)
    expect(await page.evaluate(() => (window as unknown as { __alerted?: boolean }).__alerted)).toBe(false)
    const tasks = (await (await page.request.get(`${base}/api/tasks`)).json()) as {
      tasks: Array<{ id: string; status: string; assignee_id: string }>
    }
    expect(tasks.tasks.find((task) => task.id === 'task-01')?.status).toBe('working')
    expect(tasks.tasks.find((task) => task.id === 'task-01')?.assignee_id).toBe('nora')

    await page.getByTestId('api-chat-input').fill(PROMPT)
    await page.getByTestId('api-chat-send').click()
    await expect(page.getByTestId('api-chat-log')).toContainText(REPLY)
    const rawConfig = readFileSync(path.join(dir, 'config.yaml'), 'utf8')
    writeFileSync(path.join(dir, 'config.yaml'), rawConfig.replace('deepseek-chat', 'qwen-plus'))
    await page.getByTestId('api-chat-input').fill('ещё строка')
    await page.getByTestId('api-chat-send').click()
    await expect.poll(() => models).toEqual(['deepseek-chat', 'deepseek-chat', 'qwen-plus'])
    const history = readFileSync(path.join(dir, 'chats', 'nora.json'), 'utf8')
    expect(history.includes(KEY)).toBe(false)
    const logs = server.logs()
    expect(logs.includes(KEY)).toBe(false)
    expect(logs.includes(PROMPT)).toBe(false)
    expect(logs.includes(REPLY)).toBe(false)
    expect(logs.includes('КАНАР-БРИФ')).toBe(false)
    expect(logs.includes('<script>')).toBe(false)
  } finally {
    await server.stop()
    await new Promise<void>((resolve) => {
      mock.close(() => resolve())
    })
    rmSync(dir, { recursive: true, force: true })
  }
})
