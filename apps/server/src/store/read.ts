/**
 * FILE: apps/server/src/store/read.ts
 * НАЗНАЧЕНИЕ: прочитать записки, задачи и метку синка из data_dir.
 * ВХОД: каталог данных и список id ботов из конфига.
 * ВЫХОД: карточки. Битый или отсутствующий файл — пометка, не исключение.
 * Имена файлов берём из id схемы (без слешей), путь сверяем с каталогом.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { statusSchema, syncManifestSchema, taskSchema, type StatusReport, type Task } from '@tinybots/schema'
import { parse } from 'yaml'
import { formatHm, isStale } from '../time.js'

export type NoteRecord = {
  bot_id: string
  status: 'ok' | 'missing' | 'broken'
  stale: boolean
  updated_at: string | null
  updated_label: string | null
  state: string | null
  text: string | null
  question_to_owner: string | null
}

function inside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function emptyNote(botId: string, status: 'missing' | 'broken'): NoteRecord {
  return {
    bot_id: botId,
    status,
    stale: false,
    updated_at: null,
    updated_label: null,
    state: null,
    text: null,
    question_to_owner: null,
  }
}

function noteText(report: StatusReport): string {
  const verified = report.verified.trim()
  if (verified.length > 0) {
    return verified
  }
  const pending = report.not_done.trim()
  if (pending.length > 0) {
    return pending
  }
  return report.state
}

export function readNotes(
  dataDir: string,
  botIds: readonly string[],
  now: Date,
  staleAfterHours: number,
  timeZone: string,
): NoteRecord[] {
  const statusDir = path.join(dataDir, 'status')
  return botIds.map((botId) => {
    if (botId.includes('/') || botId.includes('\\') || botId.includes('..')) {
      return emptyNote(botId, 'broken')
    }
    const file = path.join(statusDir, `${botId}.json`)
    if (!inside(dataDir, file)) {
      return emptyNote(botId, 'broken')
    }
    if (!existsSync(file)) {
      return emptyNote(botId, 'missing')
    }
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      return emptyNote(botId, 'broken')
    }
    let json: unknown
    try {
      json = JSON.parse(raw) as unknown
    } catch {
      return emptyNote(botId, 'broken')
    }
    const parsed = statusSchema.safeParse(json)
    if (!parsed.success) {
      return emptyNote(botId, 'broken')
    }
    return {
      bot_id: botId,
      status: 'ok',
      stale: isStale(parsed.data.updated_at, now, staleAfterHours),
      updated_at: parsed.data.updated_at,
      updated_label: formatHm(parsed.data.updated_at, timeZone),
      state: parsed.data.state,
      text: noteText(parsed.data),
      question_to_owner: parsed.data.question_to_owner.trim() || null,
    }
  })
}

export function readTasks(dataDir: string): Task[] {
  const dir = path.join(dataDir, 'tasks')
  if (!existsSync(dir)) {
    return []
  }
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort()
  const tasks: Task[] = []
  for (const name of names) {
    const file = path.join(dir, name)
    if (!inside(dataDir, file)) {
      continue
    }
    try {
      const parsed = taskSchema.safeParse(parse(readFileSync(file, 'utf8')))
      if (parsed.success) {
        tasks.push(parsed.data)
      }
    } catch {
      // Битая карточка пропускается: колонка просто не получит её.
    }
  }
  return tasks
}

/**
 * Самое позднее updated_at среди валидных манифестов. Это «данные на ЧЧ:ММ».
 * Имя файла и порядок каталога не важны: поздний по времени может лежать не в последнем файле.
 */
export function readLatestSync(dataDir: string): string | null {
  const dir = path.join(dataDir, 'sync')
  if (!existsSync(dir)) {
    return null
  }
  let latest: string | null = null
  let latestMs = Number.NEGATIVE_INFINITY
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) {
      continue
    }
    const file = path.join(dir, name)
    if (!inside(dataDir, file)) {
      continue
    }
    try {
      const parsed = syncManifestSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')) as unknown)
      if (!parsed.success) {
        continue
      }
      const ms = Date.parse(parsed.data.updated_at)
      if (Number.isFinite(ms) && ms > latestMs) {
        latestMs = ms
        latest = parsed.data.updated_at
      }
    } catch {
      // Битый манифест не затирает уже найденную метку и не роняет чтение.
    }
  }
  return latest
}
