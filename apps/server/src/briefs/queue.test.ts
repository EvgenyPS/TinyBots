/**
 * FILE: apps/server/src/briefs/queue.test.ts
 * НАЗНАЧЕНИЕ: B11. Очередь выключена, пока delivery не queue.
 * Второй запуск в те же сутки зоны конфига отклоняется и для кнопки, и для расписания.
 */

import { expect, test } from 'vitest'
import { loadConfigAt } from '../config/load.js'
import { repoRoot } from '../root.js'
import { decideQueueLaunch } from './queue.js'

const CONFIGS = [
  'config.example.yaml',
  'demo/sets/primary/config.yaml',
  'demo/sets/beta/config.yaml',
  'demo/sets/no-projects/config.yaml',
  'demo/sets/no-bots/config.yaml',
  'demo/sets/no-notes/config.yaml',
  'demo/sets/lead-cases/config.yaml',
]

test('в примере и демо-наборах очередь выключена', () => {
  for (const file of CONFIGS) {
    const loaded = loadConfigAt(repoRoot(), file)
    expect(loaded.ok, file).toBe(true)
    if (loaded.ok) {
      expect(loaded.config.delivery, file).toBe('clipboard')
    }
  }
})

test('clipboard не запускает очередь ни кнопкой, ни расписанием', () => {
  const now = new Date('2026-11-19T12:00:00Z')
  expect(decideQueueLaunch({
    delivery: 'clipboard',
    lastLaunchAt: null,
    now,
    timeZone: 'UTC',
    source: 'button',
  })).toEqual({ ok: false, reason: 'disabled' })
  expect(decideQueueLaunch({
    delivery: 'clipboard',
    lastLaunchAt: null,
    now,
    timeZone: 'UTC',
    source: 'schedule',
  })).toEqual({ ok: false, reason: 'disabled' })
})

test('второй запуск в те же сутки отклонён, кнопка расписание не обходит', () => {
  const morning = new Date('2026-11-19T08:00:00Z')
  expect(decideQueueLaunch({
    delivery: 'queue',
    lastLaunchAt: null,
    now: morning,
    timeZone: 'UTC',
    source: 'button',
  })).toEqual({ ok: true })
  expect(decideQueueLaunch({
    delivery: 'queue',
    lastLaunchAt: morning.toISOString(),
    now: new Date('2026-11-19T18:30:00Z'),
    timeZone: 'UTC',
    source: 'schedule',
  })).toEqual({ ok: false, reason: 'already_today' })
  expect(decideQueueLaunch({
    delivery: 'queue',
    lastLaunchAt: morning.toISOString(),
    now: new Date('2026-11-19T21:00:00Z'),
    timeZone: 'UTC',
    source: 'button',
  })).toEqual({ ok: false, reason: 'already_today' })
})

test('следующие сутки и граница зоны разрешают один новый запуск', () => {
  expect(decideQueueLaunch({
    delivery: 'queue',
    lastLaunchAt: '2026-11-19T08:00:00Z',
    now: new Date('2026-11-20T00:30:00Z'),
    timeZone: 'UTC',
    source: 'schedule',
  })).toEqual({ ok: true })
  // 20:00Z — ещё 19-е в Москве, 21:30Z — уже 20-е. Сутки считаем по зоне конфига, не по UTC.
  expect(decideQueueLaunch({
    delivery: 'queue',
    lastLaunchAt: '2026-11-19T20:00:00Z',
    now: new Date('2026-11-19T21:30:00Z'),
    timeZone: 'Europe/Moscow',
    source: 'button',
  })).toEqual({ ok: true })
  expect(decideQueueLaunch({
    delivery: 'queue',
    lastLaunchAt: '2026-11-19T21:30:00Z',
    now: new Date('2026-11-19T22:00:00Z'),
    timeZone: 'Europe/Moscow',
    source: 'schedule',
  })).toEqual({ ok: false, reason: 'already_today' })
})

test('непонятная метка прошлого запуска не блокирует день навсегда', () => {
  expect(decideQueueLaunch({
    delivery: 'queue',
    lastLaunchAt: 'вчера',
    now: new Date('2026-11-19T12:00:00Z'),
    timeZone: 'UTC',
    source: 'schedule',
  })).toEqual({ ok: true })
})
