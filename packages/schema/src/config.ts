/**
 * FILE: packages/schema/src/config.ts
 * НАЗНАЧЕНИЕ: config.yaml / config.example.yaml.
 * ВХОД: конфиг лаунчера.
 * ВЫХОД: разобранный конфиг. rules.base здесь нет: это не выключатель, лишний ключ отвергается.
 * updated_at у конфига нет: он не файл data_dir. schema_version есть, как у остальных контрактов.
 */

import { z } from 'zod'
import { containedPathSchema, idSchema, isSafeDataDir, schemaVersionSchema } from './common.js'

const wakeSchema = z.enum(['mentioned_only'])
const replySchema = z.enum(['short', 'long'])

const botSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  role: z.string().min(1),
  avatar: containedPathSchema.optional(),
  grok_id: z.string().min(1).optional(),
  executor_for_merge: z.boolean().optional(),
  paused: z.boolean().optional(),
})

const chatSchema = z.strictObject({
  id: idSchema,
  title: z.string().min(1),
  lead: idSchema,
  members: z.array(idSchema),
  rules: z.strictObject({
    do: z.string().min(1),
    dont: z.string().min(1),
  }),
  context: z.array(containedPathSchema),
  economy: z.strictObject({
    wake: wakeSchema,
    reply_limit: replySchema,
  }),
})

const gitSourceSchema = z.strictObject({
  provider: z.literal('github'),
  repo: z.string().min(1).nullable(),
})

const sourceSchema = z.strictObject({
  git: gitSourceSchema.nullable().optional(),
  files: z.strictObject({
    path: containedPathSchema,
  }).optional(),
}).refine((value) => value.git != null || value.files != null, 'нужен git или каталог files')

const projectSchema = z.strictObject({
  id: idSchema,
  title: z.string().min(1),
  lead: idSchema,
  owner: z.string().min(1),
  merge_executor: idSchema,
  source: sourceSchema,
  chats: z.array(chatSchema),
})

export const configSchema = z.strictObject({
  schema_version: schemaVersionSchema,
  owner: z.strictObject({
    name: z.string().min(1),
    confirms_merge: z.boolean(),
  }),
  data_dir: z.string().refine(isSafeDataDir, 'data_dir не может быть служебным путём'),
  delivery: z.enum(['clipboard', 'queue']),
  bots: z.array(botSchema),
  projects: z.array(projectSchema),
  economy: z.strictObject({
    defaults: z.strictObject({
      wake: wakeSchema,
      reply_limit: replySchema,
      max_wakes_per_task: z.number().int().positive(),
    }),
    stale_after_hours: z.number().positive(),
  }),
  timezone: z.string().min(1).optional(),
})

export type LauncherConfig = z.infer<typeof configSchema>
