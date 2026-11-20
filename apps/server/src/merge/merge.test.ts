/**
 * FILE: apps/server/src/merge/merge.test.ts
 * НАЗНАЧЕНИЕ: этап 2, критерии C2–C4, C9, C10, C12 и мок ошибки мержа.
 * C3 — таблица всех пар статусов. C12 — файл решения не двигает статус, пока нет доставки.
 * GitHub в этих тестах не вызывается: ответ даёт мок.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MERGE_STATES, MERGE_TRANSITIONS, configSchema, mergeRequestSchema, type MergeRequest, type MergeState } from '@tinybots/schema'
import { stringify } from 'yaml'
import { afterEach, expect, test } from 'vitest'
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
  await acceptProjectFiles({ projectDir: project, mrId: 'mr-cycle', files: ['note.txt'] })
  expect(readFileSync(live, 'utf8')).toBe('после мержа\n')
  const backup = path.join(project, 'backups', 'mr-cycle', 'note.txt')
  expect(readFileSync(backup).equals(original)).toBe(true)
  await restoreProjectFiles({ projectDir: project, mrId: 'mr-cycle', files: ['note.txt'] })
  expect(await sha256Of(live)).toBe(before)
  expect(createHash('sha256').update(original).digest('hex')).toBe(before)
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