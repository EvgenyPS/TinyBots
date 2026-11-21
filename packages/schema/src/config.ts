/**
 * FILE: packages/schema/src/config.ts
 * НАЗНАЧЕНИЕ: config.yaml / config.example.yaml.
 * ВХОД: конфиг лаунчера.
 * ВЫХОД: разобранный конфиг. rules.base здесь нет: это не выключатель, лишний ключ отвергается.
 * Бот — союз двух строгих форм: Grok Bot и свой API-бот. Ключ в YAML не пишется.
 * updated_at у конфига нет: он не файл data_dir. schema_version есть, как у остальных контрактов.
 */

import { z } from 'zod'
import { inspectBaseUrl } from './base-url.js'
import { containedPathSchema, idSchema, isProjectFolderPath, isSafeDataDir, schemaVersionSchema } from './common.js'

const wakeSchema = z.enum(['mentioned_only'])
const replySchema = z.enum(['short', 'long'])

/**
 * Имя переменной с ключом, не само значение.
 * Суффикс _API_KEY отсекает GITHUB_TOKEN, PATH, PORT и GITHUB_API_BASE.
 */
export const API_KEY_ENV_PATTERN = /^[A-Z][A-Z0-9_]*_API_KEY$/

/** Официальные базы. В конфиге URL можно заменить на другой проверенный OpenAI-совместимый. */
export const LLM_PRESET_BASE_URL = {
  deepseek: 'https://api.deepseek.com',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
} as const

const botCommon = {
  id: idSchema,
  name: z.string().min(1),
  role: z.string().min(1),
  avatar: containedPathSchema.optional(),
  executor_for_merge: z.boolean().optional(),
  paused: z.boolean().optional(),
}

/** Бот Grok Bot: как раньше. Полей провайдера, модели, base_url, инструкций и имени ключа нет. */
export const grokBotSchema = z.strictObject({
  ...botCommon,
  grok_id: z.string().min(1).optional(),
})

function officialBaseUrl(provider: string): string | undefined {
  if (provider === 'deepseek' || provider === 'qwen') {
    return LLM_PRESET_BASE_URL[provider]
  }
  return undefined
}

/**
 * Свой бот. Значения ключа в YAML нет: только имя переменной окружения.
 * Провайдер deepseek или qwen без base_url получает официальный HTTPS.
 * Явный base_url не подменяется: его можно заменить на другой проверенный адрес.
 */
/**
 * Инструменты папки проекта. off — как раньше, без поля tools в запросе.
 * read — чтение. propose — чтение и предложение правки. propose ставится только явно.
 */
export const projectToolsSchema = z.enum(['off', 'read', 'propose'])

/** Как применять правку этого бота. Нет поля — сервер сам берёт git, если в папке есть репозиторий. */
export const applyModeSchema = z.enum(['git', 'files'])

export const apiBotSchema = z.strictObject({
  ...botCommon,
  instructions: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  base_url: z.string().min(1).optional(),
  api_key_env: z.string().regex(API_KEY_ENV_PATTERN, 'имя переменной *_API_KEY'),
  project_tools: projectToolsSchema.default('off'),
  apply_mode: applyModeSchema.optional(),
}).superRefine((bot, ctx) => {
  const base = bot.base_url ?? officialBaseUrl(bot.provider)
  if (base === undefined || !inspectBaseUrl(base).ok) {
    ctx.addIssue({ code: 'custom', path: ['base_url'], message: 'base_url' })
  }
}).transform((bot) => {
  const base = bot.base_url ?? officialBaseUrl(bot.provider)
  if (base === undefined) {
    return { ...bot, base_url: '' }
  }
  return { ...bot, base_url: base }
})

/**
 * Две строгие формы. Союз отличает их по полям, без нового обязательного kind:
 * старый конфиг Grok без kind по-прежнему проходит, лишние поля модели — нет.
 */
export const botSchema = z.union([apiBotSchema, grokBotSchema])

export type GrokBot = z.infer<typeof grokBotSchema>
export type ApiBot = z.infer<typeof apiBotSchema>
export type Bot = z.infer<typeof botSchema>

export function isApiBot(bot: Bot): bot is ApiBot {
  return 'api_key_env' in bot
}

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
    // Папка проекта не привязана к корню лаунчера: абсолютный путь и выход наверх допустимы.
    path: z.string().refine(isProjectFolderPath, 'путь к папке проекта'),
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
  /** Второй ключ инструментов. Без него бот папку не читает, даже если у бота project_tools включён. */
  allow_bot_tools: z.boolean().default(false),
  /** Корневой .gitignore. По умолчанию учитываем: непонятная строка закрывает то, что могла задеть. */
  respect_gitignore: z.boolean().default(true),
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
