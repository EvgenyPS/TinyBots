/**
 * FILE: apps/server/src/proposals/git-guards.test.ts
 * НАЗНАЧЕНИЕ: I15. Частичный клон, фильтры, чужой uid и два слоя сети и подписи.
 * ВХОД: временный git и маркер-скрипт. Продакшен не умеет снимать слои: это только крюк теста.
 * ВЫХОД: отказ с текстом или 409, маркер не появляется, пока оба слоя на месте.
 */

import { execFileSync } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { applyProposal, createProposal } from './engine.js'
import { readProposal } from './store.js'
import {
  GIT_CONFIG_KEYS,
  GIT_OWNER,
  GIT_PARTIAL,
  buildGitEnv,
  gitPrefix,
  inspectGitRepo,
  makeGit,
  type GitExec,
} from '../tools/git.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const NOW = new Date('2026-11-21T12:00:00.000Z')

function gitBin(): string {
  return 'git'
}

function git(repo: string, args: string[]): string {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  return execFileSync(gitBin(), args, { cwd: repo, env, encoding: 'utf8' }).trim()
}

async function repo(): Promise<{ base: string; repo: string; data: string; real: string }> {
  const base = await mkdtemp(path.join(tmpdir(), 'tinybots-guard-'))
  dirs.push(base)
  const folder = path.join(base, 'repo')
  const data = path.join(base, 'data')
  await mkdir(folder, { recursive: true })
  await mkdir(data, { recursive: true })
  return { base, repo: folder, data, real: folder }
}

async function commitNote(folder: string, body = 'old\n'): Promise<void> {
  await writeFile(path.join(folder, 'note.txt'), body)
  git(folder, ['init', '-q', '-b', 'main'])
  git(folder, ['config', 'user.email', 't@t'])
  git(folder, ['config', 'user.name', 't'])
  git(folder, ['add', 'note.txt'])
  git(folder, ['commit', '-q', '-m', 'start'])
}

test('I15 юнит: каждый ключ -c и каждая сетевая переменная на месте', () => {
  const expected = [
    'core.hooksPath',
    'core.fsmonitor',
    'core.untrackedCache',
    'commit.gpgSign',
    'protocol.allow',
    'credential.helper',
    'core.askPass',
    'core.sshCommand',
    'core.splitIndex',
    'index.sparse',
    'core.longpaths',
    'gc.auto',
    'maintenance.auto',
  ]
  expect([...GIT_CONFIG_KEYS]).toEqual(expected)
  const prefix = gitPrefix(path.join(tmpdir(), 'root'), path.join(tmpdir(), 'hooks'))
  const text = prefix.join('\n')
  expect(text).toContain('core.hooksPath=')
  expect(text).toContain('core.fsmonitor=false')
  expect(text).toContain('core.untrackedCache=false')
  expect(text).toContain('commit.gpgSign=false')
  expect(text).toContain('protocol.allow=never')
  expect(text).toContain('credential.helper=')
  expect(text).toContain('core.askPass=')
  expect(text).toContain('core.sshCommand=false')
  expect(text).toContain('core.splitIndex=false')
  expect(text).toContain('index.sparse=false')
  expect(text).toContain('core.longpaths=true')
  expect(text).toContain('gc.auto=0')
  expect(text).toContain('maintenance.auto=false')
  expect(text).not.toContain('safe.directory')
  const env = buildGitEnv({})
  expect(env.GIT_TERMINAL_PROMPT).toBe('0')
  expect(env.GIT_CONFIG_NOSYSTEM).toBe('1')
  expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null')
  expect(env.GIT_ALLOW_PROTOCOL).toBe('none')
  expect(env.GIT_NO_LAZY_FETCH).toBe('1')
  expect(env.GIT_LITERAL_PATHSPECS).toBe('1')
  expect(env.GIT_PROTOCOL_FROM_USER).toBe('0')
  expect(env.HOME).toBeUndefined()
  expect(env.USERPROFILE).toBeUndefined()
  expect(env.XDG_CONFIG_HOME).toBeUndefined()
})

async function markerScript(base: string, name: string): Promise<{ script: string; marker: string }> {
  const marker = path.join(base, `${name}.mark`)
  const script = path.join(base, `${name}.sh`)
  await writeFile(script, `#!/bin/sh\necho ran > '${marker}'\nexit 1\n`)
  await chmod(script, 0o755)
  return { script, marker }
}

async function marked(file: string): Promise<boolean> {
  try {
    await readFile(file)
    return true
  } catch {
    return false
  }
}

test('I15 частичный клон: отказ текстом, маркер не пишется', async () => {
  const made = await repo()
  await commitNote(made.repo)
  const oid = git(made.repo, ['rev-parse', 'HEAD:note.txt'])
  await rm(path.join(made.repo, '.git', 'objects', oid.slice(0, 2), oid.slice(2)))
  const { script, marker } = await markerScript(made.base, 'fetch')
  git(made.repo, ['config', 'remote.origin.url', `ext::${script}`])
  git(made.repo, ['config', 'remote.origin.promisor', 'true'])
  git(made.repo, ['config', 'extensions.partialclone', 'origin'])
  git(made.repo, ['config', 'protocol.ext.allow', 'always'])
  const real = await realpath(made.repo)
  const proposed = await createProposal({
    projectReal: real,
    dataDir: made.data,
    dataReal: made.data,
    launcherCwd: made.base,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary: 'поменять',
    diff: '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n',
    now: NOW,
  })
  expect(proposed).toEqual({ ok: false, error: GIT_PARTIAL })
  expect(await marked(marker)).toBe(false)
})

test('I15 cat-file: оба сетевых слоя сняты — маркер есть, один оставлен — нет', async () => {
  const made = await repo()
  await commitNote(made.repo)
  const oid = git(made.repo, ['rev-parse', 'HEAD:note.txt'])
  await rm(path.join(made.repo, '.git', 'objects', oid.slice(0, 2), oid.slice(2)))
  const { script, marker } = await markerScript(made.base, 'fetch')
  git(made.repo, ['config', 'remote.origin.url', `ext::${script}`])
  git(made.repo, ['config', 'remote.origin.promisor', 'true'])
  git(made.repo, ['config', 'extensions.partialclone', 'origin'])
  git(made.repo, ['config', 'protocol.ext.allow', 'always'])
  const real = await realpath(made.repo)
  const probe = async (drop: string[]): Promise<boolean> => {
    await rm(marker, { force: true })
    const api = makeGit({
      bin: gitBin(),
      cwd: made.base,
      rootReal: real,
      dataDir: made.data,
      hooks: { testDropEnv: drop },
    })
    try {
      await api.catBlob(oid, 1024 * 1024)
    } catch {
      // блоба нет: важен только маркер, не код выхода
    }
    return marked(marker)
  }
  expect(await probe([])).toBe(false)
  expect(await probe(['GIT_ALLOW_PROTOCOL'])).toBe(false)
  expect(await probe(['GIT_NO_LAZY_FETCH'])).toBe(false)
  expect(await probe(['GIT_ALLOW_PROTOCOL', 'GIT_NO_LAZY_FETCH'])).toBe(true)
})

test('I15 commit-tree: --no-gpg-sign гасит -S, commit.gpgSign сам по себе нет', async () => {
  const made = await repo()
  await commitNote(made.repo)
  const tree = git(made.repo, ['rev-parse', 'HEAD^{tree}'])
  const parent = git(made.repo, ['rev-parse', 'HEAD'])
  const { script, marker } = await markerScript(made.base, 'gpg')
  git(made.repo, ['config', 'commit.gpgsign', 'true'])
  git(made.repo, ['config', 'gpg.format', 'openpgp'])
  git(made.repo, ['config', 'gpg.program', script])
  const real = await realpath(made.repo)
  const probe = async (omit: string[], dropConfig: string[]): Promise<boolean> => {
    await rm(marker, { force: true })
    const api = makeGit({
      bin: gitBin(),
      cwd: made.base,
      rootReal: real,
      dataDir: made.data,
      hooks: {
        testPrependArgs: ['-S'],
        testOmitArgs: omit,
        testOmitConfig: dropConfig,
      },
    })
    try {
      await api.commitTree(tree, parent, 'x')
    } catch {
      // подпись сорвалась на фальшивом gpg — это и есть маркер
    }
    return marked(marker)
  }
  // git 2.47 не читает commit.gpgSign в commit-tree. -S отменяет только более поздний --no-gpg-sign.
  expect(await probe([], [])).toBe(false)
  expect(await probe([], ['commit.gpgSign'])).toBe(false)
  expect(await probe(['--no-gpg-sign'], [])).toBe(true)
  expect(await probe(['--no-gpg-sign'], ['commit.gpgSign'])).toBe(true)
})

async function filterCase(nested: boolean): Promise<void> {
  const made = await repo()
  const rel = nested ? 'sub/note.txt' : 'note.txt'
  await mkdir(path.dirname(path.join(made.repo, rel)), { recursive: true })
  await writeFile(path.join(made.repo, rel), 'old\n')
  git(made.repo, ['init', '-q', '-b', 'main'])
  git(made.repo, ['config', 'user.email', 't@t'])
  git(made.repo, ['config', 'user.name', 't'])
  git(made.repo, ['add', rel])
  git(made.repo, ['commit', '-q', '-m', 'start'])
  const { script, marker } = await markerScript(made.base, nested ? 'nested' : 'root')
  git(made.repo, ['config', 'filter.x.clean', script])
  git(made.repo, ['config', 'filter.x.smudge', script])
  const attr = nested ? path.join(made.repo, 'sub', '.gitattributes') : path.join(made.repo, '.gitattributes')
  await writeFile(attr, 'note.txt filter=x\n')
  const real = await realpath(made.repo)
  const proposed = await createProposal({
    projectReal: real,
    dataDir: made.data,
    dataReal: made.data,
    launcherCwd: made.base,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary: 'поменять',
    diff: `--- a/${rel}\n+++ b/${rel}\n@@ -1 +1 @@\n-old\n+new\n`,
    now: NOW,
  })
  if (!proposed.ok) {
    throw new Error(proposed.error)
  }
  const row = readProposal(made.data, proposed.id)
  const applied = await applyProposal({
    dataDir: made.data,
    projectReal: real,
    launcherCwd: made.base,
    id: proposed.id,
    patchSha: row?.patch_sha256 ?? '',
    now: NOW,
    by: 'owner',
  })
  expect(applied).toMatchObject({ ok: false, error: 'unsupported_filter' })
  expect(await marked(marker)).toBe(false)
  expect(await readFile(path.join(real, rel), 'utf8')).toBe('old\n')
}

test('I15 фильтр в корневом .gitattributes не запускается', async () => {
  await filterCase(false)
})

test('I15 фильтр во вложенном .gitattributes не запускается', async () => {
  await filterCase(true)
})

test('I15 dubious ownership: понятный отказ и нет safe.directory', async () => {
  const made = await repo()
  await commitNote(made.repo)
  const real = await realpath(made.repo)
  const seen: string[] = []
  const execFile: GitExec = async (_file, args) => {
    seen.push(args.join(' '))
    const error = Object.assign(new Error('git'), {
      code: 128,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from('fatal: detected dubious ownership in the repository'),
    })
    throw error
  }
  const inspected = await inspectGitRepo({
    bin: gitBin(),
    cwd: made.base,
    rootReal: real,
    dataDir: made.data,
    hooks: { execFile },
  })
  expect(inspected).toEqual({ ok: false, reason: GIT_OWNER, code: 'owner' })
  expect(seen.join('\n')).not.toContain('safe.directory')
})

test.skipIf(process.platform === 'win32' || process.getuid?.() !== 0)('I15 чужой uid у .git — отказ', async () => {
  const made = await repo()
  await commitNote(made.repo)
  const real = await realpath(made.repo)
  const gitDir = path.join(real, '.git')
  const before = await lstat(gitDir)
  execFileSync('chown', ['1', gitDir])
  try {
    const inspected = await inspectGitRepo({
      bin: gitBin(),
      cwd: made.base,
      rootReal: real,
      dataDir: made.data,
    })
    expect(inspected.ok).toBe(false)
    if (!inspected.ok) {
      expect(inspected.reason).toBe(GIT_OWNER)
    }
  } finally {
    execFileSync('chown', [String(before.uid), gitDir])
  }
})
