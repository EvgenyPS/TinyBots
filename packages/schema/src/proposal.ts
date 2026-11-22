/**
 * FILE: packages/schema/src/proposal.ts
 * НАЗНАЧЕНИЕ: предложение правки своего API-бота. Это не запрос на мерж.
 * ВХОД: JSON в data_dir/proposals. Папка проекта этим файлом не меняется.
 * ВЫХОД: разобранное предложение и ответ canProposalTransition.
 * Применение идёт сразу на этом ПК, без approved → delivered и без синка.
 * Другие переходы отвергаются. Каждый разрешённый переход пишет history.
 */

import { z } from 'zod'
import { idSchema, isoSchema, schemaVersionSchema } from './common.js'

export const PROPOSAL_STATES = [
  'proposed',
  'applying',
  'applied',
  'conflict',
  'rejected',
  'reverting',
  'reverted',
  'revert_conflict',
] as const

export type ProposalState = (typeof PROPOSAL_STATES)[number]

/**
 * proposed → applying → applied | conflict
 * proposed → rejected | conflict
 * conflict | revert_conflict → rejected — закрыть без записи в проект
 * applied → reverting → reverted | revert_conflict
 * applied → revert_conflict — отказ отката до записи, живой файл уже не тот
 * revert_conflict → reverting — повтор отката, когда помеха ушла
 * reverting → applied — восстановление git, если ветку удалить не успели.
 */
export const PROPOSAL_TRANSITIONS: Record<ProposalState, readonly ProposalState[]> = {
  proposed: ['applying', 'rejected', 'conflict'],
  applying: ['applied', 'conflict'],
  applied: ['reverting', 'revert_conflict'],
  reverting: ['reverted', 'revert_conflict', 'applied'],
  conflict: ['rejected'],
  rejected: [],
  reverted: [],
  revert_conflict: ['reverting', 'rejected'],
}

export function canProposalTransition(from: string, to: string): boolean {
  const next = PROPOSAL_TRANSITIONS[from as ProposalState]
  if (!next) {
    return false
  }
  return (next as readonly string[]).includes(to)
}

const SHA256 = /^[0-9a-f]{64}$/
const OID = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/

const historySchema = z.strictObject({
  state: z.enum(PROPOSAL_STATES),
  at: isoSchema,
  by: z.string().min(1),
  why: z.string().min(1),
})

const fileSchema = z.strictObject({
  path: z.string().min(1),
  base_sha256: z.string().regex(SHA256).nullable(),
  post_sha256: z.string().regex(SHA256),
  mode: z.number().int().nonnegative().optional(),
})

const gitSchema = z.strictObject({
  object_format: z.enum(['sha1', 'sha256']),
  head_ref: z.string().min(1),
  head_commit: z.string().regex(OID),
  branch: z.string().min(1),
  tree: z.string().regex(OID).nullable(),
  commit: z.string().regex(OID).nullable(),
})

export const proposalSchema = z.strictObject({
  schema_version: schemaVersionSchema,
  id: idSchema,
  project: idSchema,
  bot: idSchema,
  task_id: idSchema.optional(),
  summary: z.string().min(1),
  state: z.enum(PROPOSAL_STATES),
  patch_sha256: z.string().regex(SHA256),
  mode: z.enum(['files', 'git']),
  files: z.array(fileSchema).min(1).max(20),
  history: z.array(historySchema).min(1),
  git: gitSchema.optional(),
})

export type Proposal = z.infer<typeof proposalSchema>
export type ProposalFile = z.infer<typeof fileSchema>
