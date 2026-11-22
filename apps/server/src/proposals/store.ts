/**
 * FILE: apps/server/src/proposals/store.ts
 * НАЗНАЧЕНИЕ: proposals/ только в data_dir. Папка проекта здесь не открывается.
 * ВХОД: каталог данных и id. Запись через writeAtomic.
 * ВЫХОД: разобранные предложения. Чистка по сроку снимает только отклонённые и ни разу не применённые.
 * Снимок применённого (applied, reverted) не удаляется ни по сроку, ни по числу.
 * sweepIncomplete на старте снимает только .<id>.partial и каталог без json и без backup/.
 * Если сам proposals — ссылка или junction, уборка не начинается.
 * Общий объём больше 256 МиБ — новое предложение не пишется.
 */

import { createHash, randomBytes } from 'node:crypto'
import { lstat, readdir, realpath, rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import { proposalSchema, type Proposal, type ProposalState } from '@tinybots/schema'
import { readdirSync, readFileSync } from 'node:fs'
import { logSafe } from '../redact.js'
import { writeAtomic } from '../store/atomic.js'
import { CLOSED_KEEP_MAX, CLOSED_KEEP_MS, OPEN_PROPOSALS_MAX, PROPOSALS_BYTES_MAX, PROPOSALS_BYTES_WARN } from '../tools/limits.js'

const CLOSED = new Set<ProposalState>(['rejected', 'reverted', 'conflict'])

export function sha256Buffer(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function newProposalId(): string {
  return `p${randomBytes(8).toString('hex')}`
}

export function proposalFile(dataDir: string, id: string): string {
  return path.join(dataDir, 'proposals', `${id}.json`)
}

export function proposalDir(dataDir: string, id: string): string {
  return path.join(dataDir, 'proposals', id)
}

let chain: Promise<void> = Promise.resolve()

/** Второй apply ждёт первый: иначе два ответа 200 на одно предложение. */
export function withProposalQueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job)
  chain = run.then(() => undefined, () => undefined)
  return run
}

export function readProposal(dataDir: string, id: string): Proposal | null {
  try {
    const parsed = proposalSchema.safeParse(JSON.parse(readFileSync(proposalFile(dataDir, id), 'utf8')) as unknown)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function writeProposal(dataDir: string, proposal: Proposal): Promise<void> {
  const parsed = proposalSchema.parse(proposal)
  await writeAtomic(proposalFile(dataDir, parsed.id), `${JSON.stringify(parsed, null, 2)}\n`)
}

export function listProposals(dataDir: string): Proposal[] {
  const dir = path.join(dataDir, 'proposals')
  let names: string[]
  try {
    names = readdirSyncSafe(dir)
  } catch {
    return []
  }
  const out: Proposal[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) {
      continue
    }
    const item = readProposal(dataDir, name.slice(0, -5))
    if (item) {
      out.push(item)
    }
  }
  return out
}

function readdirSyncSafe(dir: string): string[] {
  return readdirSync(dir)
}

export function isOpenState(state: ProposalState): boolean {
  return !CLOSED.has(state)
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return 0
  }
  for (const name of names) {
    const abs = path.join(dir, name)
    let st: Awaited<ReturnType<typeof lstat>>
    try {
      st = await lstat(abs)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) {
      continue
    }
    if (st.isDirectory()) {
      total += await dirBytes(abs)
      continue
    }
    if (st.isFile()) {
      total += Number(st.size)
    }
  }
  return total
}

export async function proposalsBytes(dataDir: string): Promise<number> {
  return dirBytes(path.join(dataDir, 'proposals'))
}

/** Временный каталог записи: proposals/.<id>.partial. Файл с таким именем не трогаем. */
function isPartialDirName(name: string): boolean {
  return name.startsWith('.') && name.endsWith('.partial')
}

/** Прямой ребёнок proposals/. Имя .. и абсолютный путь сюда не проходят. */
function isDirectChild(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel.length > 0 && rel === path.basename(rel) && rel !== '.' && rel !== '..'
}

/**
 * Корень уборки — только настоящий каталог data_dir/proposals.
 * Ссылка и junction (в том числе на другой диск) не читаются: readdir пошёл бы в цель
 * и снял бы там чужие папки без json. Путь в журнал не пишем.
 */
async function proposalsSweepRoot(dataDir: string): Promise<string | null> {
  const root = path.join(dataDir, 'proposals')
  let st: Awaited<ReturnType<typeof lstat>>
  try {
    st = await lstat(root)
  } catch {
    return null
  }
  if (st.isSymbolicLink() || !st.isDirectory()) {
    logSafe('proposals: уборка пропущена, это не обычный каталог')
    return null
  }
  let rootReal = ''
  let dataReal = ''
  try {
    rootReal = await realpath(root)
    dataReal = await realpath(dataDir)
  } catch {
    logSafe('proposals: уборка пропущена, каталог не читается')
    return null
  }
  if (rootReal !== path.join(dataReal, 'proposals')) {
    logSafe('proposals: уборка пропущена, каталог уходит по ссылке')
    return null
  }
  return root
}

/** Снимок I19. Имя backup не открываем: ссылку тоже считаем причиной не трогать родителя. */
async function hasBackup(dir: string): Promise<boolean> {
  try {
    const st = await lstat(path.join(dir, 'backup'))
    return st.isSymbolicLink() || st.isDirectory()
  } catch {
    return false
  }
}

/**
 * Недописанное после kill: каталог .<id>.partial или каталог без соседнего <id>.json.
 * Только прямые дети настоящего data_dir/proposals. lstat не идёт по ссылке.
 * Саму ссылку снимаем через unlink. Каталог — rm, он тоже не следует по ссылкам внутри.
 * Файл, json и каталог с backup/ остаются. Папка проекта сюда не передаётся.
 */
export async function sweepIncomplete(dataDir: string): Promise<void> {
  const root = await proposalsSweepRoot(dataDir)
  if (!root) {
    return
  }
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return
  }
  for (const name of names) {
    if (name === '.' || name === '..' || name !== path.basename(name)) {
      continue
    }
    const abs = path.join(root, name)
    if (!isDirectChild(root, abs)) {
      continue
    }
    let st: Awaited<ReturnType<typeof lstat>>
    try {
      st = await lstat(abs)
    } catch {
      continue
    }
    // Обычный файл, в том числе хвост .tmp, не каталог: эта уборка его не снимает.
    if (!st.isSymbolicLink() && !st.isDirectory()) {
      continue
    }
    const partial = isPartialDirName(name)
    if (!partial) {
      try {
        await lstat(path.join(root, `${name}.json`))
        continue
      } catch {
        // соседнего json нет — каталог оборвался между rename и записью json
      }
    }
    // I19: снимок backup/ не стираем, даже если json уже нет.
    if (!st.isSymbolicLink() && st.isDirectory() && await hasBackup(abs)) {
      continue
    }
    await removeIncomplete(abs)
  }
}

/** Повторный lstat: между проверкой имя могли заменить ссылкой. Ссылку не открываем. */
async function removeIncomplete(abs: string): Promise<void> {
  let st: Awaited<ReturnType<typeof lstat>>
  try {
    st = await lstat(abs)
  } catch {
    return
  }
  try {
    if (st.isSymbolicLink()) {
      await unlink(abs)
      return
    }
    if (st.isDirectory()) {
      if (await hasBackup(abs)) {
        return
      }
      await rm(abs, { recursive: true, force: true })
    }
  } catch {
    // старт пульта важнее мусора: битый каталог не роняет процесс
  }
}

function lastAt(item: Proposal): number {
  const stamp = item.history[item.history.length - 1]?.at
  const parsed = stamp ? Date.parse(stamp) : 0
  return Number.isNaN(parsed) ? 0 : parsed
}

/** Применённое предложение и его снимок чистке не подлежат, даже после отката. */
function keepsSnapshot(item: Proposal): boolean {
  if (item.state === 'applied' || item.state === 'reverted' || item.state === 'reverting' || item.state === 'revert_conflict') {
    return true
  }
  return item.history.some((row) => row.state === 'applied' || row.state === 'reverted' || row.state === 'revert_conflict')
}

/** Удаляет отклонённые и неприменённые старше 30 дней и лишние сверх 100. Снимок применённого не трогает. */
export async function sweepClosed(dataDir: string, project: string, now: Date): Promise<void> {
  const closed = listProposals(dataDir)
    .filter((item) => item.project === project && CLOSED.has(item.state) && !keepsSnapshot(item))
    .sort((a, b) => lastAt(a) - lastAt(b))
  const doomed = new Set<string>()
  for (const item of closed) {
    if (now.getTime() - lastAt(item) > CLOSED_KEEP_MS) {
      doomed.add(item.id)
    }
  }
  const alive = closed.filter((item) => !doomed.has(item.id))
  if (alive.length > CLOSED_KEEP_MAX) {
    const extra = alive.length - CLOSED_KEEP_MAX
    for (const item of alive.slice(0, extra)) {
      doomed.add(item.id)
    }
  }
  for (const id of doomed) {
    await rm(proposalFile(dataDir, id), { force: true })
    await rm(proposalDir(dataDir, id), { recursive: true, force: true })
  }
}

export function openCount(dataDir: string, project: string): number {
  return listProposals(dataDir).filter((item) => item.project === project && isOpenState(item.state)).length
}

export async function roomFor(dataDir: string, project: string, adding: number): Promise<string | null> {
  if (openCount(dataDir, project) >= OPEN_PROPOSALS_MAX) {
    return 'уже 20 открытых предложений'
  }
  const used = await proposalsBytes(dataDir)
  if (used + adding > PROPOSALS_BYTES_MAX) {
    return 'каталог предложений больше 256 МиБ. Снимки применённых правок сервер не удаляет: уберите старые папки proposals вручную.'
  }
  return null
}

/** Текст владельцу, когда каталог уже близко к потолку. Предложение при этом ещё принимается. */
export async function storageWarning(dataDir: string): Promise<string | null> {
  const used = await proposalsBytes(dataDir)
  if (used >= PROPOSALS_BYTES_WARN) {
    return 'Каталог предложений занял больше 80% из 256 МиБ. Снимки применённых правок не удаляются сами: уберите ненужные папки proposals вручную, иначе новые предложения не сохранятся.'
  }
  return null
}

export const OWNER_TEXT: Record<string, string> = {
  conflict: 'файл изменился после предложения, ничего не записано',
  dirty: 'в затронутых файлах есть незакоммиченные правки',
  detached_head: 'HEAD не на ветке',
  unsupported_entry: 'симлинк или подмодуль в git не правится',
  unsupported_filter: 'у файла git-фильтр или особый eol, правьте вручную',
  branch_exists: 'ветка с таким именем уже есть',
  revert_conflict: 'ветку уже меняли, удалять её нельзя',
  invalid_state: 'предложение уже в другом состоянии',
  owner: 'репозиторий принадлежит другому пользователю',
  partial: 'частичный клон не поддерживается',
  missing_git: 'git не найден или старше 2.45.1',
  crash_recovered: 'файл изменился после предложения, ничего не записано',
}
