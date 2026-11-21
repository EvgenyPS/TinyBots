/**
 * FILE: apps/server/src/tools/sandbox.ts
 * НАЗНАЧЕНИЕ: пустить инструмент только к обычному файлу внутри папки проекта.
 * ВХОД: realpath корня, относительный запрос, флаги проекта и крюк теста.
 * ВЫХОД: абсолютный путь или отказ. Содержимое отказанной цели не читается.
 * Повторно используются requestAllowed, resolveInside не копируется вторым резолвером:
 * проверка строки — requestAllowed и isMergeFilePath, устройство — isReservedDeviceName.
 * Имя с диска берётся из readdir родителя по (dev, ino) на всех ОС.
 * На Windows перед обходом пробуем realpath: регистр и длинное имя без квадратичного lstat.
 * ino 0 не сопоставляем с чужой записью.
 * Между проверкой и open есть крюк: подмена каталога симлинком должна дать отказ.
 */

import path from 'node:path'
import { constants, lstat, open, opendir, readFile, realpath, type FileHandle } from 'node:fs/promises'
import { isMergeFilePath } from '@tinybots/schema'
import { requestAllowed, staysIn } from '../files/jail.js'
import { noFollowFlag } from '../store/nofollow.js'
import { compileGitignore, gitignoreDenies } from './gitignore.js'
import { LIST_DEPTH_MAX, PATH_MAX } from './limits.js'
import { pathDenied, segmentDenied } from './names.js'

type IgnoreRule = ReturnType<typeof compileGitignore>[number]

export type SandboxHooks = {
  /** Между проверкой пути и open. Тест подменяет каталог симлинком. */
  beforeOpen?: () => Promise<void> | void
}

export type SandboxContext = {
  rootReal: string
  dataReal: string | null
  launcherConfigReal: string | null
  respectGitignore: boolean
  gitignore: readonly IgnoreRule[]
  platform?: NodeJS.Platform
  /** Снимок ino на время одного поиска. На Windows nlink врёт, и без снимка каждый файл обходит всё дерево. */
  inodeCensus?: Map<string, number>
}

export type SandboxOk = {
  ok: true
  rel: string
  abs: string
  kind: 'file' | 'dir' | 'new'
}

export type SandboxNo = { ok: false; reason: string }

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')
}

function hasControl(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true
    }
  }
  return false
}

/** Пустая строка и точка — сам корень. Других сокращений нет. */
export function rootAlias(rel: string): boolean {
  return rel === '' || rel === '.'
}

/**
 * Отказ по строке, до диска. Проценты не декодируются.
 * Хвостовая точка и пробел отвергают сегмент целиком, а не срезаются.
 */
export function pathShapeReason(rel: string, platform: NodeJS.Platform, maxDepth = LIST_DEPTH_MAX): string | null {
  if (rootAlias(rel)) {
    return null
  }
  if (rel.length > PATH_MAX || hasControl(rel) || rel.includes('%')) {
    return 'путь'
  }
  if (rel.startsWith('./') || rel.endsWith('/') || rel.includes('//')) {
    return 'путь'
  }
  if (!requestAllowed(rel) || !isMergeFilePath(rel)) {
    return 'путь'
  }
  const parts = rel.split('/')
  if (parts.length > maxDepth) {
    return 'глубина'
  }
  for (const segment of parts) {
    if (segmentDenied(segment, platform) || pathDenied(segment, platform)) {
      return 'запрещено'
    }
  }
  if (pathDenied(rel, platform)) {
    return 'запрещено'
  }
  return null
}

/**
 * POSIX доверяет nlink: ссылка в другом каталоге тоже даёт nlink > 1.
 * На Windows nlink часто 1, поэтому тот же ino ищем по всему корню проекта, не только рядом с файлом.
 * ino 0 не считаем: на части томов он у всех файлов.
 */
async function hardLink(ctx: SandboxContext, nlink: bigint, dev: bigint, ino: bigint): Promise<boolean> {
  if (nlink > 1n) {
    return true
  }
  if (process.platform !== 'win32' || ino === 0n) {
    return false
  }
  const census = ctx.inodeCensus ?? await buildCensus(ctx.rootReal)
  return (census.get(inodeKey(dev, ino)) ?? 0) > 1
}

function inodeKey(dev: bigint, ino: bigint): string {
  return `${dev.toString(16)}:${ino.toString(16)}`
}

async function buildCensus(root: string): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) {
      break
    }
    let opened: Awaited<ReturnType<typeof opendir>>
    try {
      opened = await opendir(dir)
    } catch {
      continue
    }
    try {
      for await (const entry of opened) {
        let st: Awaited<ReturnType<typeof lstat>>
        try {
          st = await lstat(path.join(dir, entry.name), { bigint: true })
        } catch {
          continue
        }
        if (st.isSymbolicLink()) {
          continue
        }
        if (st.isDirectory()) {
          stack.push(path.join(dir, entry.name))
          continue
        }
        if (!st.isFile() || st.ino === 0n) {
          continue
        }
        const key = inodeKey(st.dev, st.ino)
        map.set(key, (map.get(key) ?? 0) + 1)
      }
    } finally {
      await opened.close().catch(() => undefined)
    }
  }
  return map
}

/** Один обход на поиск: иначе каждая из 2000 проверок снова идёт по всему дереву. */
export async function loadInodeCensus(ctx: SandboxContext): Promise<void> {
  if (process.platform !== 'win32') {
    return
  }
  ctx.inodeCensus = await buildCensus(ctx.rootReal)
}

export function clearInodeCensus(ctx: SandboxContext): void {
  ctx.inodeCensus = undefined
}

type DiskEntry = { name: string; dev: bigint; ino: bigint }

/**
 * Имя с диска по записям родителя. ino 0 не сопоставляем: иначе чужой файл с тем же нулём
 * станет «настоящим» именем и может закрыть или открыть не тот путь.
 */
export function spelledName(
  segment: string,
  st: { dev: bigint; ino: bigint },
  entries: readonly DiskEntry[],
  platform: NodeJS.Platform,
): string {
  const folded = segment.toLowerCase()
  for (const entry of entries) {
    if (entry.name === segment) {
      return entry.name
    }
    if (platform === 'win32' && entry.name.toLowerCase() === folded) {
      return entry.name
    }
    if (st.ino !== 0n && entry.dev === st.dev && entry.ino === st.ino) {
      return entry.name
    }
  }
  return segment
}

async function diskName(parent: string, segment: string): Promise<string | null> {
  const joined = path.join(parent, segment)
  let st: Awaited<ReturnType<typeof lstat>>
  try {
    st = await lstat(joined, { bigint: true })
  } catch (error) {
    if (isEnoent(error)) {
      return null
    }
    throw error
  }
  // На Windows realpath сразу отдаёт регистр и длинное имя. На остальных ОС имя берём из readdir.
  if (process.platform === 'win32') {
    const spelled = await windowsSpelling(parent, joined)
    if (spelled) {
      return spelled
    }
  }
  const names: string[] = []
  const dir = await opendir(parent)
  try {
    for await (const entry of dir) {
      if (entry.name === segment) {
        return entry.name
      }
      names.push(entry.name)
    }
  } finally {
    await dir.close().catch(() => undefined)
  }
  const entries: DiskEntry[] = []
  for (const name of names) {
    try {
      const ent = await lstat(path.join(parent, name), { bigint: true })
      entries.push({ name, dev: ent.dev, ino: ent.ino })
    } catch {
      // запись исчезла между чтением каталога и lstat
    }
  }
  return spelledName(segment, st, entries, process.platform)
}

/** Basename от realpath, только если файл остался в том же родителе. Иначе null — зовём обход. */
async function windowsSpelling(parent: string, joined: string): Promise<string | null> {
  try {
    const real = await realpath(joined)
    const parentReal = await realpath(parent)
    if (path.dirname(real).toLowerCase() !== parentReal.toLowerCase()) {
      return null
    }
    const base = path.basename(real)
    return base.length > 0 ? base : null
  } catch {
    return null
  }
}

function insideLauncher(abs: string, ctx: SandboxContext): boolean {
  if (ctx.dataReal && (abs === ctx.dataReal || staysIn(ctx.dataReal, abs))) {
    return true
  }
  if (ctx.launcherConfigReal && abs === ctx.launcherConfigReal) {
    return true
  }
  return false
}

async function walkExisting(ctx: SandboxContext, rel: string): Promise<SandboxOk | SandboxNo> {
  const platform = ctx.platform ?? process.platform
  const shape = pathShapeReason(rel, platform)
  if (shape) {
    return { ok: false, reason: shape }
  }
  if (rootAlias(rel)) {
    return { ok: true, rel: '', abs: ctx.rootReal, kind: 'dir' }
  }
  const parts = rel.split('/')
  let current = ctx.rootReal
  for (const segment of parts) {
    const next = path.join(current, segment)
    let st: Awaited<ReturnType<typeof lstat>>
    try {
      st = await lstat(next)
    } catch (error) {
      if (isEnoent(error)) {
        return { ok: false, reason: 'нет' }
      }
      return { ok: false, reason: 'путь' }
    }
    if (st.isSymbolicLink()) {
      return { ok: false, reason: 'ссылка' }
    }
    const shown = await diskName(current, segment)
    if (shown === null || segmentDenied(shown, platform) || pathDenied(shown, platform)) {
      return { ok: false, reason: 'запрещено' }
    }
    let real: string
    try {
      real = await realpath(next)
    } catch {
      return { ok: false, reason: 'путь' }
    }
    if (!staysIn(ctx.rootReal, real) || insideLauncher(real, ctx)) {
      return { ok: false, reason: 'вне' }
    }
    if (ctx.respectGitignore && gitignoreDenies(ctx.gitignore, rel)) {
      return { ok: false, reason: 'игнор' }
    }
    current = real
  }
  return { ok: true, rel, abs: current, kind: 'file' }
}

/** Существующий файл или каталог. Для нового файла последний сегмент ещё не на диске. */
export async function resolveToolPath(
  ctx: SandboxContext,
  rel: string,
  expect: 'file' | 'dir' | 'new',
): Promise<SandboxOk | SandboxNo> {
  if (expect === 'new') {
    return resolveNew(ctx, rel)
  }
  const found = await walkExisting(ctx, rel)
  if (!found.ok) {
    return found
  }
  if (expect === 'dir') {
    let st: Awaited<ReturnType<typeof lstat>>
    try {
      st = await lstat(found.abs)
    } catch {
      return { ok: false, reason: 'путь' }
    }
    if (st.isSymbolicLink() || !st.isDirectory()) {
      return { ok: false, reason: 'не каталог' }
    }
    return { ...found, kind: 'dir' }
  }
  return found
}

async function resolveNew(ctx: SandboxContext, rel: string): Promise<SandboxOk | SandboxNo> {
  const platform = ctx.platform ?? process.platform
  const shape = pathShapeReason(rel, platform)
  if (shape || rootAlias(rel)) {
    return { ok: false, reason: shape ?? 'путь' }
  }
  const parts = rel.split('/')
  const parentRel = parts.slice(0, -1).join('/')
  const parent = await walkExisting(ctx, parentRel)
  if (!parent.ok) {
    return parent
  }
  let parentStat: Awaited<ReturnType<typeof lstat>>
  try {
    parentStat = await lstat(parent.abs)
  } catch {
    return { ok: false, reason: 'нет каталога' }
  }
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    return { ok: false, reason: 'нет каталога' }
  }
  const name = parts[parts.length - 1] ?? ''
  const abs = path.join(parent.abs, name)
  try {
    await lstat(abs)
    return { ok: false, reason: 'уже есть' }
  } catch (error) {
    if (!isEnoent(error)) {
      return { ok: false, reason: 'путь' }
    }
  }
  if (!staysIn(ctx.rootReal, abs) || insideLauncher(abs, ctx)) {
    return { ok: false, reason: 'вне' }
  }
  if (ctx.respectGitignore && gitignoreDenies(ctx.gitignore, rel)) {
    return { ok: false, reason: 'игнор' }
  }
  return { ok: true, rel, abs, kind: 'new' }
}

async function recheckSegments(ctx: SandboxContext, rel: string): Promise<boolean> {
  if (rootAlias(rel)) {
    return true
  }
  const parts = rel.split('/')
  let current = ctx.rootReal
  for (const segment of parts) {
    const next = path.join(current, segment)
    let st: Awaited<ReturnType<typeof lstat>>
    try {
      st = await lstat(next)
    } catch {
      return false
    }
    if (st.isSymbolicLink()) {
      return false
    }
    let real: string
    try {
      real = await realpath(next)
    } catch {
      return false
    }
    if (!staysIn(ctx.rootReal, real)) {
      return false
    }
    current = real
  }
  return true
}

/**
 * Прочитать обычный файл. FIFO, устройство, сокет и nlink > 1 — отказ, байты не возвращаются.
 * Расхождение (dev, ino) между fstat и повторным lstat — отказ, readFile не вызывается.
 */
export async function readSandboxedFile(
  ctx: SandboxContext,
  rel: string,
  hooks?: SandboxHooks,
): Promise<{ ok: true; bytes: Buffer; abs: string } | SandboxNo> {
  const found = await resolveToolPath(ctx, rel, 'file')
  if (!found.ok) {
    return found
  }
  let before: Awaited<ReturnType<typeof lstat>>
  try {
    before = await lstat(found.abs, { bigint: true })
  } catch {
    return { ok: false, reason: 'путь' }
  }
  if (before.isSymbolicLink() || !before.isFile()) {
    return { ok: false, reason: 'не файл' }
  }
  if (await hardLink(ctx, before.nlink, before.dev, before.ino)) {
    return { ok: false, reason: 'ссылка' }
  }
  if (hooks?.beforeOpen) {
    await hooks.beforeOpen()
  }
  let handle: FileHandle
  try {
    handle = await open(found.abs, constants.O_RDONLY | noFollowFlag())
  } catch {
    return { ok: false, reason: 'путь' }
  }
  try {
    const fst = await handle.stat({ bigint: true })
    const again = await lstat(found.abs, { bigint: true })
    const segmentsOk = await recheckSegments(ctx, rel)
    if (!segmentsOk || fst.dev !== again.dev || fst.ino !== again.ino || fst.ino !== before.ino || fst.dev !== before.dev) {
      return { ok: false, reason: 'подмена' }
    }
    if (fst.isSymbolicLink() || !fst.isFile() || await hardLink(ctx, fst.nlink, fst.dev, fst.ino)) {
      return { ok: false, reason: 'не файл' }
    }
    const bytes = Buffer.from(await handle.readFile())
    return { ok: true, bytes, abs: found.abs }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

export async function loadGitignore(rootReal: string, respect: boolean): Promise<readonly IgnoreRule[]> {
  if (!respect) {
    return []
  }
  const file = path.join(rootReal, '.gitignore')
  try {
    const st = await lstat(file)
    if (st.isSymbolicLink() || !st.isFile() || st.nlink > 1) {
      return [{ kind: 'all' }]
    }
    const text = await readFile(file, 'utf8')
    return compileGitignore(text)
  } catch (error) {
    if (isEnoent(error)) {
      return []
    }
    return [{ kind: 'all' }]
  }
}

export type { IgnoreRule }
