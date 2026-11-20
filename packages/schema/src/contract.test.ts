/**
 * FILE: packages/schema/src/contract.test.ts
 * НАЗНАЧЕНИЕ: A5 и A6. Каждый файл demo/ валиден, на каждую схему есть 3 битых примера,
 * таблица мержа не пускает merged мимо delivered и не пускает смену SHA без причины.
 * Битые примеры живут только здесь: в demo/ им нельзя, иначе проверка «все файлы demo валидны» ломается.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { expect, test } from 'vitest'
import { z, type ZodType } from 'zod'
import { idSchema } from './common.js'
import { renderJsonSchemas } from './emit.js'
import {
  HEAD_SHA_CHANGE,
  MERGE_STATES,
  MERGE_TRANSITIONS,
  canTransition,
  configSchema,
  decisionSchema,
  feedbackSchema,
  mergeRequestSchema,
  queueSchema,
  statusSchema,
  syncManifestSchema,
  taskSchema,
  usageSchema,
} from './index.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const botRosterSchema = z.array(z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  role: z.string().min(1),
  grok_id: z.string().min(1),
}))

function filesUnder(dir: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      found.push(...filesUnder(full))
    } else {
      found.push(full)
    }
  }
  return found
}

function readData(file: string): unknown {
  const text = readFileSync(file, 'utf8')
  return file.endsWith('.json') ? JSON.parse(text) as unknown : parse(text)
}

function schemaFor(rel: string): ZodType | 'skip' {
  if (rel === 'README.md' || rel.endsWith('/README.md')) {
    return 'skip'
  }
  if (rel === 'bots.json') {
    return botRosterSchema
  }
  // Наборы пульта лежат рядом с примерами контракта и проходят те же схемы.
  const setTask = /^sets\/[^/]+\/data\/tasks\//.test(rel)
  const setStatus = /^sets\/[^/]+\/data\/status\//.test(rel)
  const setSync = /^sets\/[^/]+\/data\/sync\//.test(rel)
  const setConfig = /^sets\/[^/]+\/config\.yaml$/.test(rel)
  if (rel.startsWith('data/tasks/') || setTask) {
    return taskSchema
  }
  if (rel.startsWith('data/status/') || setStatus) {
    return statusSchema
  }
  if (rel.startsWith('data/merge_requests/')) {
    return mergeRequestSchema
  }
  if (rel.startsWith('data/outbox/decisions/')) {
    return decisionSchema
  }
  if (rel.startsWith('data/outbox/queue/')) {
    return queueSchema
  }
  if (rel.startsWith('data/outbox/feedback/')) {
    return feedbackSchema
  }
  if (rel.startsWith('data/usage/')) {
    return usageSchema
  }
  if (rel.startsWith('data/sync/') || setSync) {
    return syncManifestSchema
  }
  if (rel.startsWith('data/config/') || setConfig) {
    return configSchema
  }
  throw new Error(`нет схемы для demo/${rel}`)
}

function copy(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function firstOf(relPrefix: string): Record<string, unknown> {
  const demo = path.join(repoRoot, 'demo')
  const file = filesUnder(demo)
    .map((full) => path.relative(demo, full).split(path.sep).join('/'))
    .filter((rel) => rel.startsWith(relPrefix))
    .sort()[0]
  if (!file) {
    throw new Error(`нет примера ${relPrefix}`)
  }
  return copy(readData(path.join(demo, file)))
}

test('каждый файл demo/ проходит свою схему', () => {
  const demo = path.join(repoRoot, 'demo')
  const rels = filesUnder(demo).map((full) => path.relative(demo, full).split(path.sep).join('/'))
  expect(rels.length).toBeGreaterThan(0)
  const groups = new Map<string, number>()
  for (const rel of rels) {
    const schema = schemaFor(rel)
    if (schema === 'skip') {
      continue
    }
    const parsed = schema.safeParse(readData(path.join(demo, rel)))
    expect(parsed.success, rel).toBe(true)
    const group = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : rel
    groups.set(group, (groups.get(group) ?? 0) + 1)
  }
  for (const folder of [
    'data/tasks',
    'data/status',
    'data/merge_requests',
    'data/outbox/decisions',
    'data/outbox/queue',
    'data/outbox/feedback',
    'data/usage',
    'data/sync',
    'data/config',
  ]) {
    expect(groups.get(folder), folder).toBe(3)
  }
})

test('config.example.yaml проходит схему', () => {
  const raw = readData(path.join(repoRoot, 'config.example.yaml'))
  expect(configSchema.safeParse(raw).success).toBe(true)
})

test('data_dir не указывает на git, package.json и устройства Windows', () => {
  const config = copy(readData(path.join(repoRoot, 'config.example.yaml')))
  const blocked = [
    '.git',
    '.GIT',
    'package.json',
    'Package.JSON',
    'CON',
    'nul',
    'PRN.txt',
    'aux.yaml',
    'COM1',
    'com9.json',
    'LPT1',
    'lpt9.txt',
    'CON.',
    'data/.git',
    'data/Package.JSON',
    'notes/NUL',
    'foo/COM1.txt',
  ]
  for (const dataDir of blocked) {
    expect(configSchema.safeParse({ ...config, data_dir: dataDir }).success, dataDir).toBe(false)
  }
  for (const dataDir of ['data', './data', 'data/notes', 'company', 'config', 'COM10', 'comet']) {
    expect(configSchema.safeParse({ ...config, data_dir: dataDir }).success, dataDir).toBe(true)
  }
})

test('data_dir режет управляющие символы, служебные каталоги и хвостовые точки', () => {
  const config = copy(readData(path.join(repoRoot, 'config.example.yaml')))
  const blocked = [
    'data\u0000',
    'notes/\u0007hidden',
    'node_modules',
    'Node_Modules',
    'node_modules.',
    'node_modules ',
    'foo/node_modules/bar',
    '.github',
    '.GITHUB.',
    'scripts',
    ' scripts ',
    'Scripts.',
  ]
  for (const dataDir of blocked) {
    expect(configSchema.safeParse({ ...config, data_dir: dataDir }).success, dataDir).toBe(false)
  }
  // Хвост срезается: data. и data с пробелом остаются каталогом data, не служебным именем.
  // notes... не сюда: в строке есть .., это выход наверх, его режет отдельное правило.
  for (const dataDir of ['data.', 'data ', 'notes.', 'my-scripts', 'script', 'github']) {
    expect(configSchema.safeParse({ ...config, data_dir: dataDir }).success, dataDir).toBe(true)
  }
})

test('папка проекта может лежать вне лаунчера', () => {
  const config = copy(readData(path.join(repoRoot, 'config.example.yaml')))
  const projects = config.projects as Array<{ source: { files?: { path: string } } }>
  const source = projects[0]?.source
  if (!source?.files) {
    throw new Error('в примере нет files.path')
  }
  source.files.path = '/var/demo-project'
  expect(configSchema.safeParse(config).success).toBe(true)
  source.files.path = 'C:/work/demo-project'
  expect(configSchema.safeParse(config).success).toBe(true)
  source.files.path = '../outside/demo-project'
  expect(configSchema.safeParse(config).success).toBe(true)
  source.files.path = 'proj\u0000ect'
  expect(configSchema.safeParse(config).success).toBe(false)
})

test('по три битых примера на каждую схему', () => {
  const cases: Array<{ name: string; schema: ZodType; value: unknown }> = []

  const task = firstOf('data/tasks/')
  cases.push(
    { name: 'task без версии', schema: taskSchema, value: { ...task, schema_version: undefined } },
    { name: 'task без зоны', schema: taskSchema, value: { ...task, updated_at: '2026-11-19T09:15:00' } },
    { name: 'task путь наружу', schema: taskSchema, value: { ...task, inputs: [{ kind: 'path', value: '../out' }] } },
  )

  const status = firstOf('data/status/')
  cases.push(
    { name: 'status чужое состояние', schema: statusSchema, value: { ...status, state: 'review' } },
    { name: 'status пустой риск', schema: statusSchema, value: { ...status, risks: '' } },
    { name: 'status лишний ключ', schema: statusSchema, value: { ...status, note: 'x' } },
  )

  const merge = firstOf('data/merge_requests/')
  cases.push(
    { name: 'merge неизвестное состояние', schema: mergeRequestSchema, value: { ...merge, state: 'open' } },
    { name: 'merge четыре строки', schema: mergeRequestSchema, value: { ...merge, summary: 'a\nb\nc\nd' } },
    { name: 'merge без sha', schema: mergeRequestSchema, value: { ...merge, head_sha: 'нет' } },
  )

  const decision = firstOf('data/outbox/decisions/')
  cases.push(
    { name: 'decision чужое действие', schema: decisionSchema, value: { ...decision, action: 'changes_requested' } },
    { name: 'decision пустой автор', schema: decisionSchema, value: { ...decision, by: '' } },
    { name: 'decision без времени', schema: decisionSchema, value: { ...decision, at: 'вчера' } },
  )

  const queue = firstOf('data/outbox/queue/')
  cases.push(
    { name: 'queue без id', schema: queueSchema, value: { ...queue, id: '' } },
    { name: 'queue статус мимо списка', schema: queueSchema, value: { ...queue, status: 'later' } },
    { name: 'queue лишний ключ', schema: queueSchema, value: { ...queue, extra: 1 } },
  )

  const feedback = firstOf('data/outbox/feedback/')
  cases.push(
    { name: 'feedback пустой текст', schema: feedbackSchema, value: { ...feedback, feedback: '' } },
    { name: 'feedback чат не id', schema: feedbackSchema, value: { ...feedback, sent_to_chats: ['Сборка'] } },
    { name: 'feedback без проекта', schema: feedbackSchema, value: { ...feedback, project: undefined } },
  )

  const usage = firstOf('data/usage/')
  cases.push(
    { name: 'usage неделя 54', schema: usageSchema, value: { ...usage, week: '2026-W54' } },
    { name: 'usage доля больше 1', schema: usageSchema, value: { ...usage, blocked_share: 1.2 } },
    { name: 'usage без базы', schema: usageSchema, value: { ...usage, baseline: 'yes' } },
  )

  const sync = firstOf('data/sync/')
  cases.push(
    { name: 'sync короткий хеш', schema: syncManifestSchema, value: { ...sync, entries: [{ path: 'a.txt', sha256: 'abc', updated_at: '2026-11-19T09:15:00Z' }] } },
    { name: 'sync не массив', schema: syncManifestSchema, value: { ...sync, entries: null } },
    { name: 'sync лишний ключ', schema: syncManifestSchema, value: { ...sync, note: 'x' } },
  )

  const config = copy(readData(path.join(repoRoot, 'config.example.yaml')))
  cases.push(
    { name: 'config без версии', schema: configSchema, value: { ...config, schema_version: 2 } },
    { name: 'config абсолютный data_dir', schema: configSchema, value: { ...config, data_dir: '/var/demo' } },
    { name: 'config выключатель rules', schema: configSchema, value: { ...config, rules: { base: true } } },
  )

  expect(cases).toHaveLength(27)
  for (const item of cases) {
    expect(item.schema.safeParse(item.value).success, item.name).toBe(false)
  }
})

test('таблица переходов: merged только через delivered, SHA только из approved', () => {
  for (const from of MERGE_STATES) {
    for (const to of MERGE_STATES) {
      const allowed = (MERGE_TRANSITIONS[from] as readonly string[]).includes(to)
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(allowed)
    }
  }

  expect(MERGE_TRANSITIONS.approved).not.toContain(HEAD_SHA_CHANGE.to)
  expect(canTransition('approved', 'awaiting_owner')).toBe(false)
  expect(canTransition('approved', 'awaiting_owner', 'head_sha_changed')).toBe(true)
  expect(canTransition('delivered', 'awaiting_owner', 'head_sha_changed')).toBe(false)
  expect(canTransition('merging', 'awaiting_owner', 'head_sha_changed')).toBe(false)

  const predecessors = (state: string) => MERGE_STATES.filter((from) =>
    (MERGE_TRANSITIONS[from] as readonly string[]).includes(state))
  expect(predecessors('merged')).toEqual(['merging'])
  expect(predecessors('merging')).toEqual(['delivered'])

  // Любой путь до merged упирается в delivered: иного входа в merging нет.
  expect(predecessors('delivered')).toEqual(['approved'])
  expect(canTransition('draft', 'merged')).toBe(false)
  expect(canTransition('approved', 'merged')).toBe(false)
  expect(canTransition('nope', 'draft')).toBe(false)
})

test('закоммиченная JSON Schema совпадает со свежей генерацией', () => {
  const dir = path.join(repoRoot, 'packages', 'schema', 'json')
  const rendered = renderJsonSchemas()
  const onDisk = new Set(readdirSync(dir))
  expect([...rendered.keys()].sort()).toEqual([...onDisk].sort())
  for (const [file, text] of rendered) {
    expect(readFileSync(path.join(dir, file), 'utf8')).toBe(text)
  }
})
