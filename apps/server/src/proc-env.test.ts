/**
 * FILE: apps/server/src/proc-env.test.ts
 * НАЗНАЧЕНИЕ: ключи из .env и хранилища не попадают в окружение детей.
 * ВХОД: process.env с канарейкой и значение, которое журнал уже помнит.
 * ВЫХОД: git, браузер, проверка папки и процесс хранилища этой канарейки не видят.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { sourceGitEnv } from './config/source-check.js'
import { readOsSecret, resetOsSecretCache, useOsSpawner, osChildEnv } from './llm/os-secret.js'
import { openBrowser } from './open-browser.js'
import { minimalChildEnv, secretInEnv } from './proc-env.js'
import { forgetSecrets, rememberSecret } from './redact.js'
import { buildGitEnv } from './tools/git.js'

const ENV_NAME = 'DEEPSEEK_API_KEY'
const ENV_VALUE = 'env-canary-secret-value'
const STORE_VALUE = 'store-canary-secret-value'

afterEach(() => {
  delete process.env[ENV_NAME]
  delete process.env.TINYBOTS_CHILD_MARKER
  forgetSecrets()
  resetOsSecretCache()
  useOsSpawner(null)
})

function arm(): void {
  process.env[ENV_NAME] = ENV_VALUE
  process.env.TINYBOTS_CHILD_MARKER = 'marker'
  const previous = process.env.LANG
  process.env.LANG = STORE_VALUE
  rememberSecret(ENV_VALUE)
  rememberSecret(STORE_VALUE)
  return void previous
}

test('узкое окружение не копирует ключ и произвольную переменную', () => {
  const previousLang = process.env.LANG
  arm()
  try {
    for (const env of [minimalChildEnv(), osChildEnv(), sourceGitEnv(), buildGitEnv({})]) {
      expect(secretInEnv(env, [ENV_NAME], [ENV_VALUE, STORE_VALUE])).toBe(false)
      expect(env.TINYBOTS_CHILD_MARKER).toBeUndefined()
    }
    expect(process.env[ENV_NAME]).toBe(ENV_VALUE)
  } finally {
    if (previousLang === undefined) {
      delete process.env.LANG
    } else {
      process.env.LANG = previousLang
    }
  }
})

test('open-browser и процесс хранилища получают это окружение', async () => {
  const previousLang = process.env.LANG
  arm()
  try {
    let browserEnv: NodeJS.ProcessEnv | undefined
    openBrowser('http://127.0.0.1:9/', ((...args: unknown[]) => {
      const opts = args[2] as { env?: NodeJS.ProcessEnv }
      browserEnv = opts.env
      return { on() { return undefined }, unref() { return undefined } }
    }) as unknown as typeof import('node:child_process').spawn)
    expect(browserEnv).toBeDefined()
    expect(secretInEnv(browserEnv ?? {}, [ENV_NAME], [ENV_VALUE, STORE_VALUE])).toBe(false)

    let childEnv: NodeJS.ProcessEnv | undefined
    useOsSpawner((_cmd, args, opts) => {
      childEnv = opts.env
      expect(args.join(' ')).not.toContain(ENV_VALUE)
      expect(args.join(' ')).not.toContain(STORE_VALUE)
      return {
        stdout: { on() { return undefined } },
        stdin: { write() { return true }, end() { return undefined } },
        kill() { return true },
        on(event: string, cb: (code: number) => void) {
          if (event === 'close') {
            cb(0)
          }
          return this
        },
      } as unknown as ReturnType<typeof import('node:child_process').spawn>
    })
    await readOsSecret(ENV_NAME, new AbortController().signal)
    expect(secretInEnv(childEnv ?? {}, [ENV_NAME], [ENV_VALUE, STORE_VALUE])).toBe(false)
  } finally {
    if (previousLang === undefined) {
      delete process.env.LANG
    } else {
      process.env.LANG = previousLang
    }
  }
})

test('каждый spawn и execFile сервера передаёт env', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const hits: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name)
      if (statSync(abs).isDirectory()) {
        walk(abs)
        continue
      }
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) {
        continue
      }
      const text = readFileSync(abs, 'utf8')
      if (!/\b(spawn|spawnFn|spawnImpl|execFile|execFileCb)\s*\(/.test(text)) {
        continue
      }
      hits.push(path.relative(root, abs))
      expect(text.includes('env:') || text.includes('env,') || text.includes('minimalChildEnv') || text.includes('buildGitEnv') || text.includes('osChildEnv') || text.includes('sourceGitEnv') || text.includes('withoutSecrets'), abs).toBe(true)
    }
  }
  walk(root)
  expect(hits).toEqual(expect.arrayContaining([
    path.join('src', 'open-browser.ts'),
    path.join('src', 'llm', 'os-secret.ts'),
    path.join('src', 'tools', 'git.ts'),
    path.join('src', 'config', 'source-check.ts'),
  ]))
})
