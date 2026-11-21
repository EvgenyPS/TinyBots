/**
 * FILE: packages/schema/src/json-docs.ts
 * НАЗНАЧЕНИЕ: JSON Schema из тех же zod-объектов, без второй ручной схемы.
 * ВХОД: схемы пакета.
 * ВЫХОД: документы draft-07. Общие куски встроены, а не вынесены в $ref,
 * чтобы файл читался один и diff не прыгал из-за порядка ссылок.
 */

import { toJSONSchema, type ZodType } from 'zod'
import { apiUsageSchema } from './api-usage.js'
import { chatLogSchema } from './chat-log.js'
import { configSchema } from './config.js'
import { mergeRequestSchema } from './merge.js'
import { decisionSchema, feedbackSchema } from './outbox.js'
import { statusSchema } from './status.js'
import { syncManifestSchema } from './sync.js'
import { queueSchema, taskSchema } from './task.js'
import { usageSchema } from './usage.js'
import { proposalSchema } from './proposal.js'
import { wakeCountSchema } from './wake.js'

export interface JsonDocument {
  file: string
  schema: Record<string, unknown>
}

const DOCUMENTS: ReadonlyArray<{ file: string; id: string; schema: ZodType }> = [
  { file: 'task.schema.json', id: 'https://tinybots.local/schema/task.schema.json', schema: taskSchema },
  { file: 'status.schema.json', id: 'https://tinybots.local/schema/status.schema.json', schema: statusSchema },
  { file: 'merge-request.schema.json', id: 'https://tinybots.local/schema/merge-request.schema.json', schema: mergeRequestSchema },
  { file: 'decision.schema.json', id: 'https://tinybots.local/schema/decision.schema.json', schema: decisionSchema },
  { file: 'queue.schema.json', id: 'https://tinybots.local/schema/queue.schema.json', schema: queueSchema },
  { file: 'feedback.schema.json', id: 'https://tinybots.local/schema/feedback.schema.json', schema: feedbackSchema },
  { file: 'usage.schema.json', id: 'https://tinybots.local/schema/usage.schema.json', schema: usageSchema },
  { file: 'config.schema.json', id: 'https://tinybots.local/schema/config.schema.json', schema: configSchema },
  { file: 'sync-manifest.schema.json', id: 'https://tinybots.local/schema/sync-manifest.schema.json', schema: syncManifestSchema },
  { file: 'chat-log.schema.json', id: 'https://tinybots.local/schema/chat-log.schema.json', schema: chatLogSchema },
  { file: 'api-usage.schema.json', id: 'https://tinybots.local/schema/api-usage.schema.json', schema: apiUsageSchema },
  { file: 'wake-count.schema.json', id: 'https://tinybots.local/schema/wake-count.schema.json', schema: wakeCountSchema },
  { file: 'proposal.schema.json', id: 'https://tinybots.local/schema/proposal.schema.json', schema: proposalSchema },
]

export function jsonDocuments(): JsonDocument[] {
  return DOCUMENTS.map((item) => {
    // input: пресет deepseek/qwen дописывает base_url уже после разбора YAML.
    const raw = toJSONSchema(item.schema, { target: 'draft-07', reused: 'inline', io: 'input' })
    const body = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>
    return {
      file: item.file,
      schema: { $id: item.id, ...body },
    }
  })
}
