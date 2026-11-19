/**
 * FILE: apps/server/src/store/read.test.ts
 * НАЗНАЧЕНИЕ: B16. Метка синка — максимальный updated_at, не первый и не последний файл.
 * Если выбор сломают на «возьми крайний по имени», оба теста падают: время будет не то.
 */

import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { repoRoot } from '../root.js'
import { readLatestSync } from './read.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function manifest(updatedAt: string): string {
  return JSON.stringify({
    schema_version: 1,
    updated_at: updatedAt,
    entries: [],
  })
}

test('поздний манифест в середине списка имён побеждает края', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tinybots-sync-'))
  dirs.push(dir)
  const sync = path.join(dir, 'sync')
  mkdirSync(sync)
  writeFileSync(path.join(sync, 'a-early.json'), manifest('2026-11-01T00:00:00Z'))
  writeFileSync(path.join(sync, 'm-late.json'), manifest('2026-11-19T09:15:00Z'))
  writeFileSync(path.join(sync, 'z-mid.json'), manifest('2026-11-10T00:00:00Z'))
  writeFileSync(path.join(sync, 'broken.json'), '{')
  expect(readLatestSync(dir)).toBe('2026-11-19T09:15:00Z')
})

test('демо primary: самый поздний файл не первый и не последний по имени', () => {
  const dir = path.join(repoRoot(), 'demo', 'sets', 'primary', 'data')
  const names = readdirSync(path.join(dir, 'sync')).filter((name) => name.endsWith('.json')).sort()
  expect(names[0]).toBe('a-sync.json')
  expect(names[names.length - 1]).toBe('z-sync.json')
  expect(readLatestSync(dir)).toBe('2026-11-19T09:15:00Z')
})
