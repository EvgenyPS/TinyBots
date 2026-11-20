/**
 * FILE: e2e/c-merge.spec.ts
 * НАЗНАЧЕНИЕ: этап 2 в браузере. C1 — один сценарий в режимах git и files.
 * C5–C8 идут внутри цикла. C6 и C11 — отдельные запросы. C13 — пульт без запросов.
 * GitHub не вызывается: сервер отвечает моком, сеть теста к нему не ходит.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { boot, origin, type Running } from './harness'

const SHA = '0123456789abcdef0123456789abcdef01234567'

function configText(): string {
  return `schema_version: 1
owner:
  name: "Owner"
  confirms_merge: true
data_dir: "data"
delivery: clipboard
timezone: "UTC"
bots:
  - id: lead1
    name: "Ава"
    role: "тимлид"
  - id: dev1
    name: "Бит"
    role: "код"
    executor_for_merge: true
projects:
  - id: demo-game
    title: "Demo Game"
    lead: lead1
    owner: owner
    merge_executor: dev1
    source:
      git:
        provider: github
        repo: "example/demo-game"
      files:
        path: "project"
    chats:
      - id: build
        title: "Сборка"
        lead: dev1
        members: [dev1, lead1]
        rules:
          do: "код"
          dont: "шум"
        context: []
        economy:
          wake: mentioned_only
          reply_limit: short
      - id: design
        title: "Оформление"
        lead: lead1
        members: [lead1]
        rules:
          do: "вид"
          dont: "код"
        context: []
        economy:
          wake: mentioned_only
          reply_limit: short
economy:
  defaults:
    wake: mentioned_only
    reply_limit: short
    max_wakes_per_task: 3
  stale_after_hours: 6
`
}

function writeRequest(dir: string, mode: 'git' | 'files', prUrl: string, checks: 'green' | 'red'): void {
  const data = path.join(dir, 'data')
  mkdirSync(path.join(data, 'merge_requests'), { recursive: true })
  const mr = {
    schema_version: 1,
    updated_at: '2026-11-19T10:00:00.000Z',
    project: 'demo-game',
    pr_url: prUrl,
    head_sha: SHA,
    tasks: ['task-01'],
    checks,
    summary: 'Демо запрос',
    state: 'awaiting_owner',
    history: [{ state: 'awaiting_owner', at: '2026-11-19T10:00:00.000Z', by: 'lead1', why: 'отдано' }],
    id: 'mr-cycle',
    task_id: 'task-01',
    mode,
    author: 'dev1',
    lead: 'lead1',
    merge_executor: 'dev1',
    owner: 'owner',
    affected_chats: ['build'],
    links: { pr: prUrl, ci: checks, diff: 'note.txt' },
    iterations: [{
      n: 1,
      created_at: '2026-11-19T10:00:00.000Z',
      done: ['превью'],
      broken: [],
      postponed: [],
      risks: [],
      other: '',
      addressed_feedback: null,
      decision: null,
    }],
    ...(mode === 'files' ? { files: [{ path: 'note.txt' }] } : {}),
  }
  writeFileSync(path.join(data, 'merge_requests', 'mr-cycle.json'), `${JSON.stringify(mr, null, 2)}\n`)
  if (mode === 'files') {
    const project = path.join(dir, 'project')
    mkdirSync(path.join(project, 'staging'), { recursive: true })
    writeFileSync(path.join(project, 'note.txt'), 'до мержа\n')
    writeFileSync(path.join(project, 'staging', 'note.txt'), 'после мержа\n')
  }
}

function prepare(name: string, mode: 'git' | 'files', prUrl: string, checks: 'green' | 'red'): string {
  const dir = path.join('data', name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'config.yaml'), configText())
  writeRequest(dir, mode, prUrl, checks)
  return path.join(dir, 'config.yaml').split(path.sep).join('/')
}

async function stop(server: Running | undefined): Promise<void> {
  await server?.stop()
}

async function clickPost(page: Page, testId: string, urlPart: string): Promise<void> {
  await Promise.all([
    page.waitForResponse((res) => res.url().includes(urlPart) && res.request().method() === 'POST'),
    page.getByTestId(testId).click(),
  ])
}

test('C13: кнопки без запросов неактивны и объясняют почему', async ({ page }) => {
  const server = await boot('demo/sets/primary/config.yaml')
  try {
    await page.goto(origin(server.port))
    const requests = page.getByTestId('merge-requests')
    const revert = page.getByTestId('revert')
    await expect(requests).toBeDisabled()
    await expect(page.getByTestId('merge-requests-reason')).toHaveText('Нет запросов на мерж')
    await expect(requests).toHaveAttribute('title', 'Нет запросов на мерж')
    await expect(revert).toBeDisabled()
    await expect(page.getByTestId('revert-reason')).toHaveText('Нет смерженного запроса, откатывать нечего')
    await expect(revert).toHaveAttribute('title', 'Нет смерженного запроса, откатывать нечего')
  } finally {
    await stop(server)
  }
})

async function cycle(page: Page, mode: 'git' | 'files'): Promise<void> {
  const configPath = prepare(
    `e2e-merge-${mode}`,
    mode,
    'https://example.invalid/demo/pull/1',
    'green',
  )
  const server = await boot(configPath)
  try {
    await page.goto(origin(server.port))
    await page.getByTestId('merge-requests').click()
    const dialog = page.getByTestId('merge-dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('chat-chip-build')).toBeChecked()
    await expect(page.getByTestId('chat-chip-design')).not.toBeChecked()
    await expect(page.getByTestId('merge-changes')).toBeDisabled()
    await expect(page.getByTestId('merge-reject')).toBeDisabled()
    await page.getByTestId('merge-feedback').fill('поправь отступ')
    await expect(page.getByTestId('merge-changes')).toBeEnabled()
    await expect(page.getByTestId('merge-reject')).toBeEnabled()
    await page.getByTestId('chat-chip-design').check()
    await clickPost(page, 'merge-changes', '/api/merge/decide')
    const feedback = JSON.parse(readFileSync(path.join('data', `e2e-merge-${mode}`, 'data', 'outbox', 'feedback', 'fb-mr-cycle.json'), 'utf8')) as {
      sent_to_chats: string[]
      feedback: string
    }
    expect(feedback.feedback).toBe('поправь отступ')
    expect(feedback.sent_to_chats).toEqual(['build', 'design'])
    const beforeSync = JSON.parse(readFileSync(path.join('data', `e2e-merge-${mode}`, 'data', 'merge_requests', 'mr-cycle.json'), 'utf8')) as { state: string }
    expect(beforeSync.state).toBe('awaiting_owner')
    await clickPost(page, 'merge-sync', '/api/sync/apply')
    await expect(page.getByTestId('quote-2')).toHaveText('поправь отступ')
    await expect(page.getByTestId('fixed-2')).toContainText('исправлено по отзыву')
    await expect(page.getByTestId('remaining-2')).toContainText('осталось проверить')
    await clickPost(page, 'merge-approve', '/api/merge/decide')
    const parked = JSON.parse(readFileSync(path.join('data', `e2e-merge-${mode}`, 'data', 'merge_requests', 'mr-cycle.json'), 'utf8')) as { state: string }
    expect(parked.state).toBe('awaiting_owner')
    await clickPost(page, 'merge-sync', '/api/sync/apply')
    await expect(page.getByTestId('merge-mark')).toContainText('Смержено')
    await page.getByRole('button', { name: 'Закрыть запрос' }).click()
    await expect(page.getByTestId('revert')).toBeEnabled()
    await page.getByTestId('revert').click()
    await clickPost(page, 'revert-yes', '/api/merge/decide')
    const stillMerged = JSON.parse(readFileSync(path.join('data', `e2e-merge-${mode}`, 'data', 'merge_requests', 'mr-cycle.json'), 'utf8')) as { state: string }
    expect(stillMerged.state).toBe('merged')
    await clickPost(page, 'sync', '/api/sync/apply')
    await expect(page.getByTestId('merge-status')).toContainText('mr-cycle:reverted')
    if (mode === 'files') {
      expect(readFileSync(path.join('data', `e2e-merge-${mode}`, 'project', 'note.txt'), 'utf8')).toBe('до мержа\n')
      expect(readFileSync(path.join('data', `e2e-merge-${mode}`, 'project', 'backups', 'mr-cycle', 'note.txt'), 'utf8')).toBe('до мержа\n')
    }
  } finally {
    await stop(server)
  }
}

test('C1 C5 C7 C8: полный цикл в git и files', async ({ page }) => {
  test.setTimeout(120_000)
  await cycle(page, 'git')
  await cycle(page, 'files')
})

test('C6: красный CI держит Смержить, отметка пишется в решение', async ({ page }) => {
  const configPath = prepare('e2e-merge-red', 'git', 'https://example.invalid/demo/pull/2', 'red')
  const server = await boot(configPath)
  try {
    await page.goto(origin(server.port))
    await page.getByTestId('merge-requests').click()
    await expect(page.getByTestId('merge-approve')).toBeDisabled()
    await expect(page.getByTestId('merge-approve-reason')).toContainText('принимаю риск')
    await page.getByTestId('accept-risk').check()
    await expect(page.getByTestId('merge-approve')).toBeEnabled()
    await clickPost(page, 'merge-approve', '/api/merge/decide')
    const decision = JSON.parse(readFileSync(path.join('data', 'e2e-merge-red', 'data', 'outbox', 'decisions', 'mr-cycle.json'), 'utf8')) as {
      accept_risk?: boolean
      action: string
      by: string
    }
    expect(decision.action).toBe('approved')
    expect(decision.by).toBe('owner')
    expect(decision.accept_risk).toBe(true)
    const mr = JSON.parse(readFileSync(path.join('data', 'e2e-merge-red', 'data', 'merge_requests', 'mr-cycle.json'), 'utf8')) as { state: string }
    expect(mr.state).toBe('awaiting_owner')
  } finally {
    await stop(server)
  }
})

test('C11: ошибка мока видна владельцу и статус снова awaiting_owner', async ({ page }) => {
  const configPath = prepare('e2e-merge-fail', 'git', 'https://example.invalid/mock-fail/pull/9', 'green')
  const server = await boot(configPath)
  try {
    await page.goto(origin(server.port))
    await page.getByTestId('merge-requests').click()
    await clickPost(page, 'merge-approve', '/api/merge/decide')
    await clickPost(page, 'merge-sync', '/api/sync/apply')
    await expect(page.getByTestId('merge-error')).toContainText('мок GitHub: мерж не прошёл')
    await expect(page.getByTestId('merge-dialog')).toHaveAttribute('data-state', 'awaiting_owner')
  } finally {
    await stop(server)
  }
})
