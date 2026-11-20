/**
 * FILE: packages/schema/src/merge.ts
 * НАЗНАЧЕНИЕ: запрос на мерж и таблица переходов. Это данные, не исполнитель мержа.
 * ВХОД: файл merge_requests и пара состояний.
 * ВЫХОД: разобранный запрос и ответ canTransition.
 * Обязательные поля — CONTRACT. Поля §4.4 добавлены как необязательные, чтобы
 * короткий файл и полная модель проходили одну схему. Неизвестные ключи отвергаются.
 * Смена head_sha не лежит в обычной таблице: это отдельная причина, только из approved.
 */

import { z } from 'zod'
import { idSchema, isMergeFilePath, isoSchema, versionFields } from './common.js'

export const MERGE_STATES = [
  'draft',
  'awaiting_owner',
  'changes_requested',
  'approved',
  'delivered',
  'merging',
  'merged',
  'rejected',
  'merge_failed',
  'reverted',
] as const

export type MergeState = (typeof MERGE_STATES)[number]

export const MERGE_TRANSITIONS: Record<MergeState, readonly MergeState[]> = {
  draft: ['awaiting_owner'],
  awaiting_owner: ['changes_requested', 'approved', 'rejected'],
  changes_requested: ['awaiting_owner'],
  approved: ['delivered'],
  delivered: ['merging'],
  merging: ['merged', 'merge_failed'],
  merge_failed: ['awaiting_owner'],
  merged: ['reverted'],
  rejected: [],
  reverted: [],
}

/** Отдельная дуга, не свободный переход. Без причины approved остаётся на месте. */
export const HEAD_SHA_CHANGE = {
  from: 'approved',
  to: 'awaiting_owner',
  cause: 'head_sha_changed',
} as const

export function canTransition(
  from: string,
  to: string,
  cause?: 'head_sha_changed',
): boolean {
  if (cause === HEAD_SHA_CHANGE.cause) {
    return from === HEAD_SHA_CHANGE.from && to === HEAD_SHA_CHANGE.to
  }
  const next = MERGE_TRANSITIONS[from as MergeState]
  if (!next) {
    return false
  }
  return (next as readonly string[]).includes(to)
}

const historyEntrySchema = z.strictObject({
  state: z.enum(MERGE_STATES),
  at: isoSchema,
  by: z.string().min(1),
  why: z.string().min(1),
})

const iterationDecisionSchema = z.strictObject({
  by: z.string().min(1),
  at: isoSchema,
  action: z.enum(['approved', 'rejected', 'changes_requested', 'merge', 'revert']),
  feedback: z.string(),
  sent_to_chats: z.array(idSchema),
})

const iterationSchema = z.strictObject({
  n: z.number().int().positive(),
  created_at: isoSchema.optional(),
  done: z.array(z.string()).optional(),
  broken: z.array(z.string()).optional(),
  postponed: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  other: z.string().optional(),
  addressed_feedback: z.strictObject({
    quote: z.string(),
    fixed: z.array(z.string()),
    remaining: z.array(z.string()),
  }).nullable().optional(),
  decision: iterationDecisionSchema.nullable().optional(),
})

function atMostLines(max: number) {
  return (value: string) => value.split(/\r?\n/).length <= max
}

export const mergeRequestSchema = z.strictObject({
  ...versionFields,
  project: idSchema,
  pr_url: z.string().min(1),
  head_sha: z.string().regex(/^[0-9a-f]{7,64}$/, 'head_sha'),
  tasks: z.array(idSchema),
  checks: z.enum(['green', 'red']),
  summary: z.string().min(1).refine(atMostLines(3), 'summary не длиннее 3 строк'),
  state: z.enum(MERGE_STATES),
  history: z.array(historyEntrySchema),
  id: idSchema.optional(),
  task_id: idSchema.optional(),
  mode: z.enum(['git', 'files']).optional(),
  author: idSchema.optional(),
  lead: idSchema.optional(),
  merge_executor: idSchema.optional(),
  owner: z.string().min(1).optional(),
  affected_chats: z.array(idSchema).optional(),
  links: z.strictObject({
    pr: z.string().optional(),
    ci: z.string().optional(),
    diff: z.string().optional(),
  }).optional(),
  iterations: z.array(iterationSchema).optional(),
  merge: z.strictObject({
    commit: z.string().nullable(),
    executed_by: z.string().nullable(),
    at: isoSchema.nullable(),
  }).optional(),
  revert: z.strictObject({
    pr: z.string().nullable(),
    requested_by: z.string().nullable(),
    approved_by: z.string().nullable(),
  }).optional(),
  // Сбой отката или переноса, который нельзя повторять молча на каждом синке.
  // Состояние при этом не прыгает: владелец видит why, пока не будет нового решения.
  fault: z.strictObject({
    action: z.enum(['merge', 'revert']),
    at: isoSchema,
    why: z.string().min(1),
  }).optional(),
  // Режим files: какие файлы переносить из staging. Путь относительный, без .git, backups и staging.
  files: z.array(z.strictObject({
    path: z.string().refine(isMergeFilePath, 'только относительный путь вне .git, backups и staging'),
  })).optional(),
})

export type MergeRequest = z.infer<typeof mergeRequestSchema>
