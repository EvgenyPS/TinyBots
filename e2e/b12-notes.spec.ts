/**
 * FILE: e2e/b12-notes.spec.ts
 * НАЗНАЧЕНИЕ: B12, B13, B14 (нет файла) и B16 на первом демо-наборе.
 * Часы подменены: 2026-11-19T10:00:00Z. Записка Тэст старше 6 часов, Рев без файла.
 */

import { mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'

test('записки, устарело и метка синка', async ({ page }) => {
  const server = await boot('demo/sets/primary/config.yaml')
  try {
    const base = origin(server.port)
    const sync = (await (await page.request.get(`${base}/api/sync`)).json()) as { synced_at: string; synced_label: string }
    expect(sync.synced_at).toBe('2026-11-19T09:15:00Z')
    await page.goto(base)
    await expect(page.getByTestId('sync-label')).toHaveText(`данные на ${sync.synced_label}`)
    await expect(page.getByTestId('sync-label')).toHaveText('данные на 12:15')

    const fresh = page.getByTestId('orbit-note-dev1')
    await expect(fresh).toContainText('превью открывается')
    await expect(fresh).toContainText('обновлено 12:30')
    await expect(fresh).not.toContainText('устарело')

    const stale = page.getByTestId('orbit-note-qa1')
    await expect(stale).toHaveClass(/is-stale/)
    await expect(stale).toContainText('устарело')
    await expect(stale).toContainText('обновлено 05:00')

    await expect(page.getByTestId('orbit-note-rev1')).toContainText('нет записки')

    await page.getByTestId('orbit-bot-dev1').click()
    await expect(page.getByTestId('card-note')).toContainText('превью открывается')
    await expect(page.getByTestId('card-note')).toContainText('обновлено 12:30')

    await page.getByTestId('orbit-bot-qa1').click()
    await expect(page.getByTestId('card-note')).toHaveClass(/is-stale/)
    await expect(page.getByTestId('card-note')).toContainText('устарело')

    await page.getByTestId('orbit-bot-rev1').click()
    await expect(page.getByTestId('card-note')).toContainText('нет записки')
    await expect(page.getByTestId('shell')).toBeVisible()
    await page.getByTestId('orbit-bot-dev1').click()
    mkdirSync('test-results', { recursive: true })
    await page.screenshot({ path: 'test-results/launcher-demo.png' })
  } finally {
    await server.stop()
  }
})
