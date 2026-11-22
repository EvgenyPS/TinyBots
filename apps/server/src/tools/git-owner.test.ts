/**
 * FILE: apps/server/src/tools/git-owner.test.ts
 * НАЗНАЧЕНИЕ: чужой uid каталога .git. Мок только здесь, чтобы не задеть остальные тесты.
 * На Windows проверки владельца нет.
 */

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    async lstat(target: Parameters<typeof actual.lstat>[0], options?: Parameters<typeof actual.lstat>[1]) {
      const st = await actual.lstat(target, options)
      const text = String(target)
      const gitDir = text.endsWith(`${path.sep}.git`) || text.endsWith('/.git')
      if (!gitDir) {
        return st
      }
      const uid = typeof process.getuid === 'function' ? process.getuid() + 1 : 1
      return new Proxy(st, {
        get(obj, prop, receiver) {
          if (prop === 'uid') {
            return uid
          }
          const value = Reflect.get(obj, prop, receiver)
          return typeof value === 'function' ? value.bind(obj) : value
        },
      })
    },
  }
})

import { inspectGitRepo } from './git.js'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

test.skipIf(process.platform === 'win32')('чужой uid .git — код owner', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'tinybots-uid-'))
  dirs.push(base)
  const repo = path.join(base, 'repo')
  await mkdir(repo)
  await writeFile(path.join(repo, 'note.txt'), 'old\n')
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  execFileSync('git', ['init', '-b', 'main'], { cwd: repo, env })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo, env })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo, env })
  execFileSync('git', ['add', 'note.txt'], { cwd: repo, env })
  execFileSync('git', ['commit', '-m', 'start'], { cwd: repo, env })
  const got = await inspectGitRepo({
    bin: 'git',
    cwd: base,
    rootReal: repo,
    dataDir: path.join(base, 'data'),
  })
  expect(got.ok).toBe(false)
  if (!got.ok) {
    expect(got.code).toBe('owner')
  }
})
