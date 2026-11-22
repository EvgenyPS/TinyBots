/**
 * FILE: apps/server/src/proposals/incomplete.test.ts
 * НАЗНАЧЕНИЕ: Н96, Б1 и Н97. После kill в proposals/ остаётся .<id>.partial или каталог без json.
 * ВХОД: временный data_dir, папка проекта и ссылка наружу.
 * ВЫХОД: мусор снят. Ссылка вместо proposals и каталог с backup/ не разбираются.
 */

import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { recoverProposals } from './engine.js'
import { proposalsBytes, sweepIncomplete } from './store.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function layout(): Promise<{ base: string; data: string; project: string; outside: string; proposals: string }> {
  const base = await mkdtemp(path.join(tmpdir(), 'tinybots-partial-'))
  dirs.push(base)
  const data = path.join(base, 'data')
  const project = path.join(base, 'project')
  const outside = path.join(base, 'outside')
  const proposals = path.join(data, 'proposals')
  await mkdir(proposals, { recursive: true })
  await mkdir(project, { recursive: true })
  await mkdir(outside, { recursive: true })
  return { base, data, project, outside, proposals }
}

/** Каталог-ссылка. На Windows junction, иначе обычная ссылка: цель одна и та же. */
async function linkDir(target: string, at: string): Promise<void> {
  if (process.platform === 'win32') {
    await symlink(target, at, 'junction')
  } else {
    await symlink(target, at)
  }
}

test('недописанные папки снимаются, валидное предложение и чужие файлы остаются', async () => {
  const { data, project, proposals } = await layout()
  await writeFile(path.join(project, 'keep.txt'), 'PROJECT\n')
  await writeFile(path.join(data, 'note.txt'), 'DATA\n')
  await writeFile(path.join(proposals, 'loose.txt'), 'FILE\n')
  await writeFile(path.join(proposals, '.not-a-dir.partial'), 'TAIL\n')

  const keptSnap = path.join(proposals, 'kept', 'backup', 'note.txt')
  await mkdir(path.dirname(keptSnap), { recursive: true })
  await writeFile(keptSnap, 'SNAP\n')
  await writeFile(path.join(proposals, 'kept.json'), '{"id":"kept"}\n')

  const partial = path.join(proposals, '.pdeadbeef.partial', 'post')
  await mkdir(partial, { recursive: true })
  await writeFile(path.join(partial, 'blob.txt'), 'ORPHAN\n')
  const noJson = path.join(proposals, 'nojson', 'post')
  await mkdir(noJson, { recursive: true })
  await writeFile(path.join(noJson, 'blob.txt'), 'ORPHAN\n')

  const before = await proposalsBytes(data)
  expect(before).toBeGreaterThan(0)
  await sweepIncomplete(data)

  await expect(lstat(path.join(proposals, '.pdeadbeef.partial'))).rejects.toThrow()
  await expect(lstat(path.join(proposals, 'nojson'))).rejects.toThrow()
  expect(await readFile(path.join(proposals, 'kept', 'backup', 'note.txt'), 'utf8')).toBe('SNAP\n')
  expect(await readFile(path.join(proposals, 'kept.json'), 'utf8')).toBe('{"id":"kept"}\n')
  expect(await readFile(path.join(proposals, 'loose.txt'), 'utf8')).toBe('FILE\n')
  expect(await readFile(path.join(proposals, '.not-a-dir.partial'), 'utf8')).toBe('TAIL\n')
  expect(await readFile(path.join(project, 'keep.txt'), 'utf8')).toBe('PROJECT\n')
  expect(await readFile(path.join(data, 'note.txt'), 'utf8')).toBe('DATA\n')
  const after = await proposalsBytes(data)
  expect(after).toBeLessThan(before)
})

test('ссылка внутри proposals не ведёт наружу', async () => {
  const { data, project, outside, proposals } = await layout()
  await writeFile(path.join(outside, 'secret.txt'), 'CANARY\n')
  await writeFile(path.join(project, 'keep.txt'), 'PROJECT\n')
  await mkdir(path.join(outside, 'tree'), { recursive: true })
  await writeFile(path.join(outside, 'tree', 'deep.txt'), 'DEEP\n')

  await linkDir(outside, path.join(proposals, 'door'))
  const orphan = path.join(proposals, 'orphan')
  await mkdir(orphan, { recursive: true })
  await symlink(path.join(outside, 'secret.txt'), path.join(orphan, 'leak'))
  await linkDir(path.join(outside, 'tree'), path.join(orphan, 'tree-link'))

  const kept = path.join(proposals, 'kept')
  await mkdir(kept, { recursive: true })
  await writeFile(path.join(proposals, 'kept.json'), '{}\n')
  await symlink(path.join(outside, 'secret.txt'), path.join(kept, 'stay'))

  await recoverProposals(data, () => null, new Date('2026-11-22T00:00:00.000Z'))

  expect(await readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe('CANARY\n')
  expect(await readFile(path.join(outside, 'tree', 'deep.txt'), 'utf8')).toBe('DEEP\n')
  expect(await readFile(path.join(project, 'keep.txt'), 'utf8')).toBe('PROJECT\n')
  await expect(lstat(path.join(proposals, 'door'))).rejects.toThrow()
  await expect(lstat(orphan)).rejects.toThrow()
  expect(await readFile(path.join(kept, 'stay'), 'utf8')).toBe('CANARY\n')
  const stay = await lstat(path.join(kept, 'stay'))
  expect(stay.isSymbolicLink()).toBe(true)
})

test('proposals-ссылка на внешний каталог ничего снаружи не удаляет', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'tinybots-partial-'))
  dirs.push(base)
  const data = path.join(base, 'data')
  const victim = path.join(base, 'victim')
  await mkdir(data, { recursive: true })
  await mkdir(path.join(victim, 'sub'), { recursive: true })
  await writeFile(path.join(victim, 'sub', 'keep.txt'), 'VICTIM\n')
  await writeFile(path.join(victim, 'plain.txt'), 'PLAIN\n')
  const linkPath = path.join(data, 'proposals')
  await linkDir(victim, linkPath)
  const lines: string[] = []
  const prev = console.info
  console.info = (message?: unknown, ...rest: unknown[]) => {
    lines.push([message, ...rest].map((item) => String(item)).join(' '))
  }
  try {
    await sweepIncomplete(data)
  } finally {
    console.info = prev
  }
  expect(await readFile(path.join(victim, 'sub', 'keep.txt'), 'utf8')).toBe('VICTIM\n')
  expect(await readFile(path.join(victim, 'plain.txt'), 'utf8')).toBe('PLAIN\n')
  expect(await realpath(linkPath)).toBe(await realpath(victim))
  const link = await lstat(linkPath)
  expect(link.isSymbolicLink()).toBe(true)
  expect(lines.some((line) => line.includes('уборка пропущена'))).toBe(true)
  expect(lines.join('\n')).not.toContain(victim)
})

test('каталог без json, но со снимком backup, не снимается', async () => {
  const { data, proposals } = await layout()
  const snap = path.join(proposals, 'p6', 'backup', 'a')
  await mkdir(path.dirname(snap), { recursive: true })
  await writeFile(snap, 'SNAP\n')
  await mkdir(path.join(proposals, 'nojson', 'post'), { recursive: true })
  await writeFile(path.join(proposals, 'nojson', 'post', 'blob.txt'), 'ORPHAN\n')
  await sweepIncomplete(data)
  expect(await readFile(snap, 'utf8')).toBe('SNAP\n')
  await expect(lstat(path.join(proposals, 'p6'))).resolves.toBeTruthy()
  await expect(lstat(path.join(proposals, 'nojson'))).rejects.toThrow()
})
