/**
 * FILE: apps/server/src/merge/disk.ts
 * НАЗНАЧЕНИЕ: прочитать и записать запросы, решения и отзывы в data_dir.
 * ВХОД: каталог данных. Имена файлов — id схемы, без выхода из каталога.
 * ВЫХОД: разобранные объекты. Битый файл пропускаем, процесс не падает.
 * Запись — через временный файл и rename, как у остальных файлов лаунчера.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  decisionSchema,
  feedbackSchema,
  mergeRequestSchema,
  type Feedback,
  type MergeRequest,
  type OwnerDecision,
} from '@tinybots/schema'
import { writeAtomic } from '../store/atomic.js'

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

export type StoredMerge = { id: string; file: string; mr: MergeRequest }

function contained(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function readJsonDir<T>(dir: string, dataDir: string, parse: (value: unknown) => T | null): T[] {
  if (!existsSync(dir)) {
    return []
  }
  const found: T[] = []
  for (const name of readdirSync(dir).filter((item) => item.endsWith('.json')).sort()) {
    const file = path.join(dir, name)
    if (!contained(dataDir, file)) {
      continue
    }
    try {
      const parsed = parse(JSON.parse(readFileSync(file, 'utf8')) as unknown)
      if (parsed) {
        found.push(parsed)
      }
    } catch {
      // Битый json — карточка без этого файла, не падение сервера.
    }
  }
  return found
}

export function readMerges(dataDir: string): StoredMerge[] {
  const dir = path.join(dataDir, 'merge_requests')
  if (!existsSync(dir)) {
    return []
  }
  const found: StoredMerge[] = []
  for (const name of readdirSync(dir).filter((item) => item.endsWith('.json')).sort()) {
    const file = path.join(dir, name)
    if (!contained(dataDir, file)) {
      continue
    }
    const stem = name.slice(0, -'.json'.length)
    if (!SLUG.test(stem)) {
      continue
    }
    try {
      const parsed = mergeRequestSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')) as unknown)
      if (!parsed.success) {
        continue
      }
      const id = parsed.data.id ?? stem
      if (!SLUG.test(id)) {
        continue
      }
      found.push({ id, file, mr: parsed.data })
    } catch {
      // Пропуск битого файла.
    }
  }
  return found
}

export function readDecisions(dataDir: string): OwnerDecision[] {
  return readJsonDir(path.join(dataDir, 'outbox', 'decisions'), dataDir, (value) => {
    const parsed = decisionSchema.safeParse(value)
    return parsed.success ? parsed.data : null
  })
}

export function readFeedbackFiles(dataDir: string): Feedback[] {
  return readJsonDir(path.join(dataDir, 'outbox', 'feedback'), dataDir, (value) => {
    const parsed = feedbackSchema.safeParse(value)
    return parsed.success ? parsed.data : null
  })
}

export async function writeMergeFile(file: string, mr: MergeRequest): Promise<void> {
  const parsed = mergeRequestSchema.parse(mr)
  await writeAtomic(file, `${JSON.stringify(parsed, null, 2)}\n`)
}

export async function writeOutbox(
  dataDir: string,
  folder: 'decisions' | 'feedback',
  name: string,
  body: unknown,
): Promise<string> {
  if (!SLUG.test(name)) {
    throw new Error('имя файла')
  }
  const dir = path.join(dataDir, 'outbox', folder)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.json`)
  if (!contained(dataDir, file)) {
    throw new Error('путь outbox')
  }
  await writeAtomic(file, `${JSON.stringify(body, null, 2)}\n`)
  return file
}
