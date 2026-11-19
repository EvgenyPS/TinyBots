/**
 * FILE: e2e/b4-timezone.spec.ts
 * НАЗНАЧЕНИЕ: B4. Одно и то же мгновение синка в двух зонах из конфига.
 * Подпись на экране совпадает с ответом API.
 */

import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'

const cases = [
  { file: 'demo/sets/primary/config.yaml', label: '12:15', note: 'orbit-note-dev1', noteTime: '12:30' },
  { file: 'demo/sets/beta/config.yaml', label: '04:15', note: 'orbit-note-kit1', noteTime: '04:30' },
]

for (const item of cases) {
  test(item.file, async ({ page }) => {
    const server = await boot(item.file)
    try {
      const base = origin(server.port)
      const sync = (await (await page.request.get(`${base}/api/sync`)).json()) as { synced_label: string }
      expect(sync.synced_label).toBe(item.label)
      await page.goto(base)
      await expect(page.getByTestId('sync-label')).toHaveText(`данные на ${sync.synced_label}`)
      await expect(page.getByTestId(item.note)).toContainText(`обновлено ${item.noteTime}`)
    } finally {
      await server.stop()
    }
  })
}
