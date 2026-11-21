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

import { lstat, mkdir, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { isMergeFilePath } from '@tinybots/schema'
import { assertPathNotSymlink, readNoFollow } from '../store/nofollow.js'
import { writeAtomic } from '../store/atomic.js'
import { createHash } from 'node:crypto'

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Имитация kill: откат в памяти не делается, recover дочитывает снимок. */
export class ApplyKilled extends Error {
  constructor() {
    super('killed')
    this.name = 'ApplyKilled'
  }
}

export async function sha256Of(file: string): Promise<string> {
  const data = await readNoFollow(file)
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
  mode?: number
}

/** Путь внутри отдельного корня снимка или staging. Хвост проходит isMergeFilePath. */
async function underRoot(root: string, rel: string): Promise<string | null> {
  if (rel !== '.manifest.json' && !isMergeFilePath(rel)) {
    return null
  }
  let base: string
  try {
    const st = await lstat(root)
    if (st.isSymbolicLink() || !st.isDirectory()) {
      return null
    }
    base = await realpath(root)
  } catch {
    return null
  }
  const parts = rel.split('/')
  let current = base
  let index = 0
  for (; index < parts.length; index += 1) {
    const next = path.join(current, parts[index] ?? '')
    try {
      const st = await lstat(next)
      if (st.isSymbolicLink()) {
        return null
      }
      if (index < parts.length - 1 && !st.isDirectory()) {
        return null
      }
      current = next
    } catch (error) {
      if (isEnoent(error)) {
        break
      }
      return null
    }
  }
  let real: string
  try {
    real = await realpath(index === 0 ? base : current)
  } catch {
    return null
  }
  if (!staysIn(base, real)) {
    return null
  }
  const rest = parts.slice(index)
  const finalPath = rest.length === 0 ? real : path.resolve(real, ...rest)
  if (!staysIn(base, finalPath)) {
    return null
  }
  return finalPath
}

async function rollback(done: readonly Plan[]): Promise<void> {
  for (const plan of [...done].reverse()) {
    if (plan.created) {
      // Файла до применения не было. Снимок backup/ не удаляем: его у созданного файла нет.
      await rm(plan.live, { force: true })
      continue
    }
    await assertPathNotSymlink(plan.backup)
    const bytes = await readNoFollow(plan.backup)
    await assertPathNotSymlink(plan.live)
    await writeAtomic(plan.live, bytes, {
      beforeCommit: () => assertPathNotSymlink(plan.live),
      mode: plan.mode,
    })
  }
}

export async function acceptProjectFiles(input: {
  projectDir: string
  mrId: string
  files: readonly string[]
  /** Крюк теста: бросить после успешной замены файла с этим индексом. */
  afterCopy?: (index: number) => void
  /** Крюк теста: бросить после манифеста и до первого копирования. */
  beforeCopy?: () => void | Promise<void>
  /** Крюк теста: подменить путь сразу перед записью этого файла. */
  beforeWrite?: (rel: string) => void
  /** Повторная проверка прямо перед rename. Предложение сверяет sha256 ещё раз. */
  beforeCommit?: (rel: string) => Promise<void> | void
  /** Корень новых байтов. Без него — staging/ внутри папки проекта, как у мержа. */
  stagingRoot?: string
  /** Корень снимка. Без него — backups/<id>/ внутри папки проекта. */
  backupRoot?: string
  /** Сохранить режим исходника. По умолчанию выключено, чтобы C9 не менял права. */
  preserveMode?: boolean
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
    const staging = input.stagingRoot
      ? await underRoot(input.stagingRoot, rel)
      : await locate(rootReal, `staging/${rel}`, true)
    const backup = input.backupRoot
      ? await underRoot(input.backupRoot, rel)
      : await locate(rootReal, `backups/${input.mrId}/${rel}`, true)
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
    let mode: number | undefined
    try {
      const liveStat = await lstat(live)
      if (liveStat.isSymbolicLink() || !liveStat.isFile()) {
        throw new Error('путь файла')
      }
      created = false
      mode = liveStat.mode & 0o777
      if (input.preserveMode && process.platform === 'win32' && (liveStat.mode & 0o200) === 0) {
        throw new Error('readonly')
      }
    } catch (error) {
      if (error instanceof Error && (error.message === 'путь файла' || error.message === 'readonly')) {
        throw error
      }
      if (!isEnoent(error)) {
        throw error
      }
    }
    plans.push({ rel, live, staging, backup, created, mode })
  }
  const manifest = input.backupRoot
    ? await underRoot(input.backupRoot, '.manifest.json')
    : await locate(rootReal, `backups/${input.mrId}.manifest.json`, true)
  let backupDir: string
  try {
    backupDir = input.backupRoot ? await realpath(input.backupRoot) : path.join(rootReal, 'backups', input.mrId)
  } catch {
    throw new Error('путь файла')
  }
  if (!manifest) {
    throw new Error('путь файла')
  }
  if (input.backupRoot) {
    const backupBase = await realpath(input.backupRoot)
    if (!staysIn(backupBase, backupDir)) {
      throw new Error('путь файла')
    }
  } else if (!staysIn(rootReal, backupDir)) {
    throw new Error('путь файла')
  }
  // Манифест до цикла: kill посреди копирования всё ещё знает, какие файлы были новыми.
  await mkdir(path.dirname(manifest), { recursive: true })
  await assertPathNotSymlink(manifest)
  const createdList = plans.filter((plan) => plan.created).map((plan) => plan.rel)
  const body = input.preserveMode
    ? `${JSON.stringify({
      created: createdList,
      modes: Object.fromEntries(plans.filter((plan) => plan.mode !== undefined).map((plan) => [plan.rel, plan.mode])),
    }, null, 2)}\n`
    : `${JSON.stringify({ created: createdList }, null, 2)}\n`
  await writeAtomic(manifest, body, { beforeCommit: () => assertPathNotSymlink(manifest) })
  const done: Plan[] = []
  try {
    for (const plan of plans) {
      await mkdir(path.dirname(plan.backup), { recursive: true })
      await assertPathNotSymlink(plan.live)
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
          await assertPathNotSymlink(plan.live)
          await writeAtomic(plan.backup, await readNoFollow(plan.live), {
            beforeCommit: () => assertPathNotSymlink(plan.backup),
          })
        }
      }
    }
    await input.beforeCopy?.()
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index]
      if (!plan) {
        throw new Error('путь файла')
      }
      input.beforeWrite?.(plan.rel)
      await assertPathNotSymlink(plan.staging)
      await mkdir(path.dirname(plan.live), { recursive: true })
      await assertPathNotSymlink(plan.live)
      await assertPathNotSymlink(plan.staging)
      await writeAtomic(plan.live, await readNoFollow(plan.staging), {
        beforeCommit: async () => {
          await assertPathNotSymlink(plan.live)
          await input.beforeCommit?.(plan.rel)
        },
        mode: input.preserveMode && plan.mode !== undefined ? plan.mode : undefined,
      })
      done.push(plan)
      input.afterCopy?.(index)
    }
  } catch (error) {
    if (error instanceof ApplyKilled) {
      throw error
    }
    try {
      await rollback(done)
      // beforeWrite мог испортить ещё не заменённый файл. Снимок уже лежит в backup/.
      const pending = plans.filter((plan) => !done.includes(plan) && !plan.created)
      for (const plan of pending) {
        try {
          await lstat(plan.backup)
        } catch {
          continue
        }
        await assertPathNotSymlink(plan.backup)
        const bytes = await readNoFollow(plan.backup)
        await assertPathNotSymlink(plan.live)
        await writeAtomic(plan.live, bytes, {
          beforeCommit: () => assertPathNotSymlink(plan.live),
          mode: plan.mode,
        })
      }
    } catch (rollbackError) {
      const why = rollbackError instanceof Error ? rollbackError.message : 'сбой отката'
      throw new Error(`сбой отката: ${why}`)
    }
    throw error
  }
  return { backupDir }
}

export async function restoreProjectFiles(input: {
  projectDir: string
  mrId: string
  files: readonly string[]
  backupRoot?: string
  preserveMode?: boolean
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
  const manifestPath = input.backupRoot
    ? await underRoot(input.backupRoot, '.manifest.json')
    : await locate(rootReal, `backups/${input.mrId}.manifest.json`, true)
  if (!manifestPath) {
    throw new Error('путь файла')
  }
  const manifest = await readManifest(manifestPath)
  const plans: Array<{ rel: string; live: string; backup: string | null; created: boolean; mode?: number }> = []
  for (const rel of input.files) {
    const live = await locate(rootReal, rel)
    if (!live) {
      throw new Error('путь файла')
    }
    if (manifest.created.has(rel)) {
      plans.push({ rel, live, backup: null, created: true })
      continue
    }
    const backup = input.backupRoot
      ? await underRoot(input.backupRoot, rel)
      : await locate(rootReal, `backups/${input.mrId}/${rel}`, true)
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
    plans.push({ rel, live, backup, created: false, mode: manifest.modes[rel] })
  }
  for (const plan of plans) {
    if (plan.created) {
      // Живой файл бот сам и добавил. Каталог снимка не трогаем.
      await rm(plan.live, { force: true })
      continue
    }
    if (!plan.backup) {
      throw new Error('нет снимка')
    }
    await mkdir(path.dirname(plan.live), { recursive: true })
    await assertPathNotSymlink(plan.backup)
    await writeAtomic(plan.live, await readNoFollow(plan.backup), {
      beforeCommit: () => assertPathNotSymlink(plan.live),
      mode: input.preserveMode && plan.mode !== undefined ? plan.mode : undefined,
    })
  }
}

async function readManifest(file: string): Promise<{ created: Set<string>; modes: Record<string, number> }> {
  let raw: string
  try {
    const st = await lstat(file)
    if (st.isSymbolicLink()) {
      throw new Error('путь файла')
    }
    raw = (await readNoFollow(file)).toString('utf8')
  } catch (error) {
    if (isEnoent(error)) {
      return { created: new Set(), modes: {} }
    }
    throw error
  }
  const parsed = JSON.parse(raw) as { created?: unknown; modes?: unknown }
  const created = new Set(Array.isArray(parsed.created) ? parsed.created.filter((item): item is string => typeof item === 'string') : [])
  const modes: Record<string, number> = {}
  if (parsed.modes && typeof parsed.modes === 'object') {
    for (const [key, value] of Object.entries(parsed.modes)) {
      if (typeof value === 'number') {
        modes[key] = value
      }
    }
  }
  return { created, modes }
}
