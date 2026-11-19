/**
 * FILE: apps/server/src/store/atomic.test.ts
 * НАЗНАЧЕНИЕ: B15. Успешная замена и kill посередине записи.
 * Дочерний процесс вешает крюк afterChunk до rename. Родитель убивает его.
 * Цель остаётся прежним валидным JSON: rename не успел.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, expect, test } from 'vitest'
import { writeAtomic } from './atomic.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'tinybots-atomic-'))
  dirs.push(dir)
  return dir
}

test('успешная запись заменяет файл и не оставляет tmp', async () => {
  const dir = scratch()
  const target = path.join(dir, 'note.json')
  writeFileSync(target, '{"ok":false}\n')
  await writeAtomic(target, '{"ok":true}\n')
  expect(readFileSync(target, 'utf8')).toBe('{"ok":true}\n')
  expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false)
})

test('ошибка до rename не портит прежний файл', async () => {
  const dir = scratch()
  const target = path.join(dir, 'note.json')
  writeFileSync(target, '{"ok":true,"n":1}\n')
  await expect(
    writeAtomic(target, '{"ok":true,"n":2}\n', {
      afterChunk: () => {
        throw new Error('обрыв')
      },
    }),
  ).rejects.toThrow('обрыв')
  expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ ok: true, n: 1 })
  expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false)
})

test('kill процесса посреди записи оставляет прежний валидный файл', async () => {
  const dir = scratch()
  const target = path.join(dir, 'note.json')
  const original = '{"ok":true,"n":1}\n'
  writeFileSync(target, original)
  const payload = path.join(dir, 'next.txt')
  writeFileSync(payload, `{"ok":true,"n":2,"pad":"${'x'.repeat(48_000)}"}\n`)

  const source = readFileSync(fileURLToPath(new URL('./atomic.ts', import.meta.url)), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  writeFileSync(path.join(dir, 'atomic.mjs'), js)
  writeFileSync(
    path.join(dir, 'worker.mjs'),
    `import { readFileSync, writeSync } from 'node:fs'
import { writeAtomic } from './atomic.mjs'
const target = process.argv[2]
const body = readFileSync(process.argv[3], 'utf8')
await writeAtomic(target, body, {
  afterChunk: () => {
    writeSync(1, 'CHUNK\\n')
    return new Promise(() => {})
  },
})
`,
  )

  const child = spawn(process.execPath, [path.join(dir, 'worker.mjs'), target, payload], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let seen = ''
  const stderr: Buffer[] = []
  child.stderr.on('data', (chunk: Buffer) => {
    stderr.push(chunk)
  })
  const exited = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`процесс не умер: ${Buffer.concat(stderr).toString('utf8')}`))
    }, 8_000)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code ?? 0)
    })
  })
  child.stdout.on('data', (chunk: Buffer) => {
    seen += chunk.toString('utf8')
    if (seen.includes('CHUNK')) {
      child.kill('SIGKILL')
    }
  })
  await exited
  const text = readFileSync(target, 'utf8')
  expect(text).toBe(original)
  expect(JSON.parse(text)).toEqual({ ok: true, n: 1 })
})

function busyError(): NodeJS.ErrnoException {
  const error = new Error('busy') as NodeJS.ErrnoException
  error.code = 'EPERM'
  return error
}

test('rename повторяется после EPERM и затем заменяет файл', async () => {
  const dir = scratch()
  const target = path.join(dir, 'note.json')
  writeFileSync(target, '{"ok":false}\n')
  let calls = 0
  await writeAtomic(target, '{"ok":true}\n', {
    pause: () => undefined,
    rename: async (from, to) => {
      calls += 1
      if (calls === 1) {
        throw busyError()
      }
      await rename(from, to)
    },
  })
  expect(calls).toBe(2)
  expect(readFileSync(target, 'utf8')).toBe('{"ok":true}\n')
  expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false)
})

test('чужой код ошибки rename не повторяется и не портит цель', async () => {
  const dir = scratch()
  const target = path.join(dir, 'note.json')
  writeFileSync(target, '{"ok":true}\n')
  let calls = 0
  await expect(
    writeAtomic(target, '{"ok":false}\n', {
      pause: () => undefined,
      rename: () => {
        calls += 1
        const error = new Error('gone') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      },
    }),
  ).rejects.toThrow('gone')
  expect(calls).toBe(1)
  expect(readFileSync(target, 'utf8')).toBe('{"ok":true}\n')
  expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false)
})

test('пять EPERM подряд оставляют прежний файл', async () => {
  const dir = scratch()
  const target = path.join(dir, 'note.json')
  writeFileSync(target, '{"ok":true}\n')
  let calls = 0
  await expect(
    writeAtomic(target, '{"ok":false}\n', {
      pause: () => undefined,
      rename: () => {
        calls += 1
        throw busyError()
      },
    }),
  ).rejects.toThrow('busy')
  expect(calls).toBe(5)
  expect(readFileSync(target, 'utf8')).toBe('{"ok":true}\n')
  expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false)
})
