/**
 * FILE: apps/server/src/llm/store.test.ts
 * НАЗНАЧЕНИЕ: H11, H12 и H13 на диске. 101-е сообщение вытесняет первое.
 * Счётчик читается заново. Без usage нет оценки и нет значения ключа.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apiUsageSchema } from '@tinybots/schema'
import { afterEach, expect, test } from 'vitest'
import { addUsage, readChat, readWakeCount, trimMessages, usageLabel, writeChat, writeWakeCount } from './store.js'

const dirs: string[] = []
const now = new Date('2026-11-19T10:00:00.000Z')

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'tinybots-llm-'))
  dirs.push(dir)
  return dir
}

test('101-е сообщение вытесняет первое, битый файл не роняет чтение', async () => {
  const dir = tempDir()
  const messages = Array.from({ length: 101 }, (_, index) => ({
    role: 'user' as const,
    text: `m${index}`,
    at: '2026-11-19T10:00:00.000Z',
  }))
  expect(trimMessages(messages)).toHaveLength(100)
  expect(trimMessages(messages)[0]?.text).toBe('m1')
  await writeChat(dir, 'nora', messages, now)
  const stored = readChat(dir, 'nora')
  expect(stored.messages).toHaveLength(100)
  expect(stored.messages[0]?.text).toBe('m1')
  expect(stored.messages.some((item) => item.text === 'm0')).toBe(false)
  writeFileSync(path.join(dir, 'chats', 'nora.json'), '{', 'utf8')
  const broken = readChat(dir, 'nora')
  expect(broken.broken).toBe(true)
  expect(broken.messages).toEqual([])
})

test('счётчик тот же при повторном чтении с диска', async () => {
  const dir = tempDir()
  await writeWakeCount(dir, 'task-01', 2, now)
  expect(readWakeCount(dir, 'task-01')).toBe(2)
  expect(readWakeCount(dir, 'task-01')).toBe(2)
})

test('usage проходит схему, без usage нет оценки и нет значения ключа', async () => {
  const dir = tempDir()
  const key = 'demo-deepseek-key'
  await addUsage(dir, 'DEEPSEEK_API_KEY', null, now)
  expect(usageLabel(dir, 'DEEPSEEK_API_KEY')).toBe('нет данных')
  await addUsage(dir, 'DEEPSEEK_API_KEY', { prompt: 2, completion: 3, total: 5 }, now)
  const file = path.join(dir, 'api-usage', 'DEEPSEEK_API_KEY.json')
  const text = readFileSync(file, 'utf8')
  expect(text.includes(key)).toBe(false)
  expect(text.includes('savings_estimate')).toBe(false)
  expect(apiUsageSchema.safeParse(JSON.parse(text)).success).toBe(true)
  expect(usageLabel(dir, 'DEEPSEEK_API_KEY')).toBe('prompt 2 · completion 3')
  await addUsage(dir, 'DEEPSEEK_API_KEY', null, now)
  const after = readFileSync(file, 'utf8')
  expect(after.includes('savings_estimate')).toBe(false)
  expect(after.includes(key)).toBe(false)
  expect(usageLabel(dir, 'DEEPSEEK_API_KEY')).toBe('нет данных')
})
