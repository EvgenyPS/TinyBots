/**
 * FILE: apps/server/src/merge/files-apply.ts
 * НАЗНАЧЕНИЕ: мерж и откат в режиме files.
 * ВХОД: папка проекта, id запроса и относительные пути.
 * ВЫХОД: снимок backups/<mr-id>/ до замены. Откат возвращает снимок или удаляет файл,
 * которого до мержа не было. Список таких файлов лежит в backups/<mr-id>.manifest.json.
 * Путь сверяем realpath ближайшего существующего предка. Симлинк на любом шаге — отказ,
 * иначе запись и снимок уехали бы наружу. На диск пишем через временный файл и rename.
 * Сначала проверяем все пути. Обрыв посреди копирования откатывает уже заменённые файлы.
 */

import { lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { isMergeFilePath } from '@tinybots/schema'
import { writeAtomic } from '../store/atomic.js'
import { createHash } from 'node:crypto'

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

export async function sha256Of(file: string): Promise<string> {
  const data = await readFile(file)
  return createHash('sha256').update(data).digest('hex')
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')
}

function staysIn(rootReal: string, candidate: string): boolean {
  const rel = path.relative(rootReal, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * staging/<файл> и backups/<id>/<файл> собираем сами.
 * В списке запроса эти корни запрещены, здесь они служебные.
 * Хвост всё равно проходит isMergeFilePath: чужой id и .git не пролезают.
 */
function isServicePath(rel: string): boolean {
  const staging = /^staging\/(.+)$/.exec(rel)
  if (staging?.[1]) {
    return isMergeFilePath(staging[1])
  }
  if (/^backups\/[a-z0-9][a-z0-9-]{0,63}\.manifest\.json$/.test(rel)) {
    return true
  }
  const backup = /^backups\/[a-z0-9][a-z0-9-]{0,63}\/(.+)$/.exec(rel)
  if (backup?.[1]) {
    return isMergeFilePath(backup[1])
  }
  return false
}

/** Ближайший существующий предок по realpath. Симлинк на этом пути — null, не цель записи. */
async function locate(rootReal: string, rel: string, service = false): Promise<string | null> {
  if (service ? !isServicePath(rel) : !isMergeFilePath(rel)) {
    return null
  }
  const parts = rel.split('/')
  let current = rootReal
  let index = 0
  try {
    for (; index < parts.length; index += 1) {
      const next = path.join(current, parts[index] ?? '')
      let st: Awaited<ReturnType<typeof lstat>>
      try {
        st = await lstat(next)
      } catch (error) {
        if (isEnoent(error)) {
          break
        }
        return null
      }
      if (st.isSymbolicLink()) {
        return null
      }
      if (index < parts.length - 1 && !st.isDirectory()) {
        return null
      }
      current = next
    }
    const real = await realpath(current)
    if (!staysIn(rootReal, real)) {
      return null
    }
    const rest = parts.slice(index)
    const final = rest.length === 0 ? real : path.resolve(real, ...rest)
    if (!staysIn(rootReal, final)) {
      return null
    }
    return final
  } catch {
    return null
  }
}

type Plan = {
  rel: string
  live: string
  staging: string
  backup: string
  created: boolean
}

async function readCreated(rootReal: string, mrId: string): Promise<Set<string>> {
  const file = await locate(rootReal, `backups/${mrId}.manifest.json`, true)
  if (!file) {
    throw new Error('путь файла')
  }
  let raw: string
  try {
    const st = await lstat(file)
    if (st.isSymbolicLink()) {
      throw new Error('путь файла')
    }
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (isEnoent(error)) {
      return new Set()
    }
    throw error
  }
  const parsed = JSON.parse(raw) as { created?: unknown }
  if (!Array.isArray(parsed.created)) {
    return new Set()
  }
  return new Set(parsed.created.filter((item): item is string => typeof item === 'string'))
}

async function rollback(done: readonly Plan[]): Promise<void> {
  for (const plan of [...done].reverse()) {
    if (plan.created) {
      await rm(plan.live, { force: true })
      continue
    }
    const bytes = await readFile(plan.backup)
    await writeAtomic(plan.live, bytes)
  }
}

export async function acceptProjectFiles(input: {
  projectDir: string
  mrId: string
  files: readonly string[]
  /** Крюк теста: бросить после успешной замены файла с этим индексом. */
  afterCopy?: (index: number) => void
}): Promise<{ backupDir: string }> {
  if (!SLUG.test(input.mrId)) {
    throw new Error('id снимка')
  }
  let rootReal: string
  try {
    rootReal = await realpath(input.projectDir)
  } catch {
    throw new Error('путь файла')
  }
  const plans: Plan[] = []
  for (const rel of input.files) {
    const live = await locate(rootReal, rel)
    const staging = await locate(rootReal, `staging/${rel}`, true)
    const backup = await locate(rootReal, `backups/${input.mrId}/${rel}`, true)
    if (!live || !staging || !backup) {
      throw new Error('путь файла')
    }
    let stagingStat: Awaited<ReturnType<typeof lstat>>
    try {
      stagingStat = await lstat(staging)
    } catch {
      throw new Error('нет файла в staging')
    }
    if (stagingStat.isSymbolicLink() || !stagingStat.isFile()) {
      throw new Error('путь файла')
    }
    let created = true
    try {
      const liveStat = await lstat(live)
      if (liveStat.isSymbolicLink() || !liveStat.isFile()) {
        throw new Error('путь файла')
      }
      created = false
    } catch (error) {
      if (!isEnoent(error)) {
        throw error
      }
    }
    plans.push({ rel, live, staging, backup, created })
  }
  const manifest = await locate(rootReal, `backups/${input.mrId}.manifest.json`, true)
  const backupDir = path.join(rootReal, 'backups', input.mrId)
  if (!manifest || !staysIn(rootReal, backupDir)) {
    throw new Error('путь файла')
  }
  const done: Plan[] = []
  try {
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index]
      if (!plan) {
        throw new Error('путь файла')
      }
      await mkdir(path.dirname(plan.backup), { recursive: true })
      // Первый снимок не затираем: повторный перенос не должен подменить исходные байты.
      if (!plan.created) {
        let backupExists = true
        try {
          const backupStat = await lstat(plan.backup)
          if (backupStat.isSymbolicLink()) {
            throw new Error('путь файла')
          }
        } catch (error) {
          if (!isEnoent(error)) {
            throw error
          }
          backupExists = false
        }
        if (!backupExists) {
          await writeAtomic(plan.backup, await readFile(plan.live))
        }
      }
      await mkdir(path.dirname(plan.live), { recursive: true })
      await writeAtomic(plan.live, await readFile(plan.staging))
      done.push(plan)
      input.afterCopy?.(index)
    }
    await mkdir(path.dirname(manifest), { recursive: true })
    const body = `${JSON.stringify({ created: plans.filter((plan) => plan.created).map((plan) => plan.rel) }, null, 2)}\n`
    await writeAtomic(manifest, body)
  } catch (error) {
    await rollback(done)
    throw error
  }
  return { backupDir }
}

export async function restoreProjectFiles(input: {
  projectDir: string
  mrId: string
  files: readonly string[]
}): Promise<void> {
  if (!SLUG.test(input.mrId)) {
    throw new Error('id снимка')
  }
  let rootReal: string
  try {
    rootReal = await realpath(input.projectDir)
  } catch {
    throw new Error('путь файла')
  }
  const created = await readCreated(rootReal, input.mrId)
  const plans: Array<{ rel: string; live: string; backup: string | null; created: boolean }> = []
  for (const rel of input.files) {
    const live = await locate(rootReal, rel)
    if (!live) {
      throw new Error('путь файла')
    }
    if (created.has(rel)) {
      plans.push({ rel, live, backup: null, created: true })
      continue
    }
    const backup = await locate(rootReal, `backups/${input.mrId}/${rel}`, true)
    if (!backup) {
      throw new Error('путь файла')
    }
    try {
      const st = await lstat(backup)
      if (st.isSymbolicLink() || !st.isFile()) {
        throw new Error('нет снимка')
      }
    } catch (error) {
      if (isEnoent(error)) {
        throw new Error('нет снимка')
      }
      throw error
    }
    plans.push({ rel, live, backup, created: false })
  }
  for (const plan of plans) {
    if (plan.created) {
      await rm(plan.live, { force: true })
      continue
    }
    if (!plan.backup) {
      throw new Error('нет снимка')
    }
    await mkdir(path.dirname(plan.live), { recursive: true })
    await writeAtomic(plan.live, await readFile(plan.backup))
  }
}
