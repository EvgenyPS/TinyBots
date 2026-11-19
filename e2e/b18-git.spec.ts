/**
 * FILE: e2e/b18-git.spec.ts
 * НАЗНАЧЕНИЕ: B18. Папка без своего .git показывает, что вкладка Git будет скрыта.
 * Рядом папка с git init: предупреждение пропадает, написано, что git есть.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'
import { fillUntilSource, sample } from './wizard-flow'

const dir = path.join(process.cwd(), 'data', 'e2e-b18')

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  delete env.GIT_PREFIX
  return env
}

test('папка без .git предупреждает про вкладку Git', async ({ page }) => {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.join(dir, 'plain'), { recursive: true })
  writeFileSync(path.join(dir, 'plain', 'note.txt'), 'demo\n')
  mkdirSync(path.join(dir, 'repo'), { recursive: true })
  writeFileSync(path.join(dir, 'repo', 'note.txt'), 'demo\n')
  execFileSync('git', ['init'], { cwd: path.join(dir, 'repo'), stdio: 'ignore', env: gitEnv() })
  const server = await boot('data/e2e-b18/config.yaml')
  try {
    await page.goto(origin(server.port))
    await fillUntilSource(page, sample)
    await page.getByTestId('source-path').fill('plain')
    await page.getByTestId('source-check').click()
    await expect(page.getByTestId('git-warning')).toHaveText('вкладка Git будет скрыта')
    await page.getByTestId('source-path').fill('repo')
    await page.getByTestId('source-check').click()
    await expect(page.getByTestId('git-ok')).toBeVisible()
    await expect(page.getByTestId('git-warning')).toHaveCount(0)
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
