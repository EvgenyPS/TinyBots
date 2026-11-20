/**
 * FILE: packages/schema/src/index.ts
 * НАЗНАЧЕНИЕ: один вход пакета схем для server и web.
 * ВХОД: объекты контракта.
 * ВЫХОД: zod-схемы и canTransition. JSON Schema пишет emit.ts в packages/schema/json/.
 * Имена полей — docs/CONTRACT.md. Черновик ARCH с brief/files/result сюда не входит.
 */

export { SCHEMA_VERSION, idSchema, isoSchema, isContainedPath, isProjectFolderPath, isSafeDataDir } from './common.js'
export { configSchema, type LauncherConfig } from './config.js'
export {
  HEAD_SHA_CHANGE,
  MERGE_STATES,
  MERGE_TRANSITIONS,
  canTransition,
  mergeRequestSchema,
  type MergeRequest,
  type MergeState,
} from './merge.js'
export { decisionSchema, feedbackSchema, type Feedback, type OwnerDecision } from './outbox.js'
export { statusSchema, type StatusReport } from './status.js'
export { syncManifestSchema, type SyncManifest } from './sync.js'
export { queueSchema, taskSchema, type Task } from './task.js'
export { usageSchema, type UsageSnapshot } from './usage.js'

/** Имя пакета, чтобы workspace-ссылка была настоящей уже в каркасе. */
export const SCHEMA_PACKAGE = '@tinybots/schema'
