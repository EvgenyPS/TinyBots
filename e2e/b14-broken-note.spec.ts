/**
 * FILE: e2e/b14-broken-note.spec.ts
 * НАЗНАЧЕНИЕ: B14. Битый JSON записки и отсутствующий файл показывают «нет записки», пульт жив.
 * Валидная записка рядом остаётся на месте.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'

const CONFIG = `schema_version: 1
owner:
  name: "Nika"
  confirms_merge: true
data_dir: "data"
delivery: clipboard
timezone: "Europe/Moscow"
bots:
  - id: nit1
    name: "Нить"
    role: "шов"
    grok_id: "demo-nit"
  - id: edge1
    name: "Край"
    role: "кромка"
    grok_id: "demo-edge"
  - id: dusk1
    name: "Сумрак"
    role: "тень"
    grok_id: "demo-dusk"
projects:
  - id: demo-thread
    title: "Demo Thread"
    lead: nit1
    owner: owner
    merge_executor: nit1
    source:
      files:
        path: "demo-project"
    chats:
      - id: weft
        title: "Уток"
        lead: nit1
        members: [nit1, edge1, dusk1]
        rules:
          do: "держать нить"
          dont: "рвать полотно"
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

const VALID = `{
  "schema_version": 1,
  "updated_at": "2026-11-19T09:30:00Z",
  "task_id": "task-01",
  "state": "working",
  "links": ["notes/field.md"],
  "verified": "нить держит",
  "not_done": "",
  "question_to_owner": ""
}
`

test('битая и отсутствующая записки', async ({ page }) => {
  const dir = path.join(process.cwd(), 'data', 'e2e-b14')
  mkdirSync(path.join(dir, 'data', 'status'), { recursive: true })
  writeFileSync(path.join(dir, 'config.yaml'), CONFIG, 'utf8')
  writeFileSync(path.join(dir, 'data', 'status', 'nit1.json'), VALID, 'utf8')
  writeFileSync(path.join(dir, 'data', 'status', 'edge1.json'), '{', 'utf8')
  const server = await boot('data/e2e-b14/config.yaml')
  try {
    await page.goto(origin(server.port))
    await expect(page.getByTestId('shell')).toBeVisible()
    await expect(page.getByTestId('orbit-note-nit1')).toContainText('обновлено 12:30')
    await expect(page.getByTestId('orbit-note-edge1')).toContainText('нет записки')
    await expect(page.getByTestId('orbit-note-edge1')).toHaveAttribute('data-status', 'broken')
    await expect(page.getByTestId('orbit-note-dusk1')).toContainText('нет записки')
    await expect(page.getByTestId('orbit-note-dusk1')).toHaveAttribute('data-status', 'missing')
    await page.getByTestId('orbit-bot-edge1').click()
    await expect(page.getByTestId('card-note')).toContainText('нет записки')
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
