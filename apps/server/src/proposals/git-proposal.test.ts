/**
 * FILE: apps/server/src/proposals/git-proposal.test.ts
 * НАЗНАЧЕНИЕ: I12 и I13 для git. Временный репозиторий, настоящий git ≥ 2.45.
 * ВХОД: mkdtemp, один коммит. Применение идёт через обёртку, не через checkout.
 * ВЫХОД: ветка tinybots/proposal-<id>, рабочее дерево и HEAD прежние.
 */

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { applyProposal, createProposal, revertProposal } from './engine.js'
import { readProposal } from './store.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
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

test('I12 git apply оставляет HEAD и дерево, revert удаляет ветку', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'tinybots-gitp-'))
  dirs.push(base)
  const repo = path.join(base, 'repo')
  const data = path.join(base, 'data')
  await mkdir(repo, { recursive: true })
  await mkdir(data, { recursive: true })
  await writeFile(path.join(repo, 'note.txt'), 'old\n')
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.email', 't@t'])
  git(repo, ['config', 'user.name', 't'])
  git(repo, ['add', 'note.txt'])
  git(repo, ['commit', '-m', 'start'])
  const head = git(repo, ['rev-parse', 'HEAD'])
  const branch = git(repo, ['symbolic-ref', 'HEAD'])
  const index = await readFile(path.join(repo, '.git', 'index'))
  const project = await realpath(repo)
  const made = await createProposal({
    projectReal: project,
    dataDir: data,
    dataReal: data,
    launcherCwd: base,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary: 'Co-authored-by: X <x@y>',
    diff: '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n',
    now: new Date('2026-11-21T12:00:00.000Z'),
  })
  if (!made.ok) {
    throw new Error(made.error)
  }
  expect(made.mode).toBe('git')
  if (!made.ok) {
    return
  }
  expect(await readFile(path.join(repo, 'note.txt'), 'utf8')).toBe('old\n')
  const row = readProposal(data, made.id)
  const applied = await applyProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: base,
    id: made.id,
    patchSha: row?.patch_sha256 ?? '',
    now: new Date('2026-11-21T12:00:00.000Z'),
    by: 'owner',
  })
  expect(applied.ok).toBe(true)
  if (!applied.ok) {
    return
  }
  expect(git(repo, ['rev-parse', 'HEAD'])).toBe(head)
  expect(git(repo, ['symbolic-ref', 'HEAD'])).toBe(branch)
  expect(await readFile(path.join(repo, 'note.txt'), 'utf8')).toBe('old\n')
  expect(await readFile(path.join(repo, '.git', 'index'))).toEqual(index)
  const tip = git(repo, ['rev-parse', `refs/heads/tinybots/proposal-${made.id}`])
  const parent = git(repo, ['rev-parse', `${tip}^`])
  expect(parent).toBe(head)
  const blob = git(repo, ['cat-file', 'blob', `${tip}:note.txt`])
  expect(blob).toBe('new')
  const message = git(repo, ['log', '-1', '--format=%B', tip])
  expect(message).not.toContain('Co-authored-by')
  expect(message).toContain(made.id)
  const author = git(repo, ['log', '-1', '--format=%an %ae', tip])
  expect(author).toBe('TinyBots bot@localhost')
  const back = await revertProposal({
    dataDir: data,
    projectReal: project,
    launcherCwd: base,
    id: made.id,
    patchSha: row?.patch_sha256 ?? '',
    now: new Date('2026-11-21T12:01:00.000Z'),
    by: 'owner',
  })
  expect(back.ok).toBe(true)
  expect(() => git(repo, ['rev-parse', '--verify', `refs/heads/tinybots/proposal-${made.id}`])).toThrow()
  expect(await readFile(path.join(repo, 'note.txt'), 'utf8')).toBe('old\n')
  const saved = readProposal(data, made.id)
  expect(saved?.state).toBe('reverted')
  expect(saved?.git?.commit).toBe(tip)
  expect(git(repo, ['cat-file', '-t', tip])).toBe('commit')
  expect(git(repo, ['rev-parse', '--git-dir'])).toBe('.git')
})
