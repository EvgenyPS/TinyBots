/**
 * FILE: e2e/wizard-flow.ts
 * НАЗНАЧЕНИЕ: проход семи шагов так, как его пройдёт человек.
 * ВХОД: страница, на которой мастер уже открыт, и вымышленные имена.
 * ВЫХОД: пульт с этим проектом. Источник без своего git показывает предупреждение.
 */

import { expect, type Page } from '@playwright/test'

export type WizardSample = {
  owner: string
  bot: string
  role: string
  project: string
  chat: string
  source: string
  botId: string
}

export const sample: WizardSample = {
  owner: 'Nika',
  bot: 'Кедр',
  role: 'код',
  project: 'Demo Kit',
  chat: 'Сборка',
  source: 'app',
  botId: 'kedr',
}

export async function fillUntilSource(page: Page, data: WizardSample): Promise<void> {
  await expect(page.getByTestId('setup-wizard')).toBeVisible()
  await expect(page.getByTestId('setup-step')).toHaveCount(8)
  const steps = page.getByTestId('setup-steps')
  await expect(steps).toHaveAttribute('data-steps', '8')
  expect(Number(await steps.getAttribute('data-steps'))).toBeLessThanOrEqual(10)
  await page.getByTestId('owner-name').fill(data.owner)
  await page.getByTestId('setup-next').click()
  await page.getByTestId('bot-name-0').fill(data.bot)
  await page.getByTestId('bot-role-0').fill(data.role)
  await page.getByTestId('setup-next').click()
  await page.getByTestId('project-title').fill(data.project)
  await page.getByTestId('setup-next').click()
  await page.getByTestId('chat-title').fill(data.chat)
  await page.getByTestId('setup-next').click()
  await expect(page.getByTestId('source-path')).toBeVisible()
}

export async function passWizard(page: Page, data: WizardSample): Promise<void> {
  await fillUntilSource(page, data)
  await page.getByTestId('source-path').fill(data.source)
  await page.getByTestId('source-check').click()
  await expect(page.getByTestId('git-warning')).toHaveText('вкладка Git будет скрыта')
  await page.getByTestId('setup-next').click()
  await page.getByTestId('setup-next').click()
  await page.getByTestId('setup-next').click()
  await page.getByTestId('setup-save').click()
  await expect(page.getByTestId('project-title')).toHaveText(data.project, { timeout: 15_000 })
  await expect(page.getByTestId('owner-name')).toContainText(data.owner)
  await expect(page.getByTestId(`orbit-bot-${data.botId}`)).toContainText(data.bot)
}
