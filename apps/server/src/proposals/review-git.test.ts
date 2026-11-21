/**
 * FILE: apps/server/src/proposals/review-git.test.ts
 * НАЗНАЧЕНИЕ: git-режим после ревью. Кодировка, откат при checkout и ff-only,
 * режим файла, грязный индекс, живой CRLF и слово summary.
 */

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { applyProposal, createProposal, revertProposal } from './engine.js'
import { readProposal } from './store.js'

const dirs: string[] = []
const NOW = new Date('2026-11-21T12:00:00.000Z')

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  return env
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, env: gitEnv(), encoding: 'utf8' }).trim()
}

async function repoWith(text: string | Buffer): Promise<{ repo: string; project: string; data: string; base: string }> {
  const base = await mkdtemp(path.join(tmpdir(), 'tinybots-rg-'))
  dirs.push(base)
  const repo = path.join(base, 'repo')
  const data = path.join(base, 'data')
  await mkdir(repo)
  await mkdir(data)
  await writeFile(path.join(repo, 'note.txt'), text)
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.email', 't@t'])
  git(repo, ['config', 'user.name', 't'])
  git(repo, ['config', 'core.autocrlf', 'false'])
  git(repo, ['add', 'note.txt'])
  git(repo, ['commit', '-m', 'start'])
  return { repo, project: await realpath(repo), data, base }
}

async function propose(box: { project: string; data: string; base: string }, summary: string, diff: string) {
  const made = await createProposal({
    projectReal: box.project,
    dataDir: box.data,
    dataReal: box.data,
    launcherCwd: box.base,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary,
    diff,
    now: NOW,
  })
  if (!made.ok) {
    throw new Error(made.error)
  }
  const row = readProposal(box.data, made.id)
  return { id: made.id, sha: row?.patch_sha256 ?? '' }
}

function act(box: { project: string; data: string; base: string }, id: string, sha: string, kind: 'apply' | 'revert') {
  const body = {
    dataDir: box.data,
    projectReal: box.project,
    launcherCwd: box.base,
    id,
    patchSha: sha,
    now: NOW,
    by: 'owner',
  }
  return kind === 'apply' ? applyProposal(body) : revertProposal(body)
}

test('кириллица и эмодзи в blob, рабочее дерево прежнее', async () => {
  const before = Buffer.from('старое\n', 'utf8')
  const box = await repoWith(before)
  const row = await propose(box, 'текст', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-старое\n+привет 😀\n')
  expect((await act(box, row.id, row.sha, 'apply')).ok).toBe(true)
  expect(await readFile(path.join(box.repo, 'note.txt'))).toEqual(before)
  const tip = git(box.repo, ['rev-parse', `refs/heads/tinybots/proposal-${row.id}`])
  expect(git(box.repo, ['cat-file', 'blob', `${tip}:note.txt`])).toBe('привет 😀')
  expect((await act(box, row.id, row.sha, 'revert')).ok).toBe(true)
  expect(await readFile(path.join(box.repo, 'note.txt'))).toEqual(before)
  expect(git(box.repo, ['cat-file', '-t', tip])).toBe('commit')
})

test('слово bot в summary не даёт ложный conflict', async () => {
  const box = await repoWith('old\n')
  const row = await propose(box, 'bot', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n')
  expect((await act(box, row.id, row.sha, 'apply')).ok).toBe(true)
  const tip = git(box.repo, ['rev-parse', `refs/heads/tinybots/proposal-${row.id}`])
  const message = git(box.repo, ['log', '-1', '--format=%B', tip])
  expect(message.split('\n').includes('bot')).toBe(false)
})

test('checkout ветки предложения — revert_conflict, ветка на месте', async () => {
  const box = await repoWith('old\n')
  const row = await propose(box, 'строка', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n')
  expect((await act(box, row.id, row.sha, 'apply')).ok).toBe(true)
  git(box.repo, ['checkout', `tinybots/proposal-${row.id}`])
  const back = await act(box, row.id, row.sha, 'revert')
  expect(back).toMatchObject({ ok: false, error: 'revert_conflict' })
  expect(readProposal(box.data, row.id)?.state).toBe('revert_conflict')
  expect(git(box.repo, ['rev-parse', '--verify', `refs/heads/tinybots/proposal-${row.id}`]).length).toBeGreaterThan(0)
  git(box.repo, ['checkout', 'main'])
  expect((await act(box, row.id, row.sha, 'revert')).ok).toBe(true)
  expect(readProposal(box.data, row.id)?.state).toBe('reverted')
  expect(() => git(box.repo, ['rev-parse', '--verify', `refs/heads/tinybots/proposal-${row.id}`])).toThrow()
})

test('подмена post/ до git apply — conflict, ветка не остаётся', async () => {
  const box = await repoWith('old\n')
  const row = await propose(box, 'строка', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n')
  await writeFile(path.join(box.data, 'proposals', row.id, 'post', 'note.txt'), 'zzz\n')
  expect(await act(box, row.id, row.sha, 'apply')).toMatchObject({ ok: false, error: 'conflict' })
  expect(await readFile(path.join(box.repo, 'note.txt'), 'utf8')).toBe('old\n')
  expect(() => git(box.repo, ['rev-parse', '--verify', `refs/heads/tinybots/proposal-${row.id}`])).toThrow()
})

test('merge --ff-only — revert_conflict, ветка на месте', async () => {
  const box = await repoWith('old\n')
  const row = await propose(box, 'строка', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n')
  expect((await act(box, row.id, row.sha, 'apply')).ok).toBe(true)
  git(box.repo, ['merge', '--ff-only', `tinybots/proposal-${row.id}`])
  const back = await act(box, row.id, row.sha, 'revert')
  expect(back).toMatchObject({ ok: false, error: 'revert_conflict' })
  expect(readProposal(box.data, row.id)?.state).toBe('revert_conflict')
  expect(git(box.repo, ['rev-parse', '--verify', `refs/heads/tinybots/proposal-${row.id}`]).length).toBeGreaterThan(0)
})

test('режим 100755 применяется, 120000 — unsupported_entry', async () => {
  const box = await repoWith('old\n')
  git(box.repo, ['update-index', '--chmod=+x', 'note.txt'])
  git(box.repo, ['commit', '-m', 'mode'])
  const row = await propose(box, 'строка', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n')
  expect((await act(box, row.id, row.sha, 'apply')).ok).toBe(true)
  const tip = git(box.repo, ['rev-parse', `refs/heads/tinybots/proposal-${row.id}`])
  expect(git(box.repo, ['ls-tree', tip, 'note.txt']).startsWith('100755')).toBe(true)

  const odd = await repoWith('old\n')
  const blob = git(odd.repo, ['rev-parse', 'HEAD:note.txt'])
  git(odd.repo, ['update-index', '--cacheinfo', `120000,${blob},note.txt`])
  git(odd.repo, ['commit', '-m', 'link'])
  const bad = await propose(odd, 'строка', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n')
  expect(await act(odd, bad.id, bad.sha, 'apply')).toMatchObject({ ok: false, error: 'unsupported_entry' })
})

test('грязный индекс — dirty, живой CRLF против LF-blob проходит', async () => {
  const dirty = await repoWith('old\n')
  git(dirty.repo, ['update-index', '--chmod=+x', 'note.txt'])
  const row = await propose(dirty, 'строка', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n')
  expect(await act(dirty, row.id, row.sha, 'apply')).toMatchObject({ ok: false, error: 'dirty' })

  const crlf = await repoWith('old\n')
  await writeFile(path.join(crlf.repo, 'note.txt'), Buffer.from('old\r\n', 'utf8'))
  const live = await propose(crlf, 'строка', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n')
  expect((await act(crlf, live.id, live.sha, 'apply')).ok).toBe(true)
  const tip = git(crlf.repo, ['rev-parse', `refs/heads/tinybots/proposal-${live.id}`])
  expect(git(crlf.repo, ['cat-file', 'blob', `${tip}:note.txt`])).toBe('new')
})
