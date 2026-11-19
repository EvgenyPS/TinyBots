/**
 * FILE: packages/schema/src/status.ts
 * НАЗНАЧЕНИЕ: сдача status/<bot>.json, не длиннее шести строк протокола.
 * ВХОД: отчёт исполнителя.
 * ВЫХОД: состояние working|blocked|done и необязательные риски для окна мержа.
 * Поле называется risks: так в CONTRACT. Черновик плана с единственным risk не используем.
 */

import { z } from 'zod'
import { idSchema, versionFields } from './common.js'

export const STATUS_STATES = ['working', 'blocked', 'done'] as const

export const statusSchema = z.strictObject({
  ...versionFields,
  task_id: idSchema,
  state: z.enum(STATUS_STATES),
  links: z.array(z.string().min(1)),
  verified: z.string(),
  not_done: z.string(),
  // Пустая строка не считается риском: либо поля нет, либо есть текст для окна мержа.
  risks: z.string().min(1).optional(),
  question_to_owner: z.string(),
})

export type StatusReport = z.infer<typeof statusSchema>
