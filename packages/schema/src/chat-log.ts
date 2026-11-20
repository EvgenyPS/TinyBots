/**
 * FILE: packages/schema/src/chat-log.ts
 * НАЗНАЧЕНИЕ: история чата своего бота в data_dir.
 * ВХОД: JSON переписки.
 * ВЫХОД: не больше 100 сообщений. Ключа модели в сообщениях нет: это текст экрана.
 */

import { z } from 'zod'
import { idSchema, isoSchema, schemaVersionSchema } from './common.js'

export const CHAT_LOG_LIMIT = 100

export const chatMessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  at: isoSchema,
})

export const chatLogSchema = z.strictObject({
  schema_version: schemaVersionSchema,
  updated_at: isoSchema,
  bot_id: idSchema,
  messages: z.array(chatMessageSchema).max(CHAT_LOG_LIMIT),
})

export type ChatLog = z.infer<typeof chatLogSchema>
export type ChatMessage = z.infer<typeof chatMessageSchema>
