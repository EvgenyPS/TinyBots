/**
 * FILE: apps/server/src/time.test.ts
 * НАЗНАЧЕНИЕ: B4 и B13 на чистых функциях, без браузера.
 * Граница порога и две зоны одного мгновения.
 */

import { expect, test } from 'vitest'
import { formatHm, isStale } from './time.js'

const UPDATED = '2026-11-19T02:00:00.000Z'

test('ровно stale_after_hours ещё свежая, на миллисекунду старше — нет', () => {
  expect(isStale(UPDATED, new Date('2026-11-19T08:00:00.000Z'), 6)).toBe(false)
  expect(isStale(UPDATED, new Date('2026-11-19T08:00:00.001Z'), 6)).toBe(true)
  expect(isStale('не-время', new Date('2026-11-19T08:00:00.000Z'), 6)).toBe(true)
})

test('одно мгновение в двух зонах даёт разное ЧЧ:ММ', () => {
  const iso = '2026-11-19T09:15:00.000Z'
  expect(formatHm(iso, 'Europe/Moscow')).toBe('12:15')
  expect(formatHm(iso, 'America/New_York')).toBe('04:15')
  expect(formatHm(iso, 'Asia/Tokyo')).toBe('18:15')
  expect(formatHm(iso, 'Нет/Такой')).toBe('09:15')
  expect(formatHm('вчера', 'UTC')).toBe('—')
})
