/**
 * FILE: e2e/h45-fault.spec.ts
 * НАЗНАЧЕНИЕ: Н45. Причина сбоя отката видна владельцу на пульте.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'

const dir = path.join(process.cwd(), 'data', 'e2e-h45')

test('сбой отката показан владельцу', async ({ page }) => {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.join(dir, 'data', 'merge_requests'), { recursive: true })
  writeFileSync(path.join(dir, 'config.yaml'), `schema_version: 1
owner:
  name: "Ника"
  confirms_merge: true
data_dir: "data"
delivery: clipboard
timezone: "UTC"
bots:
  - id: lead1
    name: "Кедр"
    role: "код"
projects:
  - id: demo-kit
    title: "Demo Kit"
    lead: lead1
    owner: owner
    merge_executor: lead1
    source:
      files:
        path: "app"
    chats:
      - id: chat1
        title: "Сборка"
        lead: lead1
        members: [lead1]
        rules:
          do: "код"
          dont: "шум"
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
`)
  writeFileSync(path.join(dir, 'data', 'merge_requests', 'mr-cycle.json'), `${JSON.stringify({
    schema_version: 1,
    updated_at: '2026-11-19T10:00:00.000Z',
    project: 'demo-kit',
    pr_url: 'https://example.invalid/demo/pull/1',
    head_sha: '0123456789abcdef0123456789abcdef01234567',
    tasks: ['task-01'],
    checks: 'green',
    summary: 'Демо запрос',
    state: 'merged',
    history: [
      { state: 'merged', at: '2026-11-19T10:00:00.000Z', by: 'lead1', why: 'файлы приняты' },
      { state: 'merged', at: '2026-11-19T10:00:00.000Z', by: 'owner', why: 'нет снимка' },
    ],
    mode: 'files',
    owner: 'owner',
    fault: { action: 'revert', at: '2026-11-19T10:00:00.000Z', why: 'нет снимка' },
  }, null, 2)}\n`)
  const server = await boot('data/e2e-h45/config.yaml')
  try {
    await page.goto(origin(server.port))
    await expect(page.getByTestId('merge-fault')).toContainText('нет снимка')
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
