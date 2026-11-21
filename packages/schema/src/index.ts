/**
 * FILE: packages/schema/src/index.ts
 * НАЗНАЧЕНИЕ: один вход пакета схем для server и web.
 * ВХОД: объекты контракта.
 * ВЫХОД: zod-схемы и canTransition. JSON Schema пишет emit.ts в packages/schema/json/.
 * Имена полей — docs/CONTRACT.md. Черновик ARCH с brief/files/result сюда не входит.
 */

export { apiUsageSchema, type ApiUsage } from './api-usage.js'
export { addressKind, inspectBaseUrl, isObfuscatedIpv4, rawHostname, type InspectedBaseUrl } from './base-url.js'
export { CHAT_LOG_LIMIT, chatLogSchema, chatMessageSchema, type ChatLog, type ChatMessage } from './chat-log.js'
export {
  SCHEMA_VERSION,
  idSchema,
  isoSchema,
  isContainedPath,
  isMergeFilePath,
  isProjectFolderPath,
  isReservedDeviceName,
  isSafeDataDir,
} from './common.js'
export {
  API_KEY_ENV_PATTERN,
  LLM_PRESET_BASE_URL,
  apiBotSchema,
  botSchema,
  configSchema,
  grokBotSchema,
  isApiBot,
  projectToolsSchema,
  type ApiBot,
  type Bot,
  type GrokBot,
  type LauncherConfig,
} from './config.js'
export { wakeCountSchema, type WakeCount } from './wake.js'
export {
  PROPOSAL_STATES,
  PROPOSAL_TRANSITIONS,
  canProposalTransition,
  proposalSchema,
  type Proposal,
  type ProposalFile,
  type ProposalState,
} from './proposal.js'
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
