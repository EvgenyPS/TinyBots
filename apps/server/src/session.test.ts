/**
 * FILE: apps/server/src/session.test.ts
 * НАЗНАЧЕНИЕ: режим запуска и сравнение токена.
 * Браузер включается только флагом argv. Sea без токена не стартует.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  acceptSessionToken,
  BROWSER_FLAG,
  planLaunch,
  sessionTokensMatch,
  takeTokenLine,
  tokenFromLine,
} from './session.js'

const TOKEN = 'ab'.repeat(32)

describe('запуск', () => {
  test('браузер только явным флагом, окружение не считается', () => {
    const env = {
      TINYBOTS_BROWSER: '1',
      BROWSER: '1',
      npm_config_browser: 'true',
      TINYBOTS_NO_TOKEN: '1',
    }
    expect(planLaunch([], false, env).kind).toBe('refuse')
    expect(planLaunch([BROWSER_FLAG], false, env).kind).toBe('browser')
    expect(planLaunch(['--session-stdin'], false).kind).toBe('desktop')
    expect(planLaunch(['--browser', '--session-stdin'], false).kind).toBe('refuse')
  })

  test('собранный sidecar без токена не стартует', () => {
    expect(planLaunch([], true).kind).toBe('refuse')
    expect(planLaunch(['--browser'], true).kind).toBe('refuse')
    expect(planLaunch(['--session-stdin'], true).kind).toBe('desktop')
    const source = readFileSync(fileURLToPath(new URL('./main.ts', import.meta.url)), 'utf8')
    expect(source.includes('TINYBOTS_BROWSER')).toBe(false)
    expect(source.includes('TINYBOTS_NO_TOKEN')).toBe(false)
    expect(source.includes('planLaunch')).toBe(true)
    expect(source.includes('openBrowser(url)')).toBe(true)
  })
})

describe('токен', () => {
  test('ровно 32 байта hex и сравнение с проверкой длины', () => {
    expect(acceptSessionToken(TOKEN)).toBe(true)
    expect(TOKEN.length).toBe(64)
    expect(sessionTokensMatch(TOKEN, TOKEN)).toBe(true)
    expect(sessionTokensMatch(TOKEN, undefined)).toBe(false)
    expect(sessionTokensMatch(TOKEN, '')).toBe(false)
    expect(sessionTokensMatch(TOKEN, TOKEN.slice(0, 63))).toBe(false)
    expect(sessionTokensMatch(TOKEN, `${TOKEN}aa`)).toBe(false)
    expect(sessionTokensMatch(TOKEN, 'cd'.repeat(32))).toBe(false)
    expect(sessionTokensMatch('short', 'short')).toBe(false)
    expect(tokenFromLine(`${TOKEN}\r`)).toBe(TOKEN)
    expect(tokenFromLine('nope')).toBeNull()
    expect(takeTokenLine('abcd')).toEqual({ done: false })
    expect(takeTokenLine(`${TOKEN}\n`)).toEqual({ done: true, ok: true })
    expect(takeTokenLine('zzzz\n')).toEqual({ done: true, ok: false })
  })
})
