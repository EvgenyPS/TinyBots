/**
 * FILE: apps/server/src/tools/review-guards.test.ts
 * НАЗНАЧЕНИЕ: git только из абсолютного PATH вне проекта, cwd — каталог лаунчера.
 * Таймаут обрывает работу сигналом.
 */

import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { findGitBinary, runGit } from './git.js'
import { TOOL_TIMEOUT_MS } from './limits.js'
import { withTimeout } from './loop.js'

const dirs: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

function systemGit(): string {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  const text = execFileSync(cmd, ['git'], { encoding: 'utf8' })
  return text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? ''
}

test('PATH: относительный каталог и git внутри проекта пропускаются', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'tinybots-path-'))
  dirs.push(base)
  const project = path.join(base, 'proj')
  const data = path.join(base, 'data')
  const outside = path.join(base, 'outside')
  await mkdir(path.join(project, 'bin'), { recursive: true })
  await mkdir(data)
  await mkdir(outside)
  const name = process.platform === 'win32' ? 'git.exe' : 'git'
  const planted = path.join(project, 'bin', name)
  await writeFile(planted, '#!/bin/sh\necho no\n')
  await chmod(planted, 0o755)
  const real = systemGit()
  expect(real.length).toBeGreaterThan(0)
  await symlink(real, path.join(outside, name))
  const found = await findGitBinary({
    pathEnv: ['relbin', path.join(project, 'bin'), outside].join(path.delimiter),
    projectReals: [project],
    dataReal: data,
  })
  expect(found.ok).toBe(true)
  if (found.ok) {
    expect(path.resolve(found.bin)).toBe(path.resolve(real))
  }
})

test('git cwd — каталог лаунчера, не папка проекта', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'tinybots-cwd-'))
  dirs.push(base)
  const project = path.join(base, 'proj')
  const launcher = path.join(base, 'launcher')
  await mkdir(project)
  await mkdir(launcher)
  const seen: string[] = []
  await runGit({
    bin: 'git',
    cwd: launcher,
    rootReal: project,
    dataDir: path.join(base, 'data'),
    hooks: {
      execFile: (_file, _args, options) => {
        seen.push(options.cwd)
        return Promise.resolve({ stdout: Buffer.from('ok'), stderr: Buffer.from('') })
      },
    },
  }, 'rev-parse', ['HEAD'])
  expect(seen).toEqual([launcher])
})

test('таймаут абортит сигнал работы', async () => {
  vi.useFakeTimers()
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
  let aborted = false
  const pending = withTimeout((child) => new Promise<string>((resolve) => {
    child.addEventListener('abort', () => {
      aborted = true
      resolve('stopped')
    })
  }), sleep, new AbortController().signal)
  const settled = pending.then(
    () => 'fulfilled',
    () => 'rejected',
  )
  await vi.advanceTimersByTimeAsync(TOOL_TIMEOUT_MS)
  expect(await settled).toBe('rejected')
  expect(aborted).toBe(true)
})
