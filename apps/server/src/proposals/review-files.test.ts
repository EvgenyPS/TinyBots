/**
 * FILE: apps/server/src/proposals/review-files.test.ts
 * НАЗНАЧЕНИЕ: байты UTF-8, смешанные концы строк, конфликт отката и сверка post/live.
 * ВХОД: временная папка без git. Выход: байты до и после совпадают с ожиданием.
 */

import { writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { applyUnifiedDiff } from '../tools/diff.js'
import { applyProposal, createProposal, revertProposal } from './engine.js'
import { readProposal } from './store.js'

const dirs: string[] = []
const NOW = new Date('2026-11-21T12:00:00.000Z')

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 5 })
  }
})

async function world(): Promise<{ project: string; data: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'tinybots-rev-'))
  dirs.push(root)
  const project = path.join(root, 'proj')
  const data = path.join(root, 'data')
  await mkdir(project, { recursive: true })
  await mkdir(data, { recursive: true })
  return { project: await realpath(project), data }
}

function input(project: string, data: string, summary: string, diff: string) {
  return {
    projectReal: project,
    dataDir: data,
    dataReal: data,
    launcherCwd: project,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary,
    diff,
    now: NOW,
  }
}

test('кириллица и эмодзи переживают apply и revert', async () => {
  const { project, data } = await world()
  const before = Buffer.from('старое\n', 'utf8')
  const after = Buffer.from('привет 😀\n', 'utf8')
  await writeFile(path.join(project, 'note.txt'), before)
  const made = await createProposal(input(
    project,
    data,
    'текст',
    '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-старое\n+привет 😀\n',
  ))
  expect(made.ok).toBe(true)
  if (!made.ok) {
    return
  }
  const row = readProposal(data, made.id)
  const applied = await applyProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: project,
    id: made.id,
    patchSha: row?.patch_sha256 ?? '',
    now: NOW,
    by: 'owner',
  })
  expect(applied.ok).toBe(true)
  expect(await readFile(path.join(project, 'note.txt'))).toEqual(after)
  const back = await revertProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: project,
    id: made.id,
    patchSha: row?.patch_sha256 ?? '',
    now: NOW,
    by: 'owner',
  })
  expect(back.ok).toBe(true)
  expect(await readFile(path.join(project, 'note.txt'))).toEqual(before)
})

test('не utf-8 не подменяется', () => {
  const got = applyUnifiedDiff('--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-x\n+y\n', () => Buffer.from([0xff, 0xfe]))
  expect(got).toMatchObject({ ok: false, reason: 'не utf-8' })
})

test('смешанные концы строк: чужая строка не теряет CR', async () => {
  const { project, data } = await world()
  const before = Buffer.from('keep\r\nswap\n', 'utf8')
  await writeFile(path.join(project, 'note.txt'), before)
  const made = await createProposal(input(
    project,
    data,
    'концы',
    '--- a/note.txt\n+++ b/note.txt\n@@ -1,2 +1,2 @@\n keep\n-swap\n+next\n',
  ))
  expect(made.ok).toBe(true)
  if (!made.ok) {
    return
  }
  const row = readProposal(data, made.id)
  const applied = await applyProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: project,
    id: made.id,
    patchSha: row?.patch_sha256 ?? '',
    now: NOW,
    by: 'owner',
  })
  expect(applied.ok).toBe(true)
  expect(await readFile(path.join(project, 'note.txt'))).toEqual(Buffer.from('keep\r\nnext\n', 'utf8'))
})

test('CRLF-файл: новая строка тоже с CR', async () => {
  const { project, data } = await world()
  await writeFile(path.join(project, 'note.txt'), Buffer.from('keep\r\n', 'utf8'))
  const made = await createProposal(input(
    project,
    data,
    'концы',
    '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1,2 @@\n keep\n+next\n',
  ))
  expect(made.ok).toBe(true)
  if (!made.ok) {
    return
  }
  const row = readProposal(data, made.id)
  const applied = await applyProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: project,
    id: made.id,
    patchSha: row?.patch_sha256 ?? '',
    now: NOW,
    by: 'owner',
  })
  expect(applied.ok).toBe(true)
  expect(await readFile(path.join(project, 'note.txt'))).toEqual(Buffer.from('keep\r\nnext\r\n', 'utf8'))
})

test('BOM остаётся после правки строки', async () => {
  const { project, data } = await world()
  const bom = Buffer.from([0xef, 0xbb, 0xbf])
  await writeFile(path.join(project, 'note.txt'), Buffer.concat([bom, Buffer.from('old\n', 'utf8')]))
  const made = await createProposal(input(project, data, 'bom', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n'))
  expect(made.ok).toBe(true)
  if (!made.ok) {
    return
  }
  const row = readProposal(data, made.id)
  const applied = await applyProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: project,
    id: made.id,
    patchSha: row?.patch_sha256 ?? '',
    now: NOW,
    by: 'owner',
  })
  expect(applied.ok).toBe(true)
  expect(await readFile(path.join(project, 'note.txt'))).toEqual(Buffer.concat([bom, Buffer.from('new\n', 'utf8')]))
})

test('откат из applied при чужих байтах — revert_conflict', async () => {
  const { project, data } = await world()
  await writeFile(path.join(project, 'note.txt'), 'old\n')
  const made = await createProposal(input(project, data, 'строка', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n'))
  expect(made.ok).toBe(true)
  if (!made.ok) {
    return
  }
  const row = readProposal(data, made.id)
  const applied = await applyProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: project,
    id: made.id,
    patchSha: row?.patch_sha256 ?? '',
    now: NOW,
    by: 'owner',
  })
  expect(applied.ok).toBe(true)
  await writeFile(path.join(project, 'note.txt'), 'чужое\n')
  const back = await revertProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: project,
    id: made.id,
    patchSha: row?.patch_sha256 ?? '',
    now: NOW,
    by: 'owner',
  })
  expect(back).toMatchObject({ ok: false, error: 'revert_conflict' })
  expect(readProposal(data, made.id)?.state).toBe('revert_conflict')
  expect(await readFile(path.join(project, 'note.txt'), 'utf8')).toBe('чужое\n')
})

test('помеха отката временная: после неё повтор проходит', async () => {
  const { project, data } = await world()
  await writeFile(path.join(project, 'note.txt'), 'old\n')
  const made = await createProposal(input(project, data, 'строка', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n'))
  expect(made.ok).toBe(true)
  if (!made.ok) {
    return
  }
  const row = readProposal(data, made.id)
  const body = {
    dataDir: data,
    projectReal: project,
    launcherCwd: project,
    id: made.id,
    patchSha: row?.patch_sha256 ?? '',
    now: NOW,
    by: 'owner',
  }
  expect((await applyProposal(body)).ok).toBe(true)
  await writeFile(path.join(project, 'note.txt'), 'чужое\n')
  expect(await revertProposal(body)).toMatchObject({ ok: false, error: 'revert_conflict' })
  await writeFile(path.join(project, 'note.txt'), 'new\n')
  expect((await revertProposal(body)).ok).toBe(true)
  expect(readProposal(data, made.id)?.state).toBe('reverted')
  expect(await readFile(path.join(project, 'note.txt'), 'utf8')).toBe('old\n')
})

test('обрыв сигнала не пишет предложение', async () => {
  const { project, data } = await world()
  await writeFile(path.join(project, 'a.txt'), 'old\n')
  await writeFile(path.join(project, 'b.txt'), 'old\n')
  const ac = new AbortController()
  let opened = 0
  await expect(createProposal({
    ...input(project, data, 'два', '--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-old\n+new\n'),
    signal: ac.signal,
    hooks: {
      beforeOpen: () => {
        opened += 1
        ac.abort()
      },
    },
  })).rejects.toThrow('tool_timeout')
  expect(opened).toBe(1)
  const names = await readdir(data)
  expect(names).not.toContain('proposals')
})

test('подмена post/ до apply — conflict', async () => {
  const { project, data } = await world()
  await writeFile(path.join(project, 'note.txt'), 'old\n')
  const made = await createProposal(input(project, data, 'строка', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n'))
  expect(made.ok).toBe(true)
  if (!made.ok) {
    return
  }
  await writeFile(path.join(data, 'proposals', made.id, 'post', 'note.txt'), 'zzz\n')
  const row = readProposal(data, made.id)
  const applied = await applyProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: project,
    id: made.id,
    patchSha: row?.patch_sha256 ?? '',
    now: NOW,
    by: 'owner',
  })
  expect(applied).toMatchObject({ ok: false, error: 'conflict' })
  expect(await readFile(path.join(project, 'note.txt'), 'utf8')).toBe('old\n')
})

test('beforeWrite портит файл, beforeCommit возвращает исходные байты', async () => {
  const { project, data } = await world()
  const live = path.join(project, 'note.txt')
  await writeFile(live, 'old\n')
  const made = await createProposal(input(project, data, 'строка', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n'))
  expect(made.ok).toBe(true)
  if (!made.ok) {
    return
  }
  const row = readProposal(data, made.id)
  const applied = await applyProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: project,
    id: made.id,
    patchSha: row?.patch_sha256 ?? '',
    now: NOW,
    by: 'owner',
    hooks: {
      beforeWrite: () => {
        writeFileSync(live, 'tamper\n')
      },
    },
  })
  expect(applied).toMatchObject({ ok: false, error: 'conflict' })
  expect(await readFile(live, 'utf8')).toBe('old\n')
})
