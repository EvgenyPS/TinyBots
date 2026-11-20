/**
 * FILE: e2e/h49-unc.spec.ts
 * НАЗНАЧЕНИЕ: Н49. Мастер не принимает \/evil и /\evil как папку проекта.
 */

import { rmSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'
import { fillUntilSource, sample } from './wizard-flow'

const dir = path.join(process.cwd(), 'data', 'e2e-h49')

test('мастер отвергает UNC со смешанными слешами', async ({ page }) => {
  rmSync(dir, { recursive: true, force: true })
  const server = await boot('data/e2e-h49/config.yaml')
  try {
    await page.goto(origin(server.port))
    await fillUntilSource(page, sample)
    for (const value of ['\\/evil', '/\\evil']) {
      await page.getByTestId('source-path').fill(value)
      await page.getByTestId('source-check').click()
      await expect(page.getByTestId('setup-error')).toHaveText('Укажите папку проекта')
      await expect(page.getByTestId('git-warning')).toHaveCount(0)
      await expect(page.getByTestId('git-ok')).toHaveCount(0)
    }
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
