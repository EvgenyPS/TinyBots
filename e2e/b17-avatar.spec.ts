/**
 * FILE: e2e/b17-avatar.spec.ts
 * НАЗНАЧЕНИЕ: мастер пишет avatarId и avatarColor, «Без аватара» их не пишет.
 * ВХОД: пустой config.yaml. ВЫХОД: превью на шаге «Экономия» и файл на диске.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'
import { sample } from './wizard-flow'

const dir = path.join(process.cwd(), 'data', 'e2e-b17-avatar')

test('выбор аватара и цвета виден в превью конфига', async ({ page }) => {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.join(dir, 'app'), { recursive: true })
  writeFileSync(path.join(dir, 'app', 'note.txt'), 'demo\n')
  const server = await boot('data/e2e-b17-avatar/config.yaml')
  try {
    await page.goto(origin(server.port))
    await page.getByTestId('owner-name').fill(sample.owner)
    await page.getByTestId('setup-next').click()
    await page.getByTestId('bot-name-0').fill(sample.bot)
    await page.getByTestId('bot-role-0').fill(sample.role)
    await page.getByTestId('bot-avatar-open-0').click()
    await expect(page.getByTestId('bot-avatar-pop-0')).toBeVisible()
    await page.getByTestId('bot-avatar-id-grape').click()
    await page.getByTestId('bot-avatar-color-violet').click()
    await page.keyboard.press('Escape')
    await page.getByTestId('setup-next').click()
    await page.getByTestId('project-title').fill(sample.project)
    await page.getByTestId('setup-next').click()
    await page.getByTestId('chat-title').fill(sample.chat)
    await page.getByTestId('setup-next').click()
    await page.getByTestId('source-path').fill(sample.source)
    await page.getByTestId('source-check').click()
    await expect(page.getByTestId('git-warning')).toBeVisible()
    await page.getByTestId('setup-next').click()
    await page.getByTestId('setup-next').click()
    await page.getByTestId('setup-next').click()
    const preview = page.getByTestId('setup-config-preview')
    await expect(preview).toContainText('avatarId')
    await expect(preview).toContainText('grape')
    await expect(preview).toContainText('avatarColor')
    await expect(preview).toContainText('violet')
    await page.getByTestId('setup-save').click()
    await expect(page.getByTestId('project-title')).toHaveText(sample.project, { timeout: 15_000 })
    const text = readFileSync(path.join(dir, 'config.yaml'), 'utf8')
    expect(text).toContain('avatarId: grape')
    expect(text).toContain('avatarColor: violet')
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
