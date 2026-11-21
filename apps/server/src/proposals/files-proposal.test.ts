/**
 * FILE: apps/server/src/proposals/files-proposal.test.ts
 * НАЗНАЧЕНИЕ: I8, I9, I11 и I12 для режима files.
 * ВХОД: временная папка проекта и data_dir. Git не нужен: каталога .git нет.
 * ВЫХОД: предложение живёт в data_dir. Проект меняется только после apply.
 */

import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { ApplyKilled } from '../merge/files-apply.js'
import { applyProposal, createProposal, recoverProposals, rejectProposal, revertProposal } from './engine.js'
import { readProposal } from './store.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const NOW = new Date('2026-11-21T12:00:00.000Z')

async function world(): Promise<{ project: string; data: string }> {
  const base = await mkdtemp(path.join(tmpdir(), 'tinybots-prop-'))
  dirs.push(base)
  const projectDir = path.join(base, 'proj')
  const data = path.join(base, 'data')
  await mkdir(projectDir, { recursive: true })
  await mkdir(data, { recursive: true })
  const project = await realpath(projectDir)
  await writeFile(path.join(project, 'note.txt'), 'old\n')
  await writeFile(path.join(project, 'other.txt'), 'stay\n')
  return { project, data }
}

function diff(file: string, from: string, to: string): string {
  return `--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-${from}\n+${to}\n`
}

async function sha(file: string): Promise<string> {
  const bytes = await readFile(file)
  return createHash('sha256').update(bytes).digest('hex')
}

test('I8 предложение не меняет проект, кривой diff не создаёт json', async () => {
  const { project, data } = await world()
  const before = await sha(path.join(project, 'note.txt'))
  const made = await createProposal({
    projectReal: project,
    dataDir: data,
    dataReal: data,
    launcherCwd: project,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary: 'поменять строку',
    diff: diff('note.txt', 'old', 'new'),
    now: NOW,
  })
  expect(made.ok && made.mode).toBe('files')
  expect(await sha(path.join(project, 'note.txt'))).toBe(before)
  const bad = await createProposal({
    projectReal: project,
    dataDir: data,
    dataReal: data,
    launcherCwd: project,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary: 'удалить',
    diff: '--- a/note.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n',
    now: NOW,
  })
  expect(bad.ok).toBe(false)
  const missingDir = await createProposal({
    projectReal: project,
    dataDir: data,
    dataReal: data,
    launcherCwd: project,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary: 'новый',
    diff: '--- /dev/null\n+++ b/missing/new.txt\n@@ -0,0 +1 @@\n+hi\n',
    now: NOW,
  })
  expect(missingDir.ok).toBe(false)
  const mismatch = await createProposal({
    projectReal: project,
    dataDir: data,
    dataReal: data,
    launcherCwd: project,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary: 'мимо',
    diff: diff('note.txt', 'nope', 'new'),
    now: NOW,
  })
  expect(mismatch.ok).toBe(false)
})

test('I9 отклонение не пишет файл, apply пишет, неверный хеш не пишет', async () => {
  const { project, data } = await world()
  const made = await createProposal({
    projectReal: project,
    dataDir: data,
    dataReal: data,
    launcherCwd: project,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary: 'поменять строку',
    diff: diff('note.txt', 'old', 'new'),
    now: NOW,
  })
  if (!made.ok) {
    throw new Error('proposal')
  }
  const stored = readProposal(data, made.id)
  if (!stored) {
    throw new Error('json')
  }
  const rejected = await rejectProposal({ dataDir: data, id: made.id, patchSha: stored.patch_sha256, now: NOW, by: 'owner' })
  expect(rejected.ok).toBe(true)
  expect(await readFile(path.join(project, 'note.txt'), 'utf8')).toBe('old\n')
  const second = await createProposal({
    projectReal: project,
    dataDir: data,
    dataReal: data,
    launcherCwd: project,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary: 'ещё раз',
    diff: diff('note.txt', 'old', 'new'),
    now: NOW,
  })
  if (!second.ok) {
    throw new Error('second')
  }
  const row = readProposal(data, second.id)
  if (!row) {
    throw new Error('row')
  }
  const wrong = await applyProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: project,
    id: second.id,
    patchSha: '0'.repeat(64),
    now: NOW,
    by: 'owner',
  })
  expect(wrong.ok).toBe(false)
  expect(await readFile(path.join(project, 'note.txt'), 'utf8')).toBe('old\n')
  const applied = await applyProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: project,
    id: second.id,
    patchSha: row.patch_sha256,
    now: NOW,
    by: 'owner',
  })
  expect(applied.ok).toBe(true)
  expect(await readFile(path.join(project, 'note.txt'), 'utf8')).toBe('new\n')
  const again = await applyProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: project,
    id: second.id,
    patchSha: row.patch_sha256,
    now: NOW,
    by: 'owner',
  })
  expect(again.ok).toBe(false)
  if (!again.ok) {
    expect(again.error).toBe('invalid_state')
  }
})

test('I11 правка файла между предложением и apply даёт conflict', async () => {
  const { project, data } = await world()
  const made = await createProposal({
    projectReal: project,
    dataDir: data,
    dataReal: data,
    launcherCwd: project,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary: 'поменять',
    diff: diff('note.txt', 'old', 'new'),
    now: NOW,
  })
  if (!made.ok) {
    throw new Error('proposal')
  }
  await writeFile(path.join(project, 'note.txt'), 'changed\n')
  const row = readProposal(data, made.id)
  const result = await applyProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: project,
    id: made.id,
    patchSha: row?.patch_sha256 ?? '',
    now: NOW,
    by: 'owner',
  })
  expect(result.ok).toBe(false)
  expect(await readFile(path.join(project, 'note.txt'), 'utf8')).toBe('changed\n')
  expect(readProposal(data, made.id)?.state).toBe('conflict')
})

test('I12 обрыв после записи и recover возвращает исходные байты', async () => {
  const { project, data } = await world()
  await writeFile(path.join(project, 'two.txt'), 'a\n')
  const patch = [
    '--- a/note.txt',
    '+++ b/note.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    '--- a/two.txt',
    '+++ b/two.txt',
    '@@ -1 +1 @@',
    '-a',
    '+b',
    '',
  ].join('\n')
  const made = await createProposal({
    projectReal: project,
    dataDir: data,
    dataReal: data,
    launcherCwd: project,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary: 'два файла',
    diff: patch,
    now: NOW,
  })
  if (!made.ok) {
    throw new Error('proposal')
  }
  const row = readProposal(data, made.id)
  await expect(applyProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: project,
    id: made.id,
    patchSha: row?.patch_sha256 ?? '',
    now: NOW,
    by: 'owner',
    hooks: {
      afterCopy: (index) => {
        if (index === 0) {
          throw new ApplyKilled()
        }
      },
    },
  })).rejects.toBeInstanceOf(ApplyKilled)
  await recoverProposals(data, () => project, NOW)
  expect(await readFile(path.join(project, 'note.txt'), 'utf8')).toBe('old\n')
  expect(await readFile(path.join(project, 'two.txt'), 'utf8')).toBe('a\n')
  expect(readProposal(data, made.id)?.state).toBe('conflict')
  const again = await readFile(path.join(project, 'note.txt'))
  await recoverProposals(data, () => project, NOW)
  expect(await readFile(path.join(project, 'note.txt'))).toEqual(again)
})

test('I13 откат возвращает байты и удаляет новый файл', async () => {
  const { project, data } = await world()
  await mkdir(path.join(project, 'docs'), { recursive: true })
  const made = await createProposal({
    projectReal: project,
    dataDir: data,
    dataReal: data,
    launcherCwd: project,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary: 'новый',
    diff: '--- /dev/null\n+++ b/docs/fresh.txt\n@@ -0,0 +1 @@\n+hi\n',
    now: NOW,
  })
  if (!made.ok) {
    throw new Error('proposal')
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
  expect(await readFile(path.join(project, 'docs', 'fresh.txt'), 'utf8')).toBe('hi\n')
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
  await expect(readFile(path.join(project, 'docs', 'fresh.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(path.join(data, 'proposals', made.id, 'post', 'docs', 'fresh.txt'), 'utf8')).toBe('hi\n')
})

test.skipIf(process.platform === 'win32')('I12 режим +x переживает apply', async () => {
  const { project, data } = await world()
  const file = path.join(project, 'note.txt')
  await chmod(file, 0o755)
  const made = await createProposal({
    projectReal: project,
    dataDir: data,
    dataReal: data,
    launcherCwd: project,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary: 'поменять строку',
    diff: diff('note.txt', 'old', 'new'),
    now: NOW,
  })
  if (!made.ok) {
    throw new Error('proposal')
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
  expect((await stat(file)).mode & 0o111).not.toBe(0)
})
