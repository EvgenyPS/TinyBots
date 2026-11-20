/**
 * FILE: apps/server/src/merge/merge.test.ts
 * НАЗНАЧЕНИЕ: этап 2, критерии C2–C4, C9, C10, C12 и мок ошибки мержа.
 * C3 — таблица всех пар статусов. C12 — файл решения не двигает статус, пока нет доставки.
 * GitHub в этих тестах не вызывается: ответ даёт мок.
 */

import { createHash } from 'node:crypto'
import http from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MERGE_STATES, MERGE_TRANSITIONS, configSchema, mergeRequestSchema, type MergeRequest, type MergeState } from '@tinybots/schema'
import { stringify } from 'yaml'
import { afterEach, expect, test } from 'vitest'
import { BIND_HOST } from '../bind.js'
import { repoRoot } from '../root.js'
import { startServer, type RunningServer } from '../server.js'
import { buildMergeBrief, buildRevertBrief } from './authorize.js'
import { deliverOutbox } from './deliver.js'
import { readMerges } from './disk.js'
import { acceptProjectFiles, restoreProjectFiles, sha256Of } from './files-apply.js'
import { mockGithubMerge } from './github-mock.js'
import { postDecision } from './http.js'
import { MergeTransitionError, applyTransition } from './transition.js'

const AT = '2026-11-19T10:00:00.000Z'
const SHA = '0123456789abcdef0123456789abcdef01234567'
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'tinybots-merge-'))
  dirs.push(dir)
  return dir
}

function request(state: MergeState, extra: Record<string, unknown> = {}): MergeRequest {
  return mergeRequestSchema.parse({
    schema_version: 1,
    updated_at: AT,
    project: 'demo-game',
    pr_url: 'https://example.invalid/demo/pull/1',
    head_sha: SHA,
    tasks: ['task-01'],
    checks: 'green',
    summary: 'Демо запрос',
    state,
    history: [{ state, at: AT, by: 'lead1', why: 'старт' }],
    id: 'mr-cycle',
    task_id: 'task-01',
    mode: 'git',
    author: 'dev1',
    lead: 'lead1',
    merge_executor: 'dev1',
    owner: 'owner',
    affected_chats: ['build'],
    iterations: [{
      n: 1,
      created_at: AT,
      done: ['превью'],
      broken: [],
      postponed: [],
      risks: [],
      other: '',
      addressed_feedback: null,
      decision: null,
    }],
    ...extra,
  })
}

function briefInput(state: string, decision: { action: string; by: string; accept_risk?: boolean }) {
  return {
    state,
    owner: 'owner',
    id: 'mr-cycle',
    pr_url: 'https://example.invalid/demo/pull/1',
    head_sha: SHA,
    checks: 'green' as const,
    decision: { ...decision, head_sha: SHA },
  }
}

const baseConfig = {
  schema_version: 1,
  owner: { name: 'Owner', confirms_merge: true },
  data_dir: 'data',
  delivery: 'clipboard' as const,
  bots: [
    { id: 'lead1', name: 'Ава', role: 'тимлид' },
    { id: 'dev1', name: 'Бит', role: 'код', executor_for_merge: true },
  ],
  projects: [{
    id: 'demo-game',
    title: 'Demo Game',
    lead: 'lead1',
    owner: 'owner',
    merge_executor: 'dev1',
    source: { git: { provider: 'github' as const, repo: 'example/demo-game' }, files: { path: 'project' } },
    chats: [{
      id: 'build',
      title: 'Сборка',
      lead: 'dev1',
      members: ['dev1', 'lead1'],
      rules: { do: 'код', dont: 'шум' },
      context: [],
      economy: { wake: 'mentioned_only' as const, reply_limit: 'short' as const },
    }],
  }],
  economy: {
    defaults: { wake: 'mentioned_only' as const, reply_limit: 'short' as const, max_wakes_per_task: 3 },
    stale_after_hours: 6,
  },
}

test('C2: бриф мержа только из delivered, approved и от владельца', () => {
  for (const state of MERGE_STATES) {
    const result = buildMergeBrief(briefInput(state, { action: 'approved', by: 'owner' }))
    expect(result.ok, state).toBe(state === 'delivered')
  }
  expect(buildMergeBrief(briefInput('delivered', { action: 'approved', by: 'qa1' })).ok).toBe(false)
  expect(buildMergeBrief(briefInput('delivered', { action: 'rejected', by: 'owner' })).ok).toBe(false)
  expect(buildMergeBrief(briefInput('delivered', { action: 'revert', by: 'owner' })).ok).toBe(false)
  const ready = buildMergeBrief(briefInput('delivered', { action: 'approved', by: 'owner' }))
  expect(ready).toEqual({ ok: true, text: 'мержи mr-cycle https://example.invalid/demo/pull/1' })
})

test('C10: откат только mode revert из merged и от владельца', () => {
  for (const state of MERGE_STATES) {
    const result = buildRevertBrief({
      ...briefInput(state, { action: 'revert', by: 'owner' }),
      mode: 'revert',
    })
    expect(result.ok, state).toBe(state === 'merged')
  }
  const ownerNo = buildRevertBrief({ ...briefInput('merged', { action: 'revert', by: 'dev1' }), mode: 'revert' })
  expect(ownerNo.ok).toBe(false)
  const modeNo = buildRevertBrief({ ...briefInput('merged', { action: 'revert', by: 'owner' }), mode: 'git' })
  expect(modeNo.ok).toBe(false)
  const actionNo = buildRevertBrief({ ...briefInput('merged', { action: 'approved', by: 'owner' }), mode: 'revert' })
  expect(actionNo.ok).toBe(false)
  const ready = buildRevertBrief({ ...briefInput('merged', { action: 'revert', by: 'owner' }), mode: 'revert' })
  expect(ready.ok).toBe(true)
})

test('C3 и C4: каждая пара статусов и журнал кто/когда/почему', () => {
  for (const from of MERGE_STATES) {
    for (const to of MERGE_STATES) {
      const allowed = (MERGE_TRANSITIONS[from] as readonly string[]).includes(to)
      const current = request(from)
      if (!allowed) {
        expect(() => applyTransition(current, { to, by: 'lead1', at: AT, why: 'нет' }), `${from} -> ${to}`).toThrow(MergeTransitionError)
        continue
      }
      const next = applyTransition(current, { to, by: 'lead1', at: AT, why: 'шаг владельца' })
      expect(next.state, `${from} -> ${to}`).toBe(to)
      const last = next.history[next.history.length - 1]
      expect(last).toEqual({ state: to, at: AT, by: 'lead1', why: 'шаг владельца' })
    }
  }
  expect(() => applyTransition(request('approved'), { to: 'awaiting_owner', by: 'lead1', at: AT, why: 'sha' })).toThrow(MergeTransitionError)
  const back = applyTransition(request('approved'), {
    to: 'awaiting_owner',
    by: 'lead1',
    at: AT,
    why: 'head изменился',
    cause: 'head_sha_changed',
  })
  expect(back.history.at(-1)).toEqual({ state: 'awaiting_owner', at: AT, by: 'lead1', why: 'head изменился' })
  expect(() => applyTransition(request('awaiting_owner'), { to: 'approved', by: ' ', at: AT, why: 'пусто' })).toThrow(MergeTransitionError)
  expect(() => applyTransition(request('awaiting_owner'), { to: 'approved', by: 'owner', at: AT, why: ' ' })).toThrow(MergeTransitionError)
})

test('мок GitHub не ходит в сеть и умеет упасть', () => {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = ((input: unknown) => {
    calls.push(String(input))
    return Promise.reject(new Error('сеть'))
  }) as typeof fetch
  try {
    expect(mockGithubMerge('https://example.invalid/demo/pull/1')).toEqual({
      ok: true,
      commit: 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00',
    })
    expect(mockGithubMerge('https://example.invalid/mock-fail/pull/9').ok).toBe(false)
    expect(calls).toEqual([])
  } finally {
    globalThis.fetch = original
  }
})

test('C9: снимок backups и откат совпадают по sha256', async () => {
  const root = scratch()
  const project = path.join(root, 'project')
  mkdirSync(path.join(project, 'staging'), { recursive: true })
  const live = path.join(project, 'note.txt')
  const original = Buffer.from('до мержа\n', 'utf8')
  writeFileSync(live, original)
  writeFileSync(path.join(project, 'staging', 'note.txt'), 'после мержа\n')
  const before = await sha256Of(live)
  writeFileSync(path.join(project, 'staging', 'fresh.txt'), 'новый\n')
  await acceptProjectFiles({ projectDir: project, mrId: 'mr-cycle', files: ['note.txt', 'fresh.txt'] })
  expect(readFileSync(live, 'utf8')).toBe('после мержа\n')
  expect(readFileSync(path.join(project, 'fresh.txt'), 'utf8')).toBe('новый\n')
  const backup = path.join(project, 'backups', 'mr-cycle', 'note.txt')
  expect(readFileSync(backup).equals(original)).toBe(true)
  await restoreProjectFiles({ projectDir: project, mrId: 'mr-cycle', files: ['note.txt', 'fresh.txt'] })
  expect(await sha256Of(live)).toBe(before)
  expect(createHash('sha256').update(original).digest('hex')).toBe(before)
  expect(existsSync(path.join(project, 'fresh.txt'))).toBe(false)
})

test('C9: ошибка отката одного запроса не рвёт синк', async () => {
  const root = scratch()
  const project = path.join(root, 'project')
  const data = path.join(root, 'data')
  mkdirSync(path.join(project), { recursive: true })
  mkdirSync(path.join(data, 'merge_requests'), { recursive: true })
  mkdirSync(path.join(data, 'outbox', 'decisions'), { recursive: true })
  writeFileSync(path.join(project, 'note.txt'), 'до мержа\n')
  const broken = request('merged', { id: 'mr-bad', mode: 'files', files: [{ path: 'note.txt' }] })
  const healthy = request('awaiting_owner', { id: 'mr-ok' })
  writeFileSync(path.join(data, 'merge_requests', 'mr-bad.json'), `${JSON.stringify(broken, null, 2)}\n`)
  writeFileSync(path.join(data, 'merge_requests', 'mr-ok.json'), `${JSON.stringify(healthy, null, 2)}\n`)
  const decision = {
    schema_version: 1,
    updated_at: AT,
    head_sha: SHA,
    by: 'owner',
    at: AT,
    project: 'demo-game',
  }
  writeFileSync(path.join(data, 'outbox', 'decisions', 'mr-bad.json'), `${JSON.stringify({
    ...decision,
    action: 'revert',
    pr_url: broken.pr_url,
    mr_id: 'mr-bad',
  }, null, 2)}\n`)
  writeFileSync(path.join(data, 'outbox', 'decisions', 'mr-ok.json'), `${JSON.stringify({
    ...decision,
    action: 'approved',
    pr_url: healthy.pr_url,
    mr_id: 'mr-ok',
  }, null, 2)}\n`)
  const config = configSchema.parse(baseConfig)
  const report = await deliverOutbox({ dataDir: data, config, configDirectory: root, now: new Date(AT) })
  expect(report.applied).toEqual([{ id: 'mr-ok', state: 'merged' }])
  expect(readMerges(data).find((item) => item.id === 'mr-bad')?.mr.state).toBe('merged')
  expect(readFileSync(path.join(project, 'note.txt'), 'utf8')).toBe('до мержа\n')
})

test('симлинк не выносит файл и снимок за папку проекта', async () => {
  const root = scratch()
  const project = path.join(root, 'project')
  const outside = path.join(root, 'outside')
  mkdirSync(path.join(project, 'staging'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  const secret = path.join(outside, 'secret.txt')
  writeFileSync(secret, 'секрет\n')
  writeFileSync(path.join(project, 'note.txt'), 'до\n')
  writeFileSync(path.join(project, 'staging', 'note.txt'), 'после\n')
  symlinkSync(secret, path.join(project, 'staging', 'leak.txt'))
  await expect(acceptProjectFiles({ projectDir: project, mrId: 'mr-cycle', files: ['leak.txt'] })).rejects.toThrow()
  expect(readFileSync(secret, 'utf8')).toBe('секрет\n')

  symlinkSync(secret, path.join(project, 'live-link.txt'))
  writeFileSync(path.join(project, 'staging', 'live-link.txt'), 'после\n')
  await expect(acceptProjectFiles({ projectDir: project, mrId: 'mr-cycle', files: ['live-link.txt'] })).rejects.toThrow()
  expect(readFileSync(secret, 'utf8')).toBe('секрет\n')

  symlinkSync(outside, path.join(project, 'sub'))
  mkdirSync(path.join(project, 'staging', 'sub'), { recursive: true })
  writeFileSync(path.join(project, 'staging', 'sub', 'a.txt'), 'после\n')
  await expect(acceptProjectFiles({ projectDir: project, mrId: 'mr-cycle', files: ['sub/a.txt'] })).rejects.toThrow()
  expect(readdirSync(outside)).toEqual(['secret.txt'])

  symlinkSync(outside, path.join(project, 'backups'))
  await expect(acceptProjectFiles({ projectDir: project, mrId: 'mr-cycle', files: ['note.txt'] })).rejects.toThrow()
  expect(readdirSync(outside)).toEqual(['secret.txt'])
  expect(readFileSync(path.join(project, 'note.txt'), 'utf8')).toBe('до\n')
})

test('Н37: .git в списке файлов не переносится', async () => {
  const root = scratch()
  const project = path.join(root, 'project')
  mkdirSync(path.join(project, 'staging', '.git', 'hooks'), { recursive: true })
  writeFileSync(path.join(project, 'staging', '.git', 'hooks', 'pre-commit'), 'хук\n')
  await expect(acceptProjectFiles({
    projectDir: project,
    mrId: 'mr-cycle',
    files: ['.git/hooks/pre-commit'],
  })).rejects.toThrow()
  expect(existsSync(path.join(project, '.git', 'hooks', 'pre-commit'))).toBe(false)
})

test('C11: обрыв files-мержа возвращает исходные sha256', async () => {
  const root = scratch()
  const project = path.join(root, 'project')
  mkdirSync(path.join(project, 'staging'), { recursive: true })
  const fileA = path.join(project, 'a.txt')
  const fileB = path.join(project, 'b.txt')
  writeFileSync(fileA, 'а-до\n')
  writeFileSync(fileB, 'б-до\n')
  writeFileSync(path.join(project, 'staging', 'a.txt'), 'а-после\n')
  const beforeA = await sha256Of(fileA)
  const beforeB = await sha256Of(fileB)
  await expect(acceptProjectFiles({ projectDir: project, mrId: 'mr-cycle', files: ['a.txt', 'b.txt'] })).rejects.toThrow()
  expect(await sha256Of(fileA)).toBe(beforeA)
  expect(await sha256Of(fileB)).toBe(beforeB)
  writeFileSync(path.join(project, 'staging', 'b.txt'), 'б-после\n')
  await expect(acceptProjectFiles({
    projectDir: project,
    mrId: 'mr-cycle',
    files: ['a.txt', 'b.txt'],
    afterCopy: (index) => {
      if (index === 0) {
        throw new Error('обрыв')
      }
    },
  })).rejects.toThrow('обрыв')
  expect(await sha256Of(fileA)).toBe(beforeA)
  expect(await sha256Of(fileB)).toBe(beforeB)
  expect(readFileSync(fileA, 'utf8')).toBe('а-до\n')
  expect(readFileSync(fileB, 'utf8')).toBe('б-до\n')
})

test('C12: решение в outbox не меняет статус, доставка меняет', async () => {
  const root = scratch()
  const data = path.join(root, 'data')
  mkdirSync(path.join(data, 'merge_requests'), { recursive: true })
  mkdirSync(path.join(data, 'outbox', 'decisions'), { recursive: true })
  const mr = request('awaiting_owner')
  const file = path.join(data, 'merge_requests', 'mr-cycle.json')
  writeFileSync(file, `${JSON.stringify(mr, null, 2)}\n`)
  const before = readFileSync(file, 'utf8')
  writeFileSync(path.join(data, 'outbox', 'decisions', 'mr-cycle.json'), `${JSON.stringify({
    schema_version: 1,
    updated_at: AT,
    action: 'approved',
    head_sha: SHA,
    by: 'owner',
    at: AT,
    project: 'demo-game',
    pr_url: mr.pr_url,
    mr_id: 'mr-cycle',
  }, null, 2)}\n`)
  expect(readFileSync(file, 'utf8')).toBe(before)
  expect(readMerges(data)[0]?.mr.state).toBe('awaiting_owner')
  const config = configSchema.parse(baseConfig)
  const stranger = path.join(data, 'outbox', 'decisions', 'mr-cycle.json')
  writeFileSync(stranger, readFileSync(stranger, 'utf8').replace('"by": "owner"', '"by": "qa1"'))
  const skipped = await deliverOutbox({ dataDir: data, config, configDirectory: root, now: new Date(AT) })
  expect(skipped.applied).toEqual([])
  expect(readMerges(data)[0]?.mr.state).toBe('awaiting_owner')
  writeFileSync(stranger, readFileSync(stranger, 'utf8').replace('"by": "qa1"', '"by": "owner"'))
  const applied = await deliverOutbox({ dataDir: data, config, configDirectory: root, now: new Date(AT) })
  expect(applied.applied).toEqual([{ id: 'mr-cycle', state: 'merged' }])
  const merged = readMerges(data)[0]?.mr
  expect(merged?.state).toBe('merged')
  expect(merged?.history.map((item) => item.state)).toEqual([
    'awaiting_owner',
    'approved',
    'delivered',
    'merging',
    'merged',
  ])
})

test('доработка добавляет итерацию 2 и не повторяется', async () => {
  const root = scratch()
  const data = path.join(root, 'data')
  mkdirSync(path.join(data, 'merge_requests'), { recursive: true })
  mkdirSync(path.join(data, 'outbox', 'feedback'), { recursive: true })
  const mr = request('awaiting_owner')
  writeFileSync(path.join(data, 'merge_requests', 'mr-cycle.json'), `${JSON.stringify(mr, null, 2)}\n`)
  writeFileSync(path.join(data, 'outbox', 'feedback', 'fb-mr-cycle.json'), `${JSON.stringify({
    schema_version: 1,
    updated_at: '2026-11-19T10:05:00.000Z',
    id: 'fb-mr-cycle',
    project: 'demo-game',
    task_id: 'task-01',
    by: 'owner',
    at: '2026-11-19T10:05:00.000Z',
    feedback: 'поправь отступ',
    sent_to_chats: ['build'],
    mr_id: 'mr-cycle',
    intent: 'changes_requested',
  }, null, 2)}\n`)
  const config = configSchema.parse(baseConfig)
  await deliverOutbox({ dataDir: data, config, configDirectory: root, now: new Date(AT) })
  const once = readMerges(data)[0]?.mr
  expect(once?.state).toBe('awaiting_owner')
  expect(once?.iterations?.[1]?.addressed_feedback).toEqual({
    quote: 'поправь отступ',
    fixed: ['исправлено по отзыву'],
    remaining: ['осталось проверить'],
  })
  await deliverOutbox({ dataDir: data, config, configDirectory: root, now: new Date(AT) })
  expect(readMerges(data)[0]?.mr.iterations).toHaveLength(2)
})

test('мок ошибки возвращает awaiting_owner и пишет причину', async () => {
  const root = scratch()
  const data = path.join(root, 'data')
  mkdirSync(path.join(data, 'merge_requests'), { recursive: true })
  mkdirSync(path.join(data, 'outbox', 'decisions'), { recursive: true })
  const mr = request('awaiting_owner', { pr_url: 'https://example.invalid/mock-fail/pull/9' })
  writeFileSync(path.join(data, 'merge_requests', 'mr-cycle.json'), `${JSON.stringify(mr, null, 2)}\n`)
  writeFileSync(path.join(data, 'outbox', 'decisions', 'mr-cycle.json'), `${JSON.stringify({
    schema_version: 1,
    updated_at: AT,
    action: 'approved',
    head_sha: SHA,
    by: 'owner',
    at: AT,
    project: 'demo-game',
    pr_url: mr.pr_url,
    mr_id: 'mr-cycle',
  }, null, 2)}\n`)
  const config = configSchema.parse(baseConfig)
  const report = await deliverOutbox({ dataDir: data, config, configDirectory: root, now: new Date(AT) })
  expect(report.applied).toEqual([{ id: 'mr-cycle', state: 'awaiting_owner' }])
  const history = readMerges(data)[0]?.mr.history ?? []
  expect(history.some((item) => item.state === 'merge_failed' && item.why.includes('мок GitHub'))).toBe(true)
})

test('смена head_sha после approved возвращает владельцу', async () => {
  const root = scratch()
  const data = path.join(root, 'data')
  mkdirSync(path.join(data, 'merge_requests'), { recursive: true })
  mkdirSync(path.join(data, 'outbox', 'decisions'), { recursive: true })
  const mr = request('approved', { head_sha: 'abcdef0123456789abcdef0123456789abcdef01' })
  writeFileSync(path.join(data, 'merge_requests', 'mr-cycle.json'), `${JSON.stringify(mr, null, 2)}\n`)
  writeFileSync(path.join(data, 'outbox', 'decisions', 'mr-cycle.json'), `${JSON.stringify({
    schema_version: 1,
    updated_at: AT,
    action: 'approved',
    head_sha: SHA,
    by: 'owner',
    at: AT,
    project: 'demo-game',
    pr_url: mr.pr_url,
    mr_id: 'mr-cycle',
  }, null, 2)}\n`)
  const config = configSchema.parse(baseConfig)
  const report = await deliverOutbox({ dataDir: data, config, configDirectory: root, now: new Date(AT) })
  expect(report.applied[0]?.state).toBe('awaiting_owner')
})

test('HTTP: решение не двигает файл запроса до синхронизации', async () => {
  const root = scratch()
  const data = path.join(root, 'data', 'merge_requests')
  mkdirSync(data, { recursive: true })
  const mr = request('awaiting_owner')
  writeFileSync(path.join(data, 'mr-cycle.json'), `${JSON.stringify(mr, null, 2)}\n`)
  writeFileSync(path.join(root, 'config.yaml'), stringify(baseConfig))
  const decided = await postDecision(root, { configPath: 'config.yaml', now: () => new Date(AT) }, {
    id: 'mr-cycle',
    action: 'approved',
    sent_to_chats: ['build'],
  })
  expect(decided.status).toBe(200)
  expect(decided.body.state).toBe('awaiting_owner')
  const onDisk = JSON.parse(readFileSync(path.join(data, 'mr-cycle.json'), 'utf8')) as { state: string }
  expect(onDisk.state).toBe('awaiting_owner')
})

function httpCall(
  port: number,
  method: string,
  pathname: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: BIND_HOST, port, path: pathname, method, headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          try {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) as unknown })
          } catch {
            resolve({ status: res.statusCode ?? 0, json: text })
          }
        })
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

test('HTTP: decide и sync без своего Origin или токена не меняют файлы', async () => {
  const rel = 'data/merge-guard/config.yaml'
  const dir = path.join(repoRoot(), 'data', 'merge-guard')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.join(dir, 'data', 'merge_requests'), { recursive: true })
  const mr = request('awaiting_owner')
  const mrFile = path.join(dir, 'data', 'merge_requests', 'mr-cycle.json')
  writeFileSync(path.join(dir, 'config.yaml'), stringify(baseConfig))
  writeFileSync(mrFile, `${JSON.stringify(mr, null, 2)}\n`)
  const before = readFileSync(mrFile)
  let server: RunningServer | undefined
  try {
    server = await startServer({ port: 0, configPath: rel })
    const host = `${BIND_HOST}:${server.port}`
    const opened = await httpCall(server.port, 'GET', '/api/launcher', { Host: host })
    expect(opened.status).toBe(200)
    const csrf = (opened.json as { csrf?: string }).csrf ?? ''
    expect(csrf.length).toBeGreaterThan(10)
    const decideBody = JSON.stringify({ id: 'mr-cycle', action: 'approved' })
    const routes = [
      { path: '/api/merge/decide', body: decideBody },
      { path: '/api/sync/apply', body: '{}' },
    ]
    for (const route of routes) {
      const cases: Array<{ name: string; headers: Record<string, string> }> = [
        { name: 'нет токена', headers: { Host: host, Origin: `http://${host}`, 'Content-Type': 'application/json' } },
        {
          name: 'чужой токен',
          headers: { Host: host, Origin: `http://${host}`, 'Content-Type': 'application/json', 'X-CSRF-Token': 'not-the-token' },
        },
        { name: 'нет Origin', headers: { Host: host, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } },
        { name: 'Origin null', headers: { Host: host, Origin: 'null', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } },
        {
          name: 'чужой порт',
          headers: { Host: host, Origin: `http://${BIND_HOST}:9`, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        },
        {
          name: 'чужой Host',
          headers: {
            Host: `evil.example:${server.port}`,
            Origin: `http://${host}`,
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
          },
        },
      ]
      for (const item of cases) {
        const sent = await httpCall(server.port, 'POST', route.path, item.headers, route.body)
        expect(sent.status, `${route.path} ${item.name}`).toBe(403)
      }
    }
    expect(readFileSync(mrFile).equals(before)).toBe(true)
    expect(existsSync(path.join(dir, 'data', 'outbox'))).toBe(false)
  } finally {
    await server?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})