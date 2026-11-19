/**
 * FILE: e2e/b17-setup.spec.ts
 * НАЗНАЧЕНИЕ: B17. Нет config.yaml — открывается мастер.
 * После прохода на диске валидный файл, на экране пульт с новыми именами.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'
import { passWizard, sample } from './wizard-flow'

const dir = path.join(process.cwd(), 'data', 'e2e-b17')

test('полный проход пишет конфиг и открывает пульт', async ({ page }) => {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.join(dir, 'app'), { recursive: true })
  writeFileSync(path.join(dir, 'app', 'note.txt'), 'demo\n')
  const server = await boot('data/e2e-b17/config.yaml')
  try {
    await page.goto(origin(server.port))
    await passWizard(page, sample)
    const text = readFileSync(path.join(dir, 'config.yaml'), 'utf8')
    expect(text).toContain('schema_version: 1')
    expect(text).toContain('Demo Kit')
    expect(text).toContain('Nika')
    expect(text).toContain('Мира')
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
