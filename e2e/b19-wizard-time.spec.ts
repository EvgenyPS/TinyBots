/**
 * FILE: e2e/b19-wizard-time.spec.ts
 * НАЗНАЧЕНИЕ: B19, автоматическая часть.
 * Семь шагов, не больше десяти. Полный проход на чистой папке быстрее двух минут.
 * Живой прогон за десять минут — docs/setup-manual.md, его делает человек.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'
import { passWizard, sample } from './wizard-flow'

const dir = path.join(process.cwd(), 'data', 'e2e-b19')

test('проход мастера укладывается в 2 минуты', async ({ page }) => {
  test.setTimeout(90_000)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.join(dir, 'app'), { recursive: true })
  writeFileSync(path.join(dir, 'app', 'note.txt'), 'demo\n')
  const server = await boot('data/e2e-b19/config.yaml')
  const started = Date.now()
  try {
    await page.goto(origin(server.port))
    await passWizard(page, sample)
    expect(Date.now() - started).toBeLessThan(120_000)
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
