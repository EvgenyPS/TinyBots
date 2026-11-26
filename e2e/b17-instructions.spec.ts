/**
 * FILE: e2e/b17-instructions.spec.ts
 * НАЗНАЧЕНИЕ: шаг «Боты» — шаблон инструкций и id с суффиксом -bot.
 * Подстановка, вопрос перед затиранием, Ревик, ручной nora и дубль id.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'

const dir = path.join(process.cwd(), 'data', 'e2e-b17-instructions')

test('шаблон подставляет текст и спрашивает, если поле уже правили', async ({ page }) => {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.join(dir, 'app'), { recursive: true })
  writeFileSync(path.join(dir, 'app', 'note.txt'), 'demo\n')
  const server = await boot('data/e2e-b17-instructions/config.yaml')
  try {
    await page.goto(origin(server.port))
    await page.getByTestId('owner-name').fill('Ника')
    await page.getByTestId('setup-next').click()
    await page.getByTestId('bot-name-0').fill('Ревик')
    await page.getByTestId('bot-role-0').fill('код')
    await page.getByTestId('bot-api-0').check()

    await page.getByTestId('bot-template-0').click()
    await expect(page.getByTestId('bot-template-list-0')).toBeVisible()
    await page.getByTestId('bot-template-option-helper').click()
    await expect(page.getByTestId('bot-instructions-0')).toHaveValue(/Ты помощник владельца в этом проекте\./)

    await page.getByTestId('bot-template-0').click()
    await page.getByTestId('bot-template-option-custom').click()
    await expect(page.getByTestId('bot-instructions-0')).toHaveValue('')

    await page.getByTestId('bot-template-0').click()
    await page.getByTestId('bot-template-option-helper').click()
    await page.getByTestId('bot-instructions-0').fill('Свой текст для этого бота.')
    await page.getByTestId('bot-template-0').click()
    await page.getByTestId('bot-template-option-developer').click()
    await expect(page.getByTestId('bot-template-confirm-0')).toBeVisible()
    await page.getByTestId('bot-template-keep-0').click()
    await expect(page.getByTestId('bot-instructions-0')).toHaveValue('Свой текст для этого бота.')
    await expect(page.getByTestId('bot-template-confirm-0')).toHaveCount(0)

    await page.getByTestId('bot-template-0').click()
    await page.getByTestId('bot-template-option-custom').click()
    await expect(page.getByTestId('bot-instructions-0')).toHaveValue('Свой текст для этого бота.')
    await expect(page.getByTestId('bot-template-confirm-0')).toHaveCount(0)

    await page.getByTestId('bot-template-0').click()
    await page.getByTestId('bot-template-option-developer').click()
    await page.getByTestId('bot-template-replace-0').click()
    await expect(page.getByTestId('bot-instructions-0')).toHaveValue(/Ты разработчик в этом проекте\./)

    await page.getByTestId('bot-extra-summary-0').click()
    await expect(page.getByTestId('bot-id-0')).toHaveValue('revik-bot')
    await page.getByTestId('bot-id-0').fill('nora')
    await expect(page.getByTestId('bot-id-0')).toHaveValue('nora')
    await page.getByTestId('bot-id-0').blur()
    await expect(page.getByTestId('bot-id-0')).toHaveValue('nora-bot')
    await page.getByTestId('bot-id-0').fill('nora-bot')
    await page.getByTestId('bot-id-0').blur()
    await expect(page.getByTestId('bot-id-0')).toHaveValue('nora-bot')

    await page.getByRole('button', { name: 'Добавить бота' }).click()
    await page.getByTestId('bot-name-1').fill('Мира')
    await page.getByTestId('bot-role-1').fill('текст')
    await page.getByTestId('bot-extra-summary-1').click()
    await page.getByTestId('bot-id-1').fill('nora')
    await page.getByTestId('bot-id-1').blur()
    await expect(page.getByTestId('bot-id-1')).toHaveValue('nora-bot')
    await page.getByTestId('setup-next').click()
    await expect(page.getByTestId('setup-error')).toHaveText('Id ботов должны различаться')
    await expect(page.getByTestId('bot-id-error-1')).toHaveText('Id ботов должны различаться')
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
