/**
 * FILE: e2e/b3-broken.spec.ts
 * НАЗНАЧЕНИЕ: B3. Битый YAML и битая схема не роняют сервер.
 * На экране те же файл, строка и причина, что в API.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { boot, origin } from './harness'

const SCHEMA_BROKEN = `schema_version: 1
owner:
  name: "Nika"
  confirms_merge: true
data_dir: "data"
delivery: nope
bots: []
projects: []
economy:
  defaults:
    wake: mentioned_only
    reply_limit: short
    max_wakes_per_task: 3
  stale_after_hours: 6
`

async function show(page: Page, relativeFile: string, body: string) {
  const absolute = path.join(process.cwd(), relativeFile)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, body, 'utf8')
  const server = await boot(relativeFile)
  try {
    const base = origin(server.port)
    const health = await page.request.get(`${base}/health`)
    expect(health.status()).toBe(200)
    const api = await page.request.get(`${base}/api/launcher`)
    expect(api.status()).toBe(422)
    const failure = (await api.json()) as { file: string; line: number; reason: string }
    await page.goto(base)
    await expect(page.getByTestId('config-error')).toBeVisible()
    await expect(page.getByTestId('config-error-file')).toHaveText(failure.file)
    await expect(page.getByTestId('config-error-line')).toHaveText(String(failure.line))
    await expect(page.getByTestId('config-error-reason')).toHaveText(failure.reason)
    expect(failure.line).toBeGreaterThan(0)
    expect(failure.reason.length).toBeGreaterThan(0)
    const again = await page.request.get(`${base}/health`)
    expect(again.status()).toBe(200)
  } finally {
    await server.stop()
    rmSync(path.dirname(absolute), { recursive: true, force: true })
  }
}

test('YAML-ошибка', async ({ page }) => {
  await show(page, 'data/e2e-b3-yaml/config.yaml', 'schema_version: [')
})

test('нарушение схемы', async ({ page }) => {
  await show(page, 'data/e2e-b3-schema/config.yaml', SCHEMA_BROKEN)
})
