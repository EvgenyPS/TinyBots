/**
 * FILE: e2e/b7-lead.spec.ts
 * НАЗНАЧЕНИЕ: B6 (подпись при переходе к главному проекта), B7 и B10 (фолбэк без grok id).
 * Пауза и пустой главный не рисуют превью. Пустой id показывает имя и подсказку, без ссылки.
 */

import { expect, test } from '@playwright/test'
import { boot } from './harness'

test('пауза, пустой главный, проектный главный и ручной чат', async ({ page }) => {
  const server = await boot('demo/sets/lead-cases/config.yaml')
  try {
    await page.goto(`http://127.0.0.1:${server.port}`)
    await expect(page.getByTestId('shell')).toBeVisible()

    await page.getByTestId('brief-task-task-hold').click()
    await expect(page.getByTestId('brief-error')).toContainText('Тишь')
    await expect(page.getByTestId('brief-error')).toContainText('Выберите главного')
    await expect(page.getByTestId('brief-preview')).toHaveCount(0)

    await page.getByTestId('project-demo-bare').click()
    await page.getByTestId('brief-task-task-bare').click()
    await expect(page.getByTestId('brief-error')).toContainText('не задан')
    await expect(page.getByTestId('brief-error')).toContainText('Выберите главного')
    await expect(page.getByTestId('brief-preview')).toHaveCount(0)

    await page.getByTestId('project-demo-loom').click()
    await page.getByTestId('chat-relay').click()
    await page.getByTestId('brief-task-task-relay').click()
    await expect(page.getByTestId('brief-recipient')).toHaveText('Уйдёт: Нить')
    await expect(page.getByTestId('brief-fallback')).toContainText('Нить')
    await expect(page.getByTestId('brief-fallback')).toContainText('вручную')
    await expect(page.getByTestId('open-lead-chat')).toHaveCount(0)

    await page.getByTestId('chat-plain').click()
    await page.getByTestId('brief-task-task-plain').click()
    await expect(page.getByTestId('brief-recipient')).toHaveText('Уйдёт: Нить')
    await expect(page.getByTestId('brief-fallback')).toContainText('Откройте чат «Нить» вручную.')
    await expect(page.getByTestId('open-lead-chat')).toHaveCount(0)
  } finally {
    await server.stop()
  }
})
