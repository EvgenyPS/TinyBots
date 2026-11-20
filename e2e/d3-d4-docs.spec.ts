/**
 * FILE: e2e/d3-d4-docs.spec.ts
 * НАЗНАЧЕНИЕ: D3 и D4 на демо-доках. Отступы дерева, подписи рёбер, подсветка, markdown без XSS.
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

test('дерево, граф и документация на демо', async ({ page }) => {
  const server = await boot('demo/sets/primary/config.yaml')
  try {
    await page.goto(origin(server.port))
    await page.getByTestId('tab-files').click()
    const docs = page.getByTestId('tree-docs')
    const readme = page.getByTestId('tree-docs/README.md')
    const acceptance = page.getByTestId('tree-docs/ACCEPTANCE.md')
    await expect(docs).toBeVisible()
    await expect(readme).toBeVisible()
    const docsBox = await docs.boundingBox()
    const readmeBox = await readme.boundingBox()
    expect(readmeBox && docsBox && readmeBox.y > docsBox.y).toBe(true)
    expect(await textStart(readme)).toBeGreaterThan(await textStart(docs) + 8)
    expect(await textStart(acceptance)).toBeGreaterThan(await textStart(docs) + 8)
    expect(Number(await readme.getAttribute('data-depth'))).toBeGreaterThan(Number(await docs.getAttribute('data-depth')))
    await expect(page.getByTestId('edge-label')).toHaveCount(3)
    await expect(page.getByTestId('edge-label').nth(0)).toHaveText('вызывает')
    const row = page.getByTestId('tree-src/app.txt')
    const before = await row.screenshot()
    await row.click()
    await expect(row).toHaveClass(/on/)
    const after = await row.screenshot()
    expect(Buffer.compare(before, after) === 0).toBe(false)
    const panel = await page.getByTestId('files-panel').screenshot()
    expect(panel.byteLength).toBeGreaterThan(1000)

    await page.getByTestId('tab-docs').click()
    await page.getByTestId('doc-docs/README.md').click()
    await expect(page.locator('.md table')).toBeVisible()
    await expect(page.locator('.md table')).toContainText('plugin.gd')
    await expect(page.locator('.md pre')).toContainText('build_preset_preview')
    await page.getByTestId('doc-docs/xss.md').click()
    await expect(page.locator('.md script')).toHaveCount(0)
    await expect(page.locator('.md img')).toHaveCount(0)
    await expect(page.getByTestId('markdown')).toContainText('<script>alert(1)</script>')
  } finally {
    await server.stop()
  }
})
