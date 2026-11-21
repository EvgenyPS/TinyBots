/**
 * FILE: e2e/i83-tools.spec.ts
 * НАЗНАЧЕНИЕ: доступ к папке включается из карточки бота, без правки YAML.
 * Сначала project_tools выключен. После «Записать» ход получает предложение.
 */

import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { stringify } from 'yaml'
import { boot, origin } from './harness'

test.use({ viewport: { width: 1440, height: 900 } })

test('карточка бота включает propose и появляется предложение', async ({ page }) => {
  const project = mkdtempSync(path.join(tmpdir(), 'tinybots-i83-'))
  const home = mkdtempSync(path.join(process.cwd(), 'data', 'e2e-i83-'))
  writeFileSync(path.join(project, 'note.txt'), 'old\n')
  const diff = '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n'
  let step = 0
  const mock = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      step += 1
      const payload = step === 1
        ? {
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-1',
                type: 'function',
                function: { name: 'propose_patch', arguments: JSON.stringify({ diff, summary: 'из пульта' }) },
              }],
            },
          }],
          usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
        }
        : {
          choices: [{ message: { content: 'предложила правку' } }],
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
      project_tools: 'off',
    }],
    projects: [{
      id: 'demo-keys',
      title: 'Demo Keys',
      lead: 'nora',
      owner: 'owner',
      merge_executor: 'nora',
      allow_bot_tools: false,
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
  const configFile = path.join(home, 'config.yaml')
  writeFileSync(configFile, stringify(config))
  const configPath = path.relative(process.cwd(), configFile).split(path.sep).join('/')
  const server = await boot(configPath, undefined, { DEEPSEEK_API_KEY: 'demo-deepseek-key' })
  try {
    await page.goto(origin(server.port))
    await page.getByTestId('orbit-bot-nora').click()
    await page.getByTestId('bot-tools-level').selectOption('propose')
    await page.getByTestId('bot-tools-allow').check()
    await page.getByTestId('bot-tools-save').click()
    await expect(page.getByTestId('bot-tools-note')).toHaveText('Записано')
    expect(readFileSync(configFile, 'utf8')).toContain('propose')
    await page.getByTestId('api-chat-input').fill('поправь note')
    await page.getByTestId('api-chat-send').click()
    await expect(page.getByTestId('api-chat-log')).toContainText('предложила правку')
    await page.reload()
    await page.getByTestId('proposals').click()
    await expect(page.getByTestId('proposal-summary')).toContainText('из пульта')
  } finally {
    await server.stop()
    await new Promise<void>((resolve) => mock.close(() => resolve()))
    rmSync(project, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})
