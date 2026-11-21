/**
 * FILE: e2e/proposal-shots.spec.ts
 * НАЗНАЧЕНИЕ: снимки окна предложений в двух темах. В CI не бежит: нужен SHOTS=1.
 * Картинки пишутся в /opt/cursor/artifacts и в репозиторий не коммитятся.
 */

import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { stringify } from 'yaml'
import { boot, origin } from './harness'

const OUT = '/opt/cursor/artifacts/proposals'
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

async function theme(page: Page, name: 'dark' | 'light'): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value
    window.localStorage.setItem('tinybots-theme', value)
  }, name)
}

async function shot(page: Page, file: string): Promise<void> {
  const toast = page.getByTestId('proposal-toast')
  const confirm = page.getByTestId('proposal-revert-confirm')
  if (await toast.count() > 0 && await toast.isVisible() && await confirm.count() === 0) {
    await toast.hover({ timeout: 2_000 }).catch(() => undefined)
  }
  await theme(page, 'dark')
  await page.screenshot({ path: path.join(OUT, 'dark', file), animations: 'disabled' })
  await theme(page, 'light')
  await page.screenshot({ path: path.join(OUT, file), animations: 'disabled' })
  await theme(page, 'dark')
}

test.skip(process.env.SHOTS !== '1', 'снимки только по SHOTS=1')
test.use({ viewport: { width: 1280, height: 800 } })

test('состояния 01–07 и 09', async ({ page }) => {
  test.setTimeout(90_000)
  mkdirSync(path.join(OUT, 'dark'), { recursive: true })
  const project = mkdtempSync(path.join(tmpdir(), 'tinybots-shot-'))
  const home = mkdtempSync(path.join(process.cwd(), 'data', 'e2e-shot-'))
  mkdirSync(path.join(project, 'src'), { recursive: true })
  writeFileSync(path.join(project, 'note.txt'), 'old\n')
  writeFileSync(path.join(project, 'package.json'), '{"name":"demo"}\n')
  let step = 0
  const mock = http.createServer((req, res) => {
    req.on('data', () => undefined)
    req.on('end', () => {
      step += 1
      const payload = step % 2 === 1
        ? {
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: `call-${step}`,
                type: 'function',
                function: { name: 'propose_patch', arguments: JSON.stringify({ diff, summary: 'правка из макета' }) },
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
    bots: [
      {
        id: 'nora',
        name: 'Нора',
        role: 'справка',
        instructions: 'Коротко.',
        provider: 'deepseek',
        model: 'deepseek-chat',
        base_url: `http://127.0.0.1:${port}/v1`,
        api_key_env: 'DEEPSEEK_API_KEY',
        project_tools: 'propose',
        apply_mode: 'files',
      },
      { id: 'bitk', name: 'Бит', role: 'код' },
    ],
    projects: [{
      id: 'demo-keys',
      title: 'Demo Keys',
      lead: 'nora',
      owner: 'owner',
      merge_executor: 'bitk',
      allow_bot_tools: true,
      respect_gitignore: true,
      source: { files: { path: project } },
      chats: [{
        id: 'build',
        title: 'Сборка',
        lead: 'nora',
        members: ['nora', 'bitk'],
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
    await page.goto(origin(server.port))
    await expect(page.getByTestId('proposals')).toBeVisible()
    await shot(page, '01b-badge-zero.png')
    await page.getByTestId('api-chat-input').fill('поправь note')
    await page.getByTestId('api-chat-send').click()
    await expect(page.getByTestId('api-chat-log')).toContainText('предложила правку 2')
    await page.reload()
    await shot(page, '01-badge.png')
    await page.getByTestId('proposals').click()
    await shot(page, '02-list.png')
    await page.getByTestId('proposal-item').first().click()
    await expect(page.getByTestId('proposal-title')).toBeVisible()
    await shot(page, '03-proposal-new.png')
    await page.getByTestId('proposal-apply').click()
    await expect(page.getByTestId('proposal-toast')).toBeVisible()
    await shot(page, '04-applied.png')
    await page.getByRole('button', { name: 'Скрыть уведомление' }).click()
    await shot(page, '04b-applied-quiet.png')
    await page.getByTestId('proposal-revert').click()
    await shot(page, '05-revert-confirm.png')
    await page.getByRole('button', { name: 'Отмена' }).click()
    await page.getByTestId('proposal-revert').click()
    await page.getByTestId('proposal-revert-yes').click()
    await expect(page.getByTestId('proposal-toast')).toContainText('Откачено')
    await shot(page, '06b-reverted.png')
    await page.getByTestId('proposal-close').click()
    await page.getByTestId('api-chat-input').fill('вторая')
    await page.getByTestId('api-chat-send').click()
    await expect(page.getByTestId('api-chat-log')).toContainText('предложила правку 4')
    await page.reload()
    await page.getByTestId('proposals').click()
    await page.getByTestId('proposal-item').filter({ hasText: 'Новое' }).click()
    await page.getByTestId('proposal-reject').click()
    await expect(page.getByTestId('proposal-toast')).toContainText('Отклонено')
    await shot(page, '06-rejected.png')
    await page.getByTestId('proposal-close').click()
    await page.getByTestId('api-chat-input').fill('третья')
    await page.getByTestId('api-chat-send').click()
    await expect(page.getByTestId('api-chat-log')).toContainText('предложила правку 6')
    writeFileSync(path.join(project, 'note.txt'), 'changed\n')
    await page.reload()
    await page.getByTestId('proposals').click()
    await page.getByTestId('proposal-item').filter({ hasText: 'Новое' }).click()
    await page.getByTestId('proposal-apply').click()
    await expect(page.getByTestId('proposal-error')).toBeVisible()
    await shot(page, '07-conflict.png')
    await page.getByTestId('proposal-error-collapse').click()
    await shot(page, '07b-conflict-collapsed.png')
    await page.getByTestId('proposal-close').click()
    await page.getByTestId('orbit-bot-nora').click()
    await page.getByTestId('bot-settings').click()
    await expect(page.getByTestId('bot-tools')).toBeVisible()
    await shot(page, '09-bot-settings.png')
    await page.getByLabel('Закрыть настройки').click()
    await page.getByTestId('orbit-bot-bitk').click()
    await page.getByTestId('bot-settings').click()
    await expect(page.getByTestId('bot-tools-grok')).toBeVisible()
    await shot(page, '09b-bot-settings-grok.png')
  } finally {
    await server.stop()
    await new Promise<void>((resolve) => mock.close(() => resolve()))
    rmSync(project, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('git-ветка 04c и 05b', async ({ page }) => {
  mkdirSync(path.join(OUT, 'dark'), { recursive: true })
  const project = mkdtempSync(path.join(tmpdir(), 'tinybots-shotg-'))
  const home = mkdtempSync(path.join(process.cwd(), 'data', 'e2e-shotg-'))
  writeFileSync(path.join(project, 'note.txt'), 'old\n')
  execFileSync('git', ['init', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: project })
  execFileSync('git', ['add', 'note.txt'], { cwd: project })
  execFileSync('git', ['commit', '-m', 'start'], { cwd: project })
  let step = 0
  const mock = http.createServer((req, res) => {
    req.on('data', () => undefined)
    req.on('end', () => {
      step += 1
      const payload = step === 1
        ? {
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-g',
                type: 'function',
                function: { name: 'propose_patch', arguments: JSON.stringify({ diff: '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n', summary: 'ветка из макета' }) },
              }],
            },
          }],
          usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
        }
        : {
          choices: [{ message: { content: 'предложила правку git' } }],
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
      apply_mode: 'git',
    }],
    projects: [{
      id: 'demo-keys',
      title: 'Demo Keys',
      lead: 'nora',
      owner: 'owner',
      merge_executor: 'nora',
      allow_bot_tools: true,
      respect_gitignore: true,
      source: { files: { path: project }, git: { provider: 'github', repo: 'example/demo' } },
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
    await page.goto(origin(server.port))
    await page.getByTestId('api-chat-input').fill('ветка')
    await page.getByTestId('api-chat-send').click()
    await expect(page.getByTestId('api-chat-log')).toContainText('предложила правку git')
    await page.reload()
    await page.getByTestId('proposals').click()
    await page.getByTestId('proposal-item').first().click()
    await page.getByTestId('proposal-apply').click()
    await expect(page.getByTestId('proposal-toast')).toContainText('ветка')
    await shot(page, '04c-applied-git.png')
    await page.getByTestId('proposal-revert').click()
    await shot(page, '05b-revert-confirm-git.png')
  } finally {
    await server.stop()
    await new Promise<void>((resolve) => mock.close(() => resolve()))
    rmSync(project, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('мастер 08', async ({ page }) => {
  mkdirSync(path.join(OUT, 'dark'), { recursive: true })
  const dir = path.join(process.cwd(), 'data', 'e2e-shot-wiz')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.join(dir, 'app'), { recursive: true })
  writeFileSync(path.join(dir, 'app', 'note.txt'), 'demo\n')
  execFileSync('git', ['init', '-b', 'main'], { cwd: path.join(dir, 'app') })
  const server = await boot('data/e2e-shot-wiz/config.yaml')
  try {
    await page.goto(origin(server.port))
    await page.getByTestId('owner-name').fill('Ника')
    await page.getByTestId('setup-next').click()
    await page.getByTestId('bot-name-0').fill('Нора')
    await page.getByTestId('bot-role-0').fill('справка')
    await page.getByTestId('bot-api-0').check()
    await page.getByTestId('bot-instructions-0').fill('Коротко.')
    await page.getByTestId('bot-model-0').fill('deepseek-chat')
    await page.getByTestId('bot-key-0').fill('DEEPSEEK_API_KEY')
    await page.getByTestId('setup-next').click()
    await page.getByTestId('project-title').fill('Demo')
    await page.getByTestId('setup-next').click()
    await page.getByTestId('chat-title').fill('Сборка')
    await page.getByTestId('setup-next').click()
    await page.getByTestId('source-path').fill('app')
    await page.getByTestId('source-check').click()
    await expect(page.getByTestId('git-ok')).toBeVisible()
    await page.getByTestId('setup-next').click()
    await shot(page, '08b-wizard-off.png')
    await page.getByTestId('wiz-tools-read-0').check()
    await shot(page, '08c-wizard-read.png')
    await page.getByTestId('wiz-tools-propose-0').check()
    await page.getByTestId('wiz-apply-git-0').check()
    await shot(page, '08-wizard.png')
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
