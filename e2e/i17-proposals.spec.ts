/**
 * FILE: e2e/i17-proposals.spec.ts
 * НАЗНАЧЕНИЕ: I17. Модалка предложения на локальном моке.
 * Папка проекта — временный каталог. Конфиг лежит внутри репозитория, потому что пульт иначе его не читает.
 * Провайдер не вызывается. В журнал не попадают путь файла и текст правки.
 */

import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { stringify } from 'yaml'
import { boot, origin } from './harness'

test.use({ viewport: { width: 1440, height: 900 } })

test('I17 предложение, модалка, применение и откат', async ({ page }) => {
  const project = mkdtempSync(path.join(tmpdir(), 'tinybots-i17-'))
  const home = mkdtempSync(path.join(process.cwd(), 'data', 'e2e-i17-'))
  mkdirSync(path.join(project, 'src'), { recursive: true })
  writeFileSync(path.join(project, 'note.txt'), 'old\n')
  writeFileSync(path.join(project, 'package.json'), '{"name":"demo"}\n')
  const diff = [
    '--- a/note.txt',
    '+++ b/note.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    '--- a/package.json',
    '+++ b/package.json',
    '@@ -1 +1 @@',
    '-{"name":"demo"}',
    '+{"name":"demo","private":true}',
    '',
  ].join('\n')
  const summary = 'правка <script>alert(1)</script>'
  let step = 0
  const mock = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      step += 1
      const payload = step % 2 === 1
        ? {
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-1',
                type: 'function',
                function: {
                  name: 'propose_patch',
                  arguments: JSON.stringify({ diff, summary }),
                },
              }],
            },
          }],
          usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 },
        }
        : {
          choices: [{ message: { content: `предложила правку ${step}` } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    })
  })
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', () => resolve()))
  const address = mock.address()
  const port = address && typeof address !== 'string' ? address.port : 0
  const config = {
    schema_version: 1,
    owner: { name: 'Ника', confirms_merge: true },
    data_dir: 'data',
    delivery: 'clipboard',
    bots: [{
      id: 'nora',
      name: 'Нора',
      role: 'справка',
      instructions: 'Коротко.',
      provider: 'deepseek',
      model: 'deepseek-chat',
      base_url: `http://127.0.0.1:${port}/v1`,
      api_key_env: 'DEEPSEEK_API_KEY',
      project_tools: 'propose',
    }],
    projects: [{
      id: 'demo-keys',
      title: 'Demo Keys',
      lead: 'nora',
      owner: 'owner',
      merge_executor: 'nora',
      allow_bot_tools: true,
      respect_gitignore: true,
      source: { files: { path: project } },
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
  mkdirSync(path.join(home, 'data'), { recursive: true })
  writeFileSync(path.join(home, 'config.yaml'), stringify(config))
  const configPath = path.relative(process.cwd(), path.join(home, 'config.yaml')).split(path.sep).join('/')
  const server = await boot(configPath, undefined, { DEEPSEEK_API_KEY: 'demo-deepseek-key' })
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
    await page.getByTestId('api-chat-input').fill('поправь note')
    await page.getByTestId('api-chat-send').click()
    await expect(page.getByTestId('api-chat-log')).toContainText('предложила правку')
    expect(readFileSync(path.join(project, 'note.txt'), 'utf8')).toBe('old\n')
    await page.reload()
    await page.getByTestId('proposals').click()
    await page.getByTestId('proposal-item').first().click()
    await expect(page.getByTestId('proposal-title')).toContainText('Предложение #')
    await expect(page.getByTestId('proposal-summary')).toContainText('<script>alert(1)</script>')
    await expect(page.getByTestId('proposal-dialog')).toContainText('со слов бота')
    await expect(page.getByTestId('exec-package.json')).toContainText('исполняемый/CI')
    expect(await page.evaluate(() => (window as unknown as { __alerted?: boolean }).__alerted)).toBe(false)
    const before = await page.getByTestId('proposal-diff').boundingBox()
    await page.getByTestId('proposal-apply').click()
    await expect(page.getByTestId('proposal-toast')).toBeVisible()
    const after = await page.getByTestId('proposal-diff').boundingBox()
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1)
    expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThan(1)
    await expect.poll(() => readFileSync(path.join(project, 'note.txt'), 'utf8')).toBe('new\n')
    await page.reload()
    await page.getByTestId('proposals').click()
    await page.getByTestId('proposal-item').first().click()
    await page.getByTestId('proposal-revert').click()
    await page.getByTestId('proposal-revert-yes').click()
    await expect.poll(() => readFileSync(path.join(project, 'note.txt'), 'utf8')).toBe('old\n')
    await page.reload()
    await page.getByTestId('api-chat-input').fill('ещё правка')
    await page.getByTestId('api-chat-send').click()
    await expect(page.getByTestId('api-chat-log')).toContainText('предложила правку 4')
    writeFileSync(path.join(project, 'note.txt'), 'changed\n')
    await page.reload()
    await page.getByTestId('proposals').click()
    await page.getByTestId('proposal-item').filter({ hasText: 'Новое' }).click()
    const conflictBefore = await page.getByTestId('proposal-diff').boundingBox()
    await page.getByTestId('proposal-apply').click()
    await expect(page.getByTestId('proposal-error')).toBeVisible()
    const conflictAfter = await page.getByTestId('proposal-diff').boundingBox()
    expect(Math.abs((conflictAfter?.y ?? 0) - (conflictBefore?.y ?? 0))).toBeLessThan(1)
    expect(Math.abs((conflictAfter?.height ?? 0) - (conflictBefore?.height ?? 0))).toBeLessThan(1)
    expect(readFileSync(path.join(project, 'note.txt'), 'utf8')).toBe('changed\n')
    await page.getByTestId('proposal-reject').click()
    await expect(page.getByTestId('proposal-toast')).toContainText('Отклонено')
    expect(readFileSync(path.join(project, 'note.txt'), 'utf8')).toBe('changed\n')
    const logs = server.logs()
    expect(logs.includes(project)).toBe(false)
    expect(logs.includes('old')).toBe(false)
  } finally {
    await server.stop()
    await new Promise<void>((resolve) => mock.close(() => resolve()))
    rmSync(project, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})
