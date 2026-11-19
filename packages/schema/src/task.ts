/**
 * FILE: packages/schema/src/task.ts
 * НАЗНАЧЕНИЕ: карточка tasks/<id>.yaml и черновик очереди (та же форма).
 * ВХОД: объект задачи от главного бота или от владельца (очередь).
 * ВЫХОД: задача с полями CONTRACT, не со старыми brief/files/result из черновика ARCH.
 */

import { z } from 'zod'
import { containedPathSchema, dueSchema, idSchema, versionFields } from './common.js'

export const TASK_STATUSES = ['new', 'working', 'review', 'done', 'blocked'] as const
export const REPLY_LIMITS = ['short', 'long'] as const

// Путь режем сразу: SHA и ссылка на PR живут не в файловой системе конфига.
const inputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('path'), value: containedPathSchema }),
  z.strictObject({ kind: z.literal('sha'), value: z.string().min(1) }),
  z.strictObject({ kind: z.literal('pr'), value: z.string().min(1) }),
])

export const taskSchema = z.strictObject({
  ...versionFields,
  id: idSchema,
  project: idSchema,
  chat: idSchema,
  assignee: idSchema,
  goal: z.string().min(1),
  inputs: z.array(inputSchema),
  output: z.string().min(1),
  done_when: z.string().min(1),
  out_of_scope: z.string().min(1),
  reply_limit: z.enum(REPLY_LIMITS),
  due: dueSchema,
  status: z.enum(TASK_STATUSES),
})

export type Task = z.infer<typeof taskSchema>

/** Очередь — черновик той же карточки. Отдельное имя, чтобы JSON Schema получила свой $id. */
export const queueSchema = taskSchema
