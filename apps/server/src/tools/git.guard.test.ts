/**
 * FILE: apps/server/src/tools/git.guard.test.ts
 * НАЗНАЧЕНИЕ: I15, обёртка git. Запретная команда и флаг не доходят до execFile.
 * ВХОД: имя подкоманды и аргументы. ВЫХОД: исключение, счётчик мока остаётся нулём.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { GIT_CONFIG_KEYS, assertGitInvocation, buildGitEnv, gitPrefix, runGit } from './git.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const BANNED = ['push', 'fetch', 'pull', 'clone', 'remote', 'ls-remote', 'submodule', 'config', 'checkout', 'switch', 'worktree', 'status', 'gc']

test('I15 запретные подкоманды не запускают процесс', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tinybots-git-'))
  dirs.push(root)
  for (const command of BANNED) {
    let calls = 0
    await expect(runGit({
      bin: '/usr/bin/git',
      cwd: root,
      rootReal: root,
      dataDir: root,
      hooks: { execFile: async () => { calls += 1; return { stdout: '', stderr: '' } } },
    }, command, [])).rejects.toThrow(/вне списка/)
    expect(calls, command).toBe(0)
  }
})

test('I15 запретные флаги не запускают процесс', async () => {
  const flags = ['--filters', '--textconv', '--refresh', '--really-refresh', '--others', '--modified', '--exec', '--upload-pack', '--git-dir', '--work-tree', '-c']
  for (const flag of flags) {
    expect(() => assertGitInvocation('cat-file', ['blob', 'abc', flag])).toThrow(/флаг/)
  }
  expect(() => assertGitInvocation('rev-parse', ['--show-toplevel'])).not.toThrow()
})

test('I15 боевое окружение без дома и префикс -c на месте', () => {
  const env = buildGitEnv({})
  expect(env.HOME).toBeUndefined()
  expect(env.USERPROFILE).toBeUndefined()
  expect(env.XDG_CONFIG_HOME).toBeUndefined()
  expect(env.GIT_ALLOW_PROTOCOL).toBe('none')
  expect(env.GIT_NO_LAZY_FETCH).toBe('1')
  expect(env.GIT_LITERAL_PATHSPECS).toBe('1')
  expect(env.GIT_CONFIG_NOSYSTEM).toBe('1')
  expect(env.GIT_TERMINAL_PROMPT).toBe('0')
  const prefix = gitPrefix('/repo', '/data/git-hooks')
  const joined = prefix.join('\n')
  for (const key of GIT_CONFIG_KEYS) {
    expect(joined, key).toContain(key)
  }
  expect(joined).not.toContain('safe.directory')
})
