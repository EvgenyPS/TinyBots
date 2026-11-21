/**
 * FILE: apps/server/src/proposals/keep.test.ts
 * НАЗНАЧЕНИЕ: I19. Бот не может безвозвратно стереть файл, снимок или репозиторий.
 * ВХОД: временный проект и враждебный мок на 127.0.0.1.
 * ВЫХОД: отказ на propose и прежние байты. Снимок применённого переживает чистку.
 */

import { execFileSync } from 'node:child_process'
import http from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stringify } from 'yaml'
import { afterEach, expect, test } from 'vitest'
import { deliverChat } from '../llm/turn.js'
import { repoRoot } from '../root.js'
import { CLOSED_KEEP_MS } from '../tools/limits.js'
import { applyProposal, createProposal, revertProposal } from './engine.js'
import { proposalDir, readProposal } from './store.js'

const dirs: string[] = []
const NOW = new Date('2026-11-21T12:00:00.000Z')

afterEach(async () => {
  delete process.env.DEEPSEEK_API_KEY
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function world(): Promise<{ project: string; data: string }> {
  const base = await mkdtemp(path.join(tmpdir(), 'tinybots-keep-'))
  dirs.push(base)
  await mkdir(path.join(base, 'proj'), { recursive: true })
  const project = await realpath(path.join(base, 'proj'))
  const data = path.join(base, 'data')
  await mkdir(data, { recursive: true })
  await writeFile(path.join(project, 'note.txt'), 'old\n')
  await writeFile(path.join(project, 'half.txt'), 'a\nb\nc\nd\n')
  await writeFile(path.join(project, 'short.txt'), 'hello\n')
  return { project, data }
}

function ask(project: string, data: string, summary: string, diff: string) {
  return createProposal({
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
  })
}

test('I19 propose отвергает удаление, переименование, пустой файл и больше половины строк', async () => {
  const { project, data } = await world()
  const before = await readFile(path.join(project, 'note.txt'))
  const deleted = await ask(project, data, 'стереть', '--- a/note.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n')
  expect(deleted).toMatchObject({ ok: false, error: 'удаление или переименование' })
  const renamed = await ask(project, data, 'переименовать', '--- a/note.txt\n+++ b/renamed.txt\n@@ -1 +1 @@\n-old\n+old\n')
  expect(renamed).toMatchObject({ ok: false, error: 'удаление или переименование' })
  const empty = await ask(project, data, 'опустошить', '--- a/short.txt\n+++ b/short.txt\n@@ -1 +1 @@\n-hello\n+   \n')
  expect(empty).toMatchObject({ ok: false, error: 'файл станет пустым' })
  const tooMuch = await ask(
    project,
    data,
    'вырезать',
    '--- a/half.txt\n+++ b/half.txt\n@@ -1,4 +1,1 @@\n-a\n-b\n-c\n d\n',
  )
  expect(tooMuch).toMatchObject({ ok: false, error: 'удалено больше половины файла' })
  const half = await ask(
    project,
    data,
    'половина',
    '--- a/half.txt\n+++ b/half.txt\n@@ -1,4 +1,2 @@\n-a\n-b\n c\n d\n',
  )
  expect(half.ok).toBe(true)
  expect(await readFile(path.join(project, 'note.txt'))).toEqual(before)
  expect(await readFile(path.join(project, 'half.txt'), 'utf8')).toBe('a\nb\nc\nd\n')
  expect(await readFile(path.join(project, 'short.txt'), 'utf8')).toBe('hello\n')
})

test('I19 снимок переживает apply, revert и чистку применённых', async () => {
  const { project, data } = await world()
  const made = await ask(project, data, 'поменять', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n')
  if (!made.ok) {
    throw new Error(made.error)
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
  const backup = path.join(proposalDir(data, made.id), 'backup', 'note.txt')
  expect(await readFile(backup, 'utf8')).toBe('old\n')
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
  expect(await readFile(path.join(project, 'note.txt'), 'utf8')).toBe('old\n')
  expect(await readFile(backup, 'utf8')).toBe('old\n')

  const oldAt = new Date(NOW.getTime() - CLOSED_KEEP_MS - 24 * 60 * 60 * 1000).toISOString()
  const store = path.join(data, 'proposals')
  await mkdir(store, { recursive: true })
  const keptId = 'kept-reverted'
  const keptBody = {
    schema_version: 1,
    id: keptId,
    project: 'demo-keys',
    bot: 'nora',
    summary: 'уже применяли',
    state: 'reverted',
    patch_sha256: 'a'.repeat(64),
    mode: 'files',
    files: [{ path: 'note.txt', base_sha256: 'b'.repeat(64), post_sha256: 'c'.repeat(64) }],
    history: [
      { state: 'applied', at: oldAt, by: 'owner', why: 'apply' },
      { state: 'reverted', at: oldAt, by: 'owner', why: 'revert' },
    ],
  }
  await writeFile(path.join(store, `${keptId}.json`), `${JSON.stringify(keptBody, null, 2)}\n`)
  const keptSnap = path.join(store, keptId, 'backup', 'note.txt')
  await mkdir(path.dirname(keptSnap), { recursive: true })
  await writeFile(keptSnap, 'SNAP\n')
  const goneBody = { ...keptBody, id: 'gone-rejected', state: 'rejected', history: [{ state: 'rejected', at: oldAt, by: 'nora', why: 'reject' }] }
  await writeFile(path.join(store, 'gone-rejected.json'), `${JSON.stringify(goneBody, null, 2)}\n`)
  const again = await ask(project, data, 'ещё', '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+next\n')
  expect(again.ok).toBe(true)
  expect(readProposal(data, 'gone-rejected')).toBeNull()
  expect(readProposal(data, keptId)?.state).toBe('reverted')
  expect(await readFile(keptSnap, 'utf8')).toBe('SNAP\n')
  expect(await readFile(backup, 'utf8')).toBe('old\n')
})

function listen(handler: () => unknown): Promise<{ url: string; close: () => Promise<void>; bodies: string[] }> {
  const bodies: string[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(handler()))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address && typeof address !== 'string' ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        bodies,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

test('I19 враждебный ответ не удаляет файл, ветку и .git', async () => {
  const project = await realpath(await mkdtemp(path.join(tmpdir(), 'tinybots-hostile-')))
  dirs.push(project)
  await writeFile(path.join(project, 'note.txt'), 'old\n')
  const gitEnv = { ...process.env }
  delete gitEnv.GIT_DIR
  delete gitEnv.GIT_WORK_TREE
  delete gitEnv.GIT_INDEX_FILE
  const git = (args: string[]) => execFileSync('git', args, { cwd: project, env: gitEnv, encoding: 'utf8' }).trim()
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 't@t'])
  git(['config', 'user.name', 't'])
  git(['add', 'note.txt'])
  git(['commit', '-m', 'start'])
  const head = await readFile(path.join(project, '.git', 'HEAD'))
  const note = await readFile(path.join(project, 'note.txt'))
  const branches = git(['for-each-ref', '--format=%(refname)', 'refs/heads'])
  mkdirSync(path.join(repoRoot(), 'data'), { recursive: true })
  const home = mkdtempSync(path.join(repoRoot(), 'data', 'vitest-keep-'))
  dirs.push(home)
  mkdirSync(path.join(home, 'store'), { recursive: true })
  let step = 0
  const mock = await listen(() => {
    step += 1
    if (step === 1) {
      return {
        choices: [{
          message: {
            content: '',
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'delete_file', arguments: '{"path":"note.txt"}' } },
              { id: 'c2', type: 'function', function: { name: 'git', arguments: '{"cmd":"branch -D main"}' } },
              {
                id: 'c3',
                type: 'function',
                function: {
                  name: 'propose_patch',
                  arguments: JSON.stringify({
                    summary: 'снести',
                    diff: '--- a/note.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n',
                  }),
                },
              },
              {
                id: 'c4',
                type: 'function',
                function: {
                  name: 'propose_patch',
                  arguments: JSON.stringify({
                    summary: 'снести git',
                    diff: '--- a/.git/HEAD\n+++ /dev/null\n@@ -1 +0,0 @@\n-ref: refs/heads/main\n',
                  }),
                },
              },
            ],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }
    }
    return {
      choices: [{ message: { content: 'готово' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }
  })
  const config = {
    schema_version: 1,
    owner: { name: 'Ника', confirms_merge: true },
    data_dir: 'store',
    delivery: 'clipboard',
    bots: [{
      id: 'nora',
      name: 'Нора',
      role: 'справка',
      instructions: 'Коротко.',
      provider: 'deepseek',
      model: 'deepseek-chat',
      base_url: mock.url,
      api_key_env: 'DEEPSEEK_API_KEY',
      project_tools: 'propose',
    }, { id: 'bitk', name: 'Бит', role: 'код' }],
    projects: [{
      id: 'demo-keys',
      title: 'Demo',
      lead: 'nora',
      owner: 'owner',
      merge_executor: 'bitk',
      allow_bot_tools: true,
      source: { files: { path: project } },
      chats: [{
        id: 'build',
        title: 'Сборка',
        lead: 'nora',
        members: ['nora'],
        rules: { do: 'код', dont: 'чужое' },
        context: [],
        economy: { wake: 'mentioned_only', reply_limit: 'short' },
      }],
    }],
    economy: { defaults: { wake: 'mentioned_only', reply_limit: 'short', max_wakes_per_task: 3 }, stale_after_hours: 6 },
  }
  writeFileSync(path.join(home, 'config.yaml'), stringify(config))
  const configPath = path.relative(repoRoot(), path.join(home, 'config.yaml')).split(path.sep).join('/')
  try {
    const spoken = await deliverChat({
      root: repoRoot(),
      options: { configPath },
      botId: 'nora',
      text: 'удали всё',
      projectId: 'demo-keys',
      chatId: 'build',
      deps: {
        lookup: () => Promise.resolve(['127.0.0.1']),
        env: { DEEPSEEK_API_KEY: 'demo-deepseek-key' },
        now: () => NOW,
      },
    })
    expect(spoken, JSON.stringify(spoken)).toMatchObject({ ok: true, reply: 'готово' })
    const follow = mock.bodies[1] ?? ''
    expect(follow).toContain('неизвестный инструмент')
    expect(follow).toContain('удаление или переименование')
  } finally {
    await mock.close()
  }
  expect(await readFile(path.join(project, 'note.txt'))).toEqual(note)
  expect(await readFile(path.join(project, '.git', 'HEAD'))).toEqual(head)
  expect(git(['for-each-ref', '--format=%(refname)', 'refs/heads'])).toBe(branches)
  expect(git(['rev-parse', '--git-dir'])).toBe('.git')
  expect(git(['status', '--porcelain'])).toBe('')
})
