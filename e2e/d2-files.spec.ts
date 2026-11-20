/**
 * FILE: e2e/d2-files.spec.ts
 * НАЗНАЧЕНИЕ: D2. Демо без git прячет вкладку Git и показывает дерево source.files.path.
 */

import { expect, test, type Locator } from '@playwright/test'
import { boot, origin } from './harness'

async function textStart(row: Locator): Promise<number> {
  return row.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return range.getBoundingClientRect().x
  })
}

test('проект без git прячет вкладку и показывает файлы', async ({ page }) => {
  const server = await boot('demo/sets/no-notes/config.yaml')
  try {
    await page.goto(origin(server.port))
    await expect(page.getByTestId('shell')).toBeVisible()
    await expect(page.getByTestId('tab-git')).toHaveCount(0)
    await page.getByTestId('tab-files').click()
    const folder = page.getByTestId('tree-notes')
    const file = page.getByTestId('tree-notes/field.md')
    await expect(folder).toBeVisible()
    await expect(file).toBeVisible()
    await expect(page.getByTestId('tree-src/edge.txt')).toBeVisible()
    const folderX = await textStart(folder)
    const fileX = await textStart(file)
    expect(fileX).toBeGreaterThan(folderX + 8)
  } finally {
    await server.stop()
  }
})
