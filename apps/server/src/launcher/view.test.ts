/**
 * FILE: apps/server/src/launcher/view.test.ts
 * НАЗНАЧЕНИЕ: данные пульта из демо-наборов. Часы подменены на 2026-11-19T10:00:00Z.
 * B4, B13, B14, B16 здесь без браузера. Имена второго набора не содержат первый.
 */

import { expect, test } from 'vitest'
import { repoRoot } from '../root.js'
import { loadLauncher } from './view.js'

const NOW = new Date('2026-11-19T10:00:00.000Z')

function launch(configPath: string) {
  return loadLauncher(repoRoot(), { configPath, now: () => NOW })
}

test('primary: зона Москвы, свежая и серая записки, нет записки, метка синка', () => {
  const view = launch('demo/sets/primary/config.yaml')
  expect(view.ok).toBe(true)
  if (!view.ok) {
    return
  }
  expect(view.delivery).toBe('clipboard')
  expect(view.projects.map((project) => project.title)).toEqual(['Demo Game'])
  expect(view.bots.map((bot) => bot.name)).toEqual(['Ава', 'Бит', 'Тэст', 'Рев'])
  expect(view.chats.map((chat) => chat.title)).toEqual(['Сборка'])
  expect(view.synced_at).toBe('2026-11-19T09:15:00Z')
  expect(view.synced_label).toBe('12:15')
  const byId = new Map(view.notes.map((note) => [note.bot_id, note]))
  expect(byId.get('dev1')).toMatchObject({ status: 'ok', stale: false, updated_label: '12:30', text: 'превью открывается' })
  expect(byId.get('qa1')).toMatchObject({ status: 'ok', stale: true, updated_label: '05:00' })
  expect(byId.get('rev1')?.status).toBe('missing')
  expect(view.tasks.map((task) => task.goal)).toContain('Превью в доке')
})

test('beta: другие имена и нью-йоркское время того же синка', () => {
  const view = launch('demo/sets/beta/config.yaml')
  expect(view.ok).toBe(true)
  if (!view.ok) {
    return
  }
  expect(view.owner.name).toBe('Вега')
  expect(view.synced_label).toBe('04:15')
  const text = JSON.stringify(view)
  for (const oldName of ['Ава', 'Бит', 'Тэст', 'Рев', 'Demo Game', 'Сборка', 'Alex']) {
    expect(text.includes(oldName), oldName).toBe(false)
  }
  expect(view.bots.map((bot) => bot.name)).toContain('Нова')
  expect(view.chats[0]?.rules.do).toContain('чертёж корпуса')
})

test('пустые наборы: нет проектов, нет ботов, нет записок', () => {
  const noProjects = launch('demo/sets/no-projects/config.yaml')
  const noBots = launch('demo/sets/no-bots/config.yaml')
  const noNotes = launch('demo/sets/no-notes/config.yaml')
  expect(noProjects.ok && noProjects.projects).toEqual([])
  expect(noBots.ok && noBots.bots).toEqual([])
  expect(noNotes.ok).toBe(true)
  if (noNotes.ok) {
    expect(noNotes.notes.every((note) => note.status === 'missing')).toBe(true)
    expect(noNotes.synced_label).toBe('12:15')
  }
})
