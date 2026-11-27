/**
 * FILE: apps/server/src/desktop-data.test.ts
 * НАЗНАЧЕНИЕ: первый запуск пишет пустой список, второй не трогает ботов, битый файл остаётся.
 * Браузерный режим флаг --data-dir не включает.
 */

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { EMPTY_BOTS_JSON, desktopDataDir, ensureBotsFile, loadDesktopBots, parseBotsList } from './desktop-data.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    const file = path.join(dir, 'bots.json')
    if (existsSync(file)) {
      chmodSync(file, 0o644)
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'tinybots-data-'))
  dirs.push(dir)
  return dir
}

test('первый запуск создаёт пустой список, который проходит схему', () => {
  const dir = scratch()
  expect(ensureBotsFile(dir)).toBe('created')
  const raw = readFileSync(path.join(dir, 'bots.json'), 'utf8')
  expect(raw).toBe(EMPTY_BOTS_JSON)
  expect(parseBotsList(raw).ok).toBe(true)
  const loaded = loadDesktopBots(dir)
  expect(loaded.status).toBe(200)
  if (loaded.status === 200) {
    expect(loaded.body).toEqual([])
  }
})

test('второй запуск не меняет файл с ботами', () => {
  const dir = scratch()
  const file = path.join(dir, 'bots.json')
  const body = '[{"id":"lead1","name":"Ава","role":"тимлид","grok_id":"demo-ava"}]\n'
  writeFileSync(file, body, 'utf8')
  chmodSync(file, 0o444)
  expect(ensureBotsFile(dir)).toBe('kept')
  expect(readFileSync(file, 'utf8')).toBe(body)
  const loaded = loadDesktopBots(dir)
  expect(loaded.status).toBe(200)
  if (loaded.status === 200) {
    expect(loaded.body).toEqual([{ id: 'lead1', name: 'Ава', role: 'тимлид', grok_id: 'demo-ava' }])
  }
})

test('битый файл не перезаписывается', () => {
  const dir = scratch()
  const file = path.join(dir, 'bots.json')
  const broken = '{ не json'
  writeFileSync(file, broken, 'utf8')
  chmodSync(file, 0o444)
  expect(ensureBotsFile(dir)).toBe('invalid')
  expect(readFileSync(file, 'utf8')).toBe(broken)
  const loaded = loadDesktopBots(dir)
  expect(loaded.status).toBe(500)
  if (loaded.status === 500) {
    expect(loaded.body.error).toBe('bots_invalid')
    expect(loaded.log).toBe('bots.json повреждён, файл не перезаписан')
  }
  expect(readFileSync(file, 'utf8')).toBe(broken)
})

test('браузер и отказ не берут --data-dir, окно берёт', () => {
  const argv = ['--data-dir', path.join('var', 'tinybots-data')]
  expect(desktopDataDir('browser', ['--browser', ...argv])).toBeNull()
  expect(desktopDataDir('refuse', argv)).toBeNull()
  expect(desktopDataDir('desktop', ['--session-stdin', ...argv])).toBe(path.resolve(path.join('var', 'tinybots-data')))
  expect(desktopDataDir('desktop', ['--session-stdin'])).toBeNull()
})
