/**
 * FILE: e2e/d6-motion.spec.ts
 * НАЗНАЧЕНИЕ: D6. При prefers-reduced-motion: reduce у орбиты и дерева нет перехода дольше 0.
 * Контроль без эмуляции ждёт ненулевую длительность у bot-node и tree-row:
 * иначе проверка «ничего не нашли» проходит и на обычном движении.
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { boot, origin } from './harness'

async function transitionMs(row: Locator): Promise<number> {
  return row.evaluate((el) => {
    const style = getComputedStyle(el)
    if (style.transitionProperty === 'none') {
      return 0
    }
    const part = style.transitionDuration.split(',')[0]?.trim() ?? '0s'
    const ms = part.endsWith('ms') ? parseFloat(part) : parseFloat(part) * 1000
    return Number.isFinite(ms) ? ms : 0
  })
}

async function openOrbit(page: Page, base: string): Promise<Locator> {
  await page.goto(base)
  const bot = page.locator('.bot-node').first()
  await expect(page.getByTestId('orbit')).toBeVisible()
  await expect(bot).toBeVisible()
  return bot
}

test('reduced motion гасит переходы орбиты и дерева', async ({ page }) => {
  const server = await boot('demo/sets/primary/config.yaml')
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const base = origin(server.port)
    const bot = await openOrbit(page, base)
    expect(await transitionMs(bot)).toBe(0)
    await page.getByTestId('tab-files').click()
    const row = page.getByTestId('tree-docs/README.md')
    await expect(row).toBeVisible()
    expect(await transitionMs(row)).toBe(0)
  } finally {
    await server.stop()
  }
})

test('без reduced-motion у орбиты и дерева переход длиннее нуля', async ({ page }) => {
  const server = await boot('demo/sets/primary/config.yaml')
  try {
    const base = origin(server.port)
    const bot = await openOrbit(page, base)
    expect(await transitionMs(bot)).toBeGreaterThan(0)
    await page.getByTestId('tab-files').click()
    const row = page.getByTestId('tree-docs/README.md')
    await expect(row).toBeVisible()
    expect(await transitionMs(row)).toBeGreaterThan(0)
  } finally {
    await server.stop()
  }
})
