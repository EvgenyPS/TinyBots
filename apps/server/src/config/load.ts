/**
 * FILE: apps/server/src/config/load.ts
 * НАЗНАЧЕНИЕ: найти config.yaml, разобрать YAML и проверить схемой @tinybots/schema.
 * ВХОД: корень репозитория и относительный путь (аргумент, TINYBOTS_CONFIG или config.yaml).
 * ВЫХОД: конфиг либо отказ с файлом, строкой и причиной. Исключение наружу не летит:
 * битый файл не должен ронять процесс.
 * data_dir считается от папки самого конфига, чтобы демо-набор был самодостаточным.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { configSchema, type LauncherConfig } from '@tinybots/schema'
import { LineCounter, parseDocument, type Document } from 'yaml'

export type ConfigFailure = {
  ok: false
  file: string
  line: number
  reason: string
}

export type LoadedConfig = {
  ok: true
  file: string
  directory: string
  config: LauncherConfig
}

const PRIMARY_CONFIG = 'demo/sets/primary/config.yaml'

export function selectConfigRequest(root: string, explicit?: string): string {
  const fromCall = explicit?.trim()
  if (fromCall) {
    return fromCall
  }
  const fromEnv = process.env.TINYBOTS_CONFIG?.trim()
  if (fromEnv) {
    return fromEnv
  }
  if (existsSync(path.join(root, 'config.yaml'))) {
    return 'config.yaml'
  }
  return PRIMARY_CONFIG
}

export function toPosix(value: string): string {
  return value.split(path.sep).join('/')
}

function clip(reason: string): string {
  const oneLine = reason.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= 400) {
    return oneLine
  }
  return `${oneLine.slice(0, 400)}…`
}

function failure(file: string, line: number, reason: string): ConfigFailure {
  return { ok: false, file, line, reason: clip(reason) }
}

/** Путь только внутри корня. Абсолютный и `..` отвергаем до чтения. */
export function locateConfig(root: string, request: string): { absolute: string; display: string } | ConfigFailure {
  const raw = request.trim()
  const display = toPosix(raw.length > 0 ? raw : 'config.yaml')
  if (raw.length === 0) {
    return failure(display, 1, 'путь к конфигу пуст')
  }
  if (path.isAbsolute(raw)) {
    return failure(path.basename(raw), 1, 'путь к конфигу должен быть относительным')
  }
  const absolute = path.resolve(root, raw)
  const rel = path.relative(root, absolute)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return failure(display, 1, 'путь к конфигу выходит за корень репозитория')
  }
  return { absolute, display: toPosix(rel) }
}

function lineOf(doc: Document, pathKeys: PropertyKey[], lineCounter: LineCounter): number {
  if (pathKeys.length === 0) {
    return 1
  }
  const node: unknown = doc.getIn(pathKeys, true)
  if (!node || typeof node !== 'object' || !('range' in node)) {
    return 1
  }
  const range = (node as { range?: [number, number, number] | null }).range
  if (!range) {
    return 1
  }
  return lineCounter.linePos(range[0]).line
}

function formatIssue(pathKeys: PropertyKey[], message: string): string {
  const joined = pathKeys.map((part) => String(part)).join('.')
  if (joined.length === 0) {
    return message
  }
  return `${joined}: ${message}`
}

/** Разбор уже прочитанного текста. absolute сюда не входит: его добавляет чтение с диска. */
export function parseConfigText(text: string, display: string): { ok: true; config: LauncherConfig } | ConfigFailure {
  const lineCounter = new LineCounter()
  const doc = parseDocument(text, { lineCounter })
  const yamlError = doc.errors[0]
  if (yamlError) {
    const line = yamlError.linePos?.[0]?.line ?? 1
    return failure(display, line, yamlError.message)
  }
  const parsed = configSchema.safeParse(doc.toJS())
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (!issue) {
      return failure(display, 1, 'конфиг не прошёл схему')
    }
    return failure(display, lineOf(doc, issue.path, lineCounter), formatIssue(issue.path, issue.message))
  }
  return { ok: true, config: parsed.data }
}

function staysInsideRepo(root: string, absolute: string): boolean {
  let rootReal: string
  let fileReal: string
  try {
    rootReal = realpathSync(root)
    fileReal = realpathSync(absolute)
  } catch {
    return false
  }
  const rel = path.relative(rootReal, fileReal)
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function loadConfigAt(root: string, request: string): LoadedConfig | ConfigFailure {
  const located = locateConfig(root, request)
  if ('ok' in located) {
    return located
  }
  if (!existsSync(located.absolute)) {
    return failure(located.display, 1, 'файл не найден')
  }
  if (!staysInsideRepo(root, located.absolute)) {
    return failure(located.display, 1, 'конфиг по ссылке выходит за корень репозитория')
  }
  let text: string
  try {
    text = readFileSync(located.absolute, 'utf8')
  } catch {
    return failure(located.display, 1, 'нет доступа к файлу')
  }
  const parsed = parseConfigText(text, located.display)
  if (!parsed.ok) {
    return parsed
  }
  return {
    ok: true,
    file: located.display,
    directory: path.dirname(located.absolute),
    config: parsed.config,
  }
}

export type DataDir = { ok: true; dir: string } | { ok: false; reason: string }

/**
 * Каталог данных рядом с конфигом. Нет папки — это пустые записки, не ошибка.
 * Ссылка наружу — ошибка: читать такое нельзя.
 */
export function resolveDataDir(root: string, configDirectory: string, dataDir: string): DataDir {
  const absolute = path.resolve(configDirectory, dataDir)
  let rootReal: string
  try {
    rootReal = realpathSync(root)
  } catch {
    return { ok: false, reason: 'корень репозитория недоступен' }
  }
  if (!existsSync(absolute)) {
    const rel = path.relative(rootReal, absolute)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, reason: 'data_dir выходит за корень репозитория' }
    }
    return { ok: true, dir: absolute }
  }
  let real: string
  try {
    real = realpathSync(absolute)
  } catch {
    return { ok: false, reason: 'data_dir недоступен' }
  }
  const rel = path.relative(rootReal, real)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, reason: 'data_dir по ссылке выходит за корень репозитория' }
  }
  return { ok: true, dir: real }
}
