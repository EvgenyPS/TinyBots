/**
 * FILE: packages/schema/src/api-usage.ts
 * НАЗНАЧЕНИЕ: расход токенов своего бота по полю usage ответа.
 * ВХОД: суммы prompt и completion. Имя файла — имя переменной ключа, не значение.
 * ВЫХОД: отдельная схема. Недельный usage/<YYYY-Www>.json и его оценка сюда не входят.
 */

import { z } from 'zod'
import { isoSchema, schemaVersionSchema } from './common.js'
import { API_KEY_ENV_PATTERN } from './config.js'

export const apiUsageSchema = z.strictObject({
  schema_version: schemaVersionSchema,
  updated_at: isoSchema,
  api_key_env: z.string().regex(API_KEY_ENV_PATTERN, 'имя переменной *_API_KEY'),
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  /** false — последний ответ пришёл без usage. Числа ниже не оценка, их не показываем. */
  reported: z.boolean(),
})

export type ApiUsage = z.infer<typeof apiUsageSchema>
