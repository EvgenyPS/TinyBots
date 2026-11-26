/**
 * FILE: e2e/b17-bot-fields.spec.ts
 * НАЗНАЧЕНИЕ: шаг «Боты» — список моделей, автоподстановка и блок «Дополнительно».
 * ВХОД: мастер без своего config.yaml.
 * ВЫХОД: поля видны после раскрытия, ручная правка не затирается, узкий экран складывает пары.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'

const dir = path.join(process.cwd(), 'data', 'e2e-b17-bots')

function tracks(value: string): number {
  return value.split(' ').filter((part) => part.length > 0).length
}

test('свой бот: пресеты, «Дополнительно» и два столбца', async ({ page }) => {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.join(dir, 'app'), { recursive: true })
  writeFileSync(path.join(dir, 'app', 'note.txt'), 'demo\n')
  const server = await boot('data/e2e-b17-bots/config.yaml')
  try {
    await page.goto(origin(server.port))
    await page.getByTestId('owner-name').fill('Nika')
    await page.getByTestId('setup-next').click()
    await page.getByTestId('bot-name-0').fill('Кедр')
    await page.getByTestId('bot-role-0').fill('код')

    const wideName = await page.getByTestId('bot-pair-name-0').evaluate((el) => getComputedStyle(el).gridTemplateColumns)
    expect(tracks(wideName)).toBe(2)
    await page.setViewportSize({ width: 390, height: 800 })
    const narrowName = await page.getByTestId('bot-pair-name-0').evaluate((el) => getComputedStyle(el).gridTemplateColumns)
    expect(tracks(narrowName)).toBe(1)
    await page.setViewportSize({ width: 1440, height: 900 })

    await page.getByTestId('bot-api-0').check()
    await page.getByTestId('bot-instructions-0').fill('Коротко.')
    const wideModel = await page.getByTestId('bot-pair-model-0').evaluate((el) => getComputedStyle(el).gridTemplateColumns)
    expect(tracks(wideModel)).toBe(2)
    await page.setViewportSize({ width: 390, height: 800 })
    const narrowModel = await page.getByTestId('bot-pair-model-0').evaluate((el) => getComputedStyle(el).gridTemplateColumns)
    expect(tracks(narrowModel)).toBe(1)
    await page.setViewportSize({ width: 1440, height: 900 })

    await expect(page.getByTestId('bot-model-0')).toHaveValue('deepseek-chat')
    const deepseekOptions = await page.getByTestId('bot-model-0').locator('option').allTextContents()
    expect(deepseekOptions).toEqual(['deepseek-chat', 'deepseek-reasoner', 'своя'])
    await expect.poll(() => page.getByTestId('bot-extra-0').evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false)
    await expect(page.getByTestId('bot-key-0')).toBeHidden()

    await page.getByTestId('bot-extra-summary-0').focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => page.getByTestId('bot-extra-0').evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true)
    await expect(page.getByTestId('bot-id-0')).toBeVisible()
    await expect(page.getByTestId('bot-key-0')).toHaveValue('DEEPSEEK_API_KEY')
    await expect(page.getByTestId('bot-base-0')).toHaveValue('https://api.deepseek.com')
    await expect(page.getByTestId('bot-key-0')).toBeVisible()

    await page.getByTestId('bot-provider-0').selectOption('qwen')
    await expect(page.getByTestId('bot-model-0')).toHaveValue('qwen4-max')
    await expect(page.getByTestId('bot-key-0')).toHaveValue('QWEN_API_KEY')
    await expect(page.getByTestId('bot-base-0')).toHaveValue('https://dashscope.aliyuncs.com/compatible-mode/v1')

    await page.getByTestId('bot-model-0').selectOption('__custom__')
    await page.getByTestId('bot-model-custom-0').fill('my-model')
    await page.getByTestId('bot-base-0').fill('https://model.example/v1')
    await page.getByTestId('bot-key-0').fill('MY_BOT_API_KEY')
    await page.getByTestId('bot-model-0').selectOption('qwen3.7-plus')
    await expect(page.getByTestId('bot-base-0')).toHaveValue('https://model.example/v1')
    await expect(page.getByTestId('bot-key-0')).toHaveValue('MY_BOT_API_KEY')

    await page.getByTestId('bot-model-0').selectOption('__custom__')
    await page.getByTestId('bot-model-custom-0').fill('my-model')
    await page.getByTestId('bot-provider-0').selectOption('deepseek')
    await expect(page.getByTestId('bot-model-custom-0')).toHaveValue('my-model')
    await expect(page.getByTestId('bot-base-0')).toHaveValue('https://model.example/v1')
    await expect(page.getByTestId('bot-key-0')).toHaveValue('MY_BOT_API_KEY')

    await page.getByTestId('bot-key-0').fill('nope')
    await page.getByTestId('bot-extra-summary-0').click()
    await expect(page.getByTestId('bot-key-0')).toBeHidden()
    await page.getByTestId('setup-next').click()
    await expect(page.getByTestId('setup-error')).toHaveText('Имя ключа — переменная вида NAME_API_KEY')
    await expect(page.getByTestId('bot-key-0')).toBeVisible()
    await expect.poll(() => page.getByTestId('bot-extra-0').evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true)
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
