/**
 * FILE: e2e/b2-empty.spec.ts
 * НАЗНАЧЕНИЕ: B2. Три урезанных конфига показывают текст и кнопку «Настроить».
 * Кнопка открывает мастер, страница не падает.
 */

import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'

const cases = [
  { file: 'demo/sets/no-projects/config.yaml', kind: 'projects', title: 'Нет проектов' },
  { file: 'demo/sets/no-bots/config.yaml', kind: 'bots', title: 'Нет ботов' },
  { file: 'demo/sets/no-notes/config.yaml', kind: 'notes', title: 'Нет записок' },
]

for (const item of cases) {
  test(item.title, async ({ page }) => {
    const server = await boot(item.file)
    try {
      await page.goto(origin(server.port))
      const empty = page.getByTestId('empty-state')
      await expect(empty).toHaveAttribute('data-kind', item.kind)
      await expect(empty).toContainText(item.title)
      await expect(empty.getByTestId('setup-link')).toHaveText('Настроить')
      await empty.getByTestId('setup-link').click()
      await expect(page.getByTestId('setup-wizard')).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Настроить' })).toBeVisible()
      const mark = page.getByTestId('brand-mark')
      await expect(mark).toHaveAttribute('src', '/icon.svg')
      const box = await mark.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(16)
    } finally {
      await server.stop()
    }
  })
}
