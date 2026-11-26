/**
 * FILE: e2e/wizard-shots.spec.ts
 * НАЗНАЧЕНИЕ: снимки мастера 0.3.2 и главной после подключения Tailwind.
 * В CI не бежит: нужен SHOTS=1. Картинки в /opt/cursor/artifacts, в git не коммитятся.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { boot, origin } from './harness'

const OUT = '/opt/cursor/artifacts/wizard'

async function shot(page: Page, file: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT, file), animations: 'disabled' })
}

test.skip(process.env.SHOTS !== '1', 'снимки только по SHOTS=1')
test.use({ viewport: { width: 1280, height: 800 } })

test('мастер: боты, доступ, экономия, обе темы', async ({ page }) => {
  test.setTimeout(90_000)
  mkdirSync(OUT, { recursive: true })
  const dir = path.join(process.cwd(), 'data', 'e2e-wizard-shots')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.join(dir, 'app'), { recursive: true })
  writeFileSync(path.join(dir, 'app', 'note.txt'), 'demo\n')
  const server = await boot('data/e2e-wizard-shots/config.yaml')
  try {
    await page.goto(origin(server.port))
    await page.getByTestId('owner-name').fill('Ника')
    await page.getByTestId('setup-next').click()
    await page.getByTestId('bot-name-0').fill('Нора')
    await page.getByTestId('bot-role-0').fill('документация')
    await page.getByTestId('bot-api-0').check()
    await page.getByTestId('bot-template-0').click()
    await expect(page.getByTestId('bot-template-list-0')).toBeVisible()
    await shot(page, 'bots-templates-light.png')
    await page.keyboard.press('Escape')
    await page.getByTestId('bot-instructions-0').fill('Коротко.')
    await page.getByTestId('bot-avatar-open-0').click()
    await expect(page.getByTestId('bot-avatar-pop-0')).toBeVisible()
    await page.getByTestId('bot-avatar-id-grape').click()
    await page.getByTestId('bot-avatar-color-violet').click()
    await shot(page, 'bots-popover-light.png')
    // Переключатель темы снаружи поповера его закрывает. Для тёмного кадра открываем заново.
    await page.keyboard.press('Escape')
    await page.getByTestId('setup-theme').click()
    await page.getByTestId('bot-avatar-open-0').click()
    await expect(page.getByTestId('bot-avatar-pop-0')).toBeVisible()
    await shot(page, 'bots-popover-dark.png')
    await page.keyboard.press('Escape')
    await page.getByTestId('setup-theme').click()
    await page.getByTestId('setup-next').click()
    await page.getByTestId('project-title').fill('Demo Kit')
    await page.getByTestId('setup-next').click()
    await page.getByTestId('chat-title').fill('Сборка')
    await page.getByTestId('setup-next').click()
    await page.getByTestId('source-path').fill('app')
    await page.getByTestId('source-check').click()
    await expect(page.getByTestId('git-warning')).toBeVisible()
    await page.getByTestId('setup-next').click()
    await shot(page, 'access-light.png')
    await page.getByTestId('setup-theme').click()
    await shot(page, 'access-dark.png')
    await page.getByTestId('setup-theme').click()
    await page.getByTestId('setup-next').click()
    await page.getByTestId('setup-next').click()
    await shot(page, 'economy-light.png')
    await page.getByTestId('setup-theme').click()
    await shot(page, 'economy-dark.png')
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('главная после Tailwind, preflight выключен', async ({ page }) => {
  mkdirSync(OUT, { recursive: true })
  const server = await boot('demo/sets/primary/config.yaml')
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${origin(server.port)}/?demo=1`)
    await expect(page.getByTestId('project-title')).toHaveText('Demo Game')
    await shot(page, 'dashboard-after.png')
  } finally {
    await server.stop()
  }
})
