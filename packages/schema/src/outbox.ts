/**
 * FILE: packages/schema/src/outbox.ts
 * НАЗНАЧЕНИЕ: то, что пишет лаунчер в outbox: решение и отзыв.
 * ВХОД: решение владельца или текст отзыва.
 * ВЫХОД: действие approved|rejected|revert. changes_requested сюда не входит —
 * это действие итерации в запросе на мерж, а не файл решения.
 * Очередь задач живёт в task.ts: тот же объект, другое имя файла.
 */

import { z } from 'zod'
import { idSchema, isoSchema, versionFields } from './common.js'

export const DECISION_ACTIONS = ['approved', 'rejected', 'revert'] as const

export const decisionSchema = z.strictObject({
  ...versionFields,
  action: z.enum(DECISION_ACTIONS),
  head_sha: z.string().regex(/^[0-9a-f]{7,64}$/, 'head_sha'),
  by: z.string().min(1),
  at: isoSchema,
  project: idSchema.optional(),
  pr_url: z.string().min(1).optional(),
  mr_id: idSchema.optional(),
  // Красный CI: владелец явно отметил «принимаю риск». Без отметки поля нет.
  accept_risk: z.boolean().optional(),
})

export const feedbackSchema = z.strictObject({
  ...versionFields,
  id: idSchema,
  project: idSchema,
  task_id: idSchema,
  by: z.string().min(1),
  at: isoSchema,
  feedback: z.string().min(1),
  sent_to_chats: z.array(idSchema),
  mr_id: idSchema.optional(),
  // changes_requested не действие файла решения. Отзыв «на доработку» живёт здесь.
  intent: z.literal('changes_requested').optional(),
})

export type OwnerDecision = z.infer<typeof decisionSchema>
export type Feedback = z.infer<typeof feedbackSchema>
