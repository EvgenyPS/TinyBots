/**
 * FILE: apps/server/src/git/github.test.ts
 * НАЗНАЧЕНИЕ: D1 и G3–G4. GitHub только мок, токен не уходит в ответ и в журнал.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { loadDotEnv } from '../env.js'
import { logSafe } from '../redact.js'
import { DOWN_WARNING, judgeScopes, loadGitSummary, MISSING_WARNING, UNKNOWN_WARNING, WRITE_WARNING } from './github.js'

const TOKEN = 'tb-readonly-sentinel'
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function response(status: number, body: unknown, scopes: string | null): Response {
  const headers = new Headers()
  if (scopes !== null) {
    headers.set('x-oauth-scopes', scopes)
  }
  return new Response(JSON.stringify(body), { status, headers })
}

test('G3: scope с записью не стартует вкладку, чтение стартует', () => {
  expect(judgeScopes('repo', {})).toBe('write')
  expect(judgeScopes('repo:status, public_repo', {})).toBe('write')
  expect(judgeScopes('write:packages', {})).toBe('write')
  expect(judgeScopes('repo:status', {})).toBe('read')
  expect(judgeScopes('', {})).toBe('read')
  expect(judgeScopes(null, {})).toBe('unknown')
  expect(judgeScopes(null, { permissions: { contents: 'write', metadata: 'read' } })).toBe('write')
  expect(judgeScopes(null, { permissions: { contents: 'read', metadata: 'read' } })).toBe('read')
})

test('D1 и G3: мок GitHub отдаёт коммиты, diffstat, PR и CI без токена', async () => {
  const sha = 'abc1234abc1234abc1234abc1234abc1234abc12'
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const href = String(url)
    expect(href.includes(TOKEN)).toBe(false)
    if (href.endsWith('/user')) {
      return response(200, { login: 'demo-reader' }, 'repo:status')
    }
    if (href.includes('/commits?')) {
      return response(200, [{
        sha,
        commit: { message: `Превью пресетов\n\nне для экрана ${TOKEN}`, author: { name: 'Бит', date: '2026-11-19T09:15:00Z' } },
      }], null)
    }
    if (href.endsWith(`/commits/${sha}`)) {
      return response(200, {
        sha,
        stats: { additions: 18, deletions: 6 },
        files: [{ filename: 'src/app.txt', additions: 18, deletions: 6, patch: TOKEN }],
      }, null)
    }
    if (href.endsWith('/status')) {
      return response(200, { state: 'success', statuses: [{ context: 'build', state: 'success' }] }, null)
    }
    if (href.includes('/pulls?')) {
      return response(200, [{ number: 3, title: 'Превью', state: 'open', html_url: 'https://example.invalid/demo/pull/3' }], null)
    }
    return response(404, {}, null)
  })
  const summary = await loadGitSummary({
    token: TOKEN,
    repo: 'example/demo-game',
    apiBase: 'https://example.invalid',
    fetchImpl: fetchImpl as typeof fetch,
  })
  expect(summary.started).toBe(true)
  expect(summary.warning).toBeNull()
  expect(summary.commits[0]).toMatchObject({ message: 'Превью пресетов', author: 'Бит' })
  expect(summary.diffstat).toMatchObject({ additions: 18, deletions: 6, files: 1 })
  expect(summary.pulls[0]?.number).toBe(3)
  expect(summary.ci[0]).toEqual({ name: 'build', state: 'success' })
  expect(JSON.stringify(summary).includes(TOKEN)).toBe(false)
  const write = await loadGitSummary({
    token: TOKEN,
    repo: 'example/demo-game',
    apiBase: 'https://example.invalid',
    fetchImpl: (async () => response(200, { login: 'demo' }, 'repo')) as typeof fetch,
  })
  expect(write.started).toBe(false)
  expect(write.warning).toBe(WRITE_WARNING)
  expect(write.commits).toEqual([])
  const missing = await loadGitSummary({
    token: '',
    repo: 'example/demo-game',
    apiBase: 'https://example.invalid',
    fetchImpl: fetchImpl as typeof fetch,
  })
  expect(missing.warning).toBe(MISSING_WARNING)
  expect(missing.started).toBe(false)
})

test('неподтверждённые права и обрыв сети не стартуют вкладку', async () => {
  const unknown = await loadGitSummary({
    token: TOKEN,
    repo: 'example/demo-game',
    apiBase: 'https://example.invalid',
    fetchImpl: (async () => response(200, { login: 'demo' }, null)) as typeof fetch,
  })
  expect(unknown.warning).toBe(UNKNOWN_WARNING)
  const down = await loadGitSummary({
    token: TOKEN,
    repo: 'example/demo-game',
    apiBase: 'https://example.invalid',
    fetchImpl: (async () => {
      throw new Error(`сеть ${TOKEN}`)
    }) as typeof fetch,
  })
  expect(down.warning).toBe(DOWN_WARNING)
  expect(JSON.stringify(down).includes(TOKEN)).toBe(false)
})

test('G4: токен и строка .env не попадают в журнал', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tinybots-env-'))
  dirs.push(dir)
  const file = path.join(dir, '.env')
  const canary = 'canary-env-should-stay-out'
  writeFileSync(file, `GITHUB_TOKEN=${TOKEN}\nTINYBOTS_CANARY=${canary}\n`)
  const previous = process.env.GITHUB_TOKEN
  delete process.env.GITHUB_TOKEN
  const lines: string[] = []
  const original = console.info
  console.info = (...args: unknown[]) => {
    lines.push(args.map((item) => String(item)).join(' '))
  }
  try {
    loadDotEnv(file)
    logSafe(`проверка ${TOKEN} и ${canary} и GITHUB_TOKEN=${TOKEN}`)
  } finally {
    console.info = original
    delete process.env.TINYBOTS_CANARY
    if (previous === undefined) {
      delete process.env.GITHUB_TOKEN
    } else {
      process.env.GITHUB_TOKEN = previous
    }
  }
  const joined = lines.join('\n')
  expect(joined.includes(TOKEN)).toBe(false)
  expect(joined.includes(canary)).toBe(false)
  expect(joined.includes('[secret]')).toBe(true)
})
