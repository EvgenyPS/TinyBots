/**
 * FILE: packages/schema/src/wake.ts
 * НАЗНАЧЕНИЕ: счётчик пробуждений задачи на диске.
 * ВХОД: JSON wakes/<task_id>.json.
 * ВЫХОД: целое count. Память процесса его не держит: после перезапуска читаем файл.
 */

import { z } from 'zod'
import { idSchema, isoSchema, schemaVersionSchema } from './common.js'

export const wakeCountSchema = z.strictObject({
  schema_version: schemaVersionSchema,
  updated_at: isoSchema,
  task_id: idSchema,
  count: z.number().int().nonnegative(),
})

export type WakeCount = z.infer<typeof wakeCountSchema>
