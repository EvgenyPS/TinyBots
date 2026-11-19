/**
 * FILE: e2e/b1-config.spec.ts
 * НАЗНАЧЕНИЕ: B1. Второй демо-набор меняет рейл, чаты, орбиту, карточку, задания, канбан и правила.
 * Старые имена на экране не остаются. /api/bots каркаса при этом по-прежнему отдаёт первый список.
 */

import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'

const OLD = ['Ава', 'Бит', 'Тэст', 'Рев', 'Demo Game', 'Сборка', 'Alex', 'Превью в доке', 'код, тесты, ревью']

test('пульт строится из второго конфига', async ({ page }) => {
  const server = await boot('demo/sets/beta/config.yaml')
  try {
    const base = origin(server.port)
    await page.goto(base)
    await expect(page.getByTestId('shell')).toBeVisible()
    const firstPaint = await page.getByTestId('shell').innerText()
    for (const name of OLD) {
      expect(firstPaint, name).not.toContain(name)
    }
    await expect(page.getByTestId('project-title')).toHaveText('Demo Harbor')
    await expect(page.getByTestId('owner-name')).toContainText('Mira')
    await expect(page.getByTestId('chat-yard')).toContainText('Верфь')
    await expect(page.getByTestId('orbit-bot-nova1')).toContainText('Нова')
    await expect(page.getByTestId('orbit-note-kit1')).toContainText('каркас стоит ровно')

    const legacy = (await (await page.request.get(`${base}/api/bots`)).json()) as Array<{ name: string }>
    expect(legacy.map((bot) => bot.name)).toContain('Ава')

    await page.getByTestId('orbit-bot-kit1').click()
    await expect(page.getByTestId('bot-card')).toContainText('Кит')
    await expect(page.getByTestId('card-note')).toContainText('каркас стоит ровно')

    await page.getByTestId('tab-tasks').click()
    await expect(page.getByTestId('task-task-h1')).toContainText('Каркас причала')

    await page.getByTestId('tab-kanban').click()
    await expect(page.getByTestId('column-working')).toContainText('Каркас причала')
    await expect(page.getByTestId('column-new')).toContainText('Схема швартовки')
    await expect(page.getByTestId('column-review')).toContainText('Осмотр швов')
    await expect(page.getByTestId('column-done')).toContainText('План фарватера')

    await page.getByTestId('tab-rules').click()
    await expect(page.getByTestId('rules-do-yard')).toContainText('чертёж корпуса и проверка швов')

    const text = await page.getByTestId('shell').innerText()
    for (const name of OLD) {
      expect(text, name).not.toContain(name)
    }

  } finally {
    await server.stop()
  }
})
