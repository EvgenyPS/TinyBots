import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { loadDotEnv } from './env.js'

const created: string[] = []

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  delete process.env.TINYBOTS_TEST_TOKEN
  delete process.env.TINYBOTS_TEST_PORT
})

test('не затирает уже заданное и не печатает значения', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tinybots-env-'))
  created.push(dir)
  writeFileSync(
    path.join(dir, '.env'),
    ['TINYBOTS_TEST_PORT=1111', 'TINYBOTS_TEST_TOKEN=example', '# комментарий', ''].join('\n'),
    'utf8',
  )
  process.env.TINYBOTS_TEST_PORT = '2222'
  delete process.env.TINYBOTS_TEST_TOKEN
  loadDotEnv(path.join(dir, '.env'))
  expect(process.env.TINYBOTS_TEST_PORT).toBe('2222')
  expect(process.env.TINYBOTS_TEST_TOKEN).toBe('example')
})
