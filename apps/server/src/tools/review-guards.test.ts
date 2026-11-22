/**
 * FILE: apps/server/src/tools/review-guards.test.ts
 * НАЗНАЧЕНИЕ: git только из абсолютного PATH вне проекта, cwd — каталог лаунчера.
 * Таймаут обрывает работу сигналом.
 */

import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
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
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)
  const exe = lines.find((line) => line.toLowerCase().endsWith(process.platform === 'win32' ? 'git.exe' : 'git'))
  return exe ?? ''
}

test('PATH: относительный каталог и git внутри проекта пропускаются', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'tinybots-path-'))
  dirs.push(base)
  const project = path.join(base, 'proj')
  const data = path.join(base, 'data')
  await mkdir(path.join(project, 'bin'), { recursive: true })
  await mkdir(data)
  const name = process.platform === 'win32' ? 'git.exe' : 'git'
  const planted = path.join(project, 'bin', name)
  await writeFile(planted, '#!/bin/sh\necho no\n')
  await chmod(planted, 0o755)
  // Настоящий относительный каталог с поддельным git. Не копия git.exe: иначе Windows его и запускает.
  const relbin = path.join(base, 'relbin')
  await mkdir(relbin)
  const fake = path.join(relbin, name)
  await writeFile(fake, 'not a git\n')
  await chmod(fake, 0o755)
  const real = systemGit()
  expect(real.length).toBeGreaterThan(0)
  const previous = process.cwd()
  process.chdir(base)
  try {
    const found = await findGitBinary({
      pathEnv: ['relbin', path.join(project, 'bin'), path.dirname(real)].join(path.delimiter),
      projectReals: [await realpath(project)],
      dataReal: await realpath(data),
    })
    expect(found.ok).toBe(true)
    if (found.ok) {
      expect(path.resolve(found.bin)).toBe(path.resolve(real))
    }
  } finally {
    process.chdir(previous)
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
