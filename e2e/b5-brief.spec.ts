/**
 * FILE: e2e/b5-brief.spec.ts
 * НАЗНАЧЕНИЕ: B5, B6, B9, B10 на первом демо-наборе.
 * С экрана проекта бриф собирается одним кликом по задаче. В буфер попадает текст превью.
 * Ссылка ведёт на grokbot с id главного чата (Бит), не главного проекта (Ава).
 */

import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'

test.use({
  permissions: ['clipboard-read', 'clipboard-write'],
})

test('бриф за один клик, подпись, буфер и ссылка', async ({ page }) => {
  const server = await boot('demo/sets/primary/config.yaml')
  try {
    const base = origin(server.port)
    await page.goto(base)
    await expect(page.getByTestId('shell')).toBeVisible()
    await expect(page.getByTestId('queue-state')).toHaveText('Очередь выключена')
    await expect(page.getByTestId('brief-preview')).toHaveCount(0)

    await page.evaluate(() => {
      const win = window as unknown as { __clicks: number }
      win.__clicks = 0
      document.addEventListener('click', () => {
        win.__clicks += 1
      }, true)
    })
    await page.getByTestId('brief-task-task-01').click()
    const clicks = await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)
    expect(clicks).toBeGreaterThan(0)
    expect(clicks).toBeLessThanOrEqual(3)

    await expect(page.getByTestId('brief-recipient')).toHaveText('Уйдёт: Бит')
    await expect(page.getByTestId('brief-preview')).toBeVisible()
    const api = (await (await page.request.get(
      `${base}/api/brief?project=demo-game&chat=build&task=task-01`,
    )).json()) as { text: string; href: string }
    const shown = await page.getByTestId('brief-preview').evaluate((el) => el.textContent ?? '')
    expect(shown).toBe(api.text)
    expect(shown.split('\n').length).toBeLessThanOrEqual(8)
    expect(shown).toContain('Что:')
    expect(shown).toContain('Зачем:')
    expect(shown).toContain('Файлы:')
    expect(shown).toContain('Критерий готовности:')
    expect(shown).toContain('Лимит ответа:')
    expect(shown).not.toContain('Ава')

    await expect(page.getByTestId('open-lead-chat')).toHaveAttribute('href', 'grokbot://app/v1/agent?id=demo-bit')
    await expect(page.getByTestId('brief-fallback')).toHaveCount(0)

    await page.getByTestId('copy-brief').click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toBe(shown)
  } finally {
    await server.stop()
  }
})
