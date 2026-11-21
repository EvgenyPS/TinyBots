/**
 * FILE: apps/server/src/llm/store.ts
 * НАЗНАЧЕНИЕ: история, расход и счётчик пробуждений в data_dir.
 * ВХОД: каталог данных. Запись через writeAtomic.
 * ВЫХОД: разобранные файлы. Битый JSON не роняет процесс.
 * Счётчик живёт в файле: повторное чтение после «перезапуска» видит то же число.
 * Очередь одна на все записи модели, чтобы два пробуждения не проскочили лимит.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  apiUsageSchema,
  chatLogSchema,
  statusSchema,
  taskSchema,
  wakeCountSchema,
  CHAT_LOG_LIMIT,
  type ApiUsage,
  type ChatMessage,
  type StatusReport,
  type Task,
} from '@tinybots/schema'
import { parse, stringify } from 'yaml'
import { redact } from '../redact.js'
import { writeAtomic } from '../store/atomic.js'

let chain: Promise<void> = Promise.resolve()

/** Второй вызов ждёт, пока первый допишет счётчик. */
export function withLlmLock<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job)
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown
}

export function readChat(dataDir: string, botId: string): { messages: ChatMessage[]; broken: boolean } {
  const file = path.join(dataDir, 'chats', `${botId}.json`)
  if (!existsSync(file)) {
    return { messages: [], broken: false }
  }
  try {
    const parsed = chatLogSchema.safeParse(readJson(file))
    if (!parsed.success) {
      return { messages: [], broken: true }
    }
    return { messages: parsed.data.messages, broken: false }
  } catch {
    return { messages: [], broken: true }
  }
}

export function trimMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  if (messages.length <= CHAT_LOG_LIMIT) {
    return [...messages]
  }
  return messages.slice(messages.length - CHAT_LOG_LIMIT)
}

export async function writeChat(dataDir: string, botId: string, messages: readonly ChatMessage[], now: Date): Promise<void> {
  const dir = path.join(dataDir, 'chats')
  mkdirSync(dir, { recursive: true })
  const body = {
    schema_version: 1 as const,
    updated_at: now.toISOString(),
    bot_id: botId,
    messages: trimMessages(messages).map((message) => ({
      role: message.role,
      text: redact(message.text),
      at: message.at,
    })),
  }
  const parsed = chatLogSchema.safeParse(body)
  if (!parsed.success) {
    return
  }
  await writeAtomic(path.join(dir, `${botId}.json`), `${JSON.stringify(parsed.data, null, 2)}\n`)
}

export function readWakeCount(dataDir: string, taskId: string): number | null {
  const file = path.join(dataDir, 'wakes', `${taskId}.json`)
  if (!existsSync(file)) {
    return 0
  }
  try {
    const parsed = wakeCountSchema.safeParse(readJson(file))
    return parsed.success ? parsed.data.count : null
  } catch {
    return null
  }
}

export async function writeWakeCount(dataDir: string, taskId: string, count: number, now: Date): Promise<void> {
  const dir = path.join(dataDir, 'wakes')
  mkdirSync(dir, { recursive: true })
  const body = {
    schema_version: 1 as const,
    updated_at: now.toISOString(),
    task_id: taskId,
    count,
  }
  await writeAtomic(path.join(dir, `${taskId}.json`), `${JSON.stringify(body, null, 2)}\n`)
}

function taskFile(dataDir: string, taskId: string): string | null {
  for (const ext of ['.yaml', '.yml']) {
    const file = path.join(dataDir, 'tasks', `${taskId}${ext}`)
    if (existsSync(file)) {
      return file
    }
  }
  return null
}

export function readTask(dataDir: string, taskId: string): Task | null {
  const file = taskFile(dataDir, taskId)
  if (!file) {
    return null
  }
  try {
    const parsed = taskSchema.safeParse(parse(readFileSync(file, 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Лимит пробуждений. Исполнителя и главного не трогаем, в done сами не ставим. */
export async function blockTask(dataDir: string, taskId: string, now: Date): Promise<void> {
  const file = taskFile(dataDir, taskId)
  const task = readTask(dataDir, taskId)
  if (!file || !task || task.status === 'blocked') {
    return
  }
  const next: Task = { ...task, status: 'blocked', updated_at: now.toISOString() }
  await writeAtomic(file, stringify(next))
}

export function readUsage(dataDir: string, apiKeyEnv: string): ApiUsage | null {
  const file = path.join(dataDir, 'api-usage', `${apiKeyEnv}.json`)
  if (!existsSync(file)) {
    return null
  }
  try {
    const parsed = apiUsageSchema.safeParse(readJson(file))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function usageLabel(dataDir: string, apiKeyEnv: string | null): string | null {
  if (!apiKeyEnv) {
    return null
  }
  const usage = readUsage(dataDir, apiKeyEnv)
  if (!usage || !usage.reported) {
    return 'нет данных'
  }
  return `prompt ${usage.prompt_tokens} · completion ${usage.completion_tokens}`
}

export async function addUsage(
  dataDir: string,
  apiKeyEnv: string,
  fresh: { prompt: number; completion: number; total: number } | null,
  now: Date,
): Promise<void> {
  const previous = readUsage(dataDir, apiKeyEnv)
  if (!fresh && !previous) {
    return
  }
  const dir = path.join(dataDir, 'api-usage')
  mkdirSync(dir, { recursive: true })
  const body: ApiUsage = fresh
    ? {
        schema_version: 1,
        updated_at: now.toISOString(),
        api_key_env: apiKeyEnv,
        prompt_tokens: (previous?.prompt_tokens ?? 0) + fresh.prompt,
        completion_tokens: (previous?.completion_tokens ?? 0) + fresh.completion,
        total_tokens: (previous?.total_tokens ?? 0) + fresh.total,
        reported: true,
      }
    : {
        schema_version: 1,
        updated_at: now.toISOString(),
        api_key_env: apiKeyEnv,
        prompt_tokens: previous?.prompt_tokens ?? 0,
        completion_tokens: previous?.completion_tokens ?? 0,
        total_tokens: previous?.total_tokens ?? 0,
        reported: false,
      }
  const parsed = apiUsageSchema.safeParse(body)
  if (!parsed.success) {
    return
  }
  await writeAtomic(path.join(dir, `${apiKeyEnv}.json`), `${JSON.stringify(parsed.data, null, 2)}\n`)
}

export function parseNote(raw: string): StatusReport | null {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  const body = fenced?.[1] ?? trimmed
  try {
    const parsed = statusSchema.safeParse(JSON.parse(body) as unknown)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function noteBytes(dataDir: string, botId: string): string | null {
  const file = path.join(dataDir, 'status', `${botId}.json`)
  if (!existsSync(file)) {
    return null
  }
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export async function writeNote(dataDir: string, botId: string, note: StatusReport): Promise<boolean> {
  const parsed = statusSchema.safeParse(note)
  if (!parsed.success) {
    return false
  }
  const dir = path.join(dataDir, 'status')
  mkdirSync(dir, { recursive: true })
  await writeAtomic(path.join(dir, `${botId}.json`), `${JSON.stringify(parsed.data, null, 2)}\n`)
  return true
}
