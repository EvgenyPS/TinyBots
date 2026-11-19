/**
 * FILE: apps/server/src/config/load.test.ts
 * НАЗНАЧЕНИЕ: B3 на разборе текста. Сервер тут не поднимается.
 * YAML-ошибка и нарушение схемы отдают файл, строку и причину.
 */

import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { locateConfig, parseConfigText, selectConfigRequest } from './load.js'

const SCHEMA_BROKEN = `schema_version: 1
owner:
  name: "Nika"
  confirms_merge: true
data_dir: "data"
delivery: nope
bots: []
projects: []
economy:
  defaults:
    wake: mentioned_only
    reply_limit: short
    max_wakes_per_task: 3
  stale_after_hours: 6
`

test('синтаксис YAML: строка и причина, без исключения', () => {
  const parsed = parseConfigText('schema_version: [', 'data/bad.yaml')
  expect(parsed.ok).toBe(false)
  if (!parsed.ok) {
    expect(parsed.file).toBe('data/bad.yaml')
    expect(parsed.line).toBe(1)
    expect(parsed.reason.length).toBeGreaterThan(0)
    expect(parsed.reason.toLowerCase()).toContain('flow')
  }
})

test('схема: строка поля delivery', () => {
  const parsed = parseConfigText(SCHEMA_BROKEN, 'data/schema.yaml')
  expect(parsed.ok).toBe(false)
  if (!parsed.ok) {
    expect(parsed.line).toBe(6)
    expect(parsed.reason.startsWith('delivery:')).toBe(true)
  }
})

test('путь конфига не выходит из корня', () => {
  const root = path.join(os.tmpdir(), 'tinybots-root')
  const outside = locateConfig(root, '../secret.yaml')
  const absolute = locateConfig(root, path.join(os.tmpdir(), 'config.yaml'))
  expect('ok' in outside).toBe(true)
  expect('ok' in absolute).toBe(true)
})

test('без явного пути берётся config.yaml, иначе демо-набор', () => {
  const previous = process.env.TINYBOTS_CONFIG
  delete process.env.TINYBOTS_CONFIG
  try {
    expect(selectConfigRequest('/no/such/root')).toBe('demo/sets/primary/config.yaml')
  } finally {
    if (previous === undefined) {
      delete process.env.TINYBOTS_CONFIG
    } else {
      process.env.TINYBOTS_CONFIG = previous
    }
  }
})
