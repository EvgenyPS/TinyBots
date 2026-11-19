/**
 * FILE: apps/server/src/config/index.ts
 * НАЗНАЧЕНИЕ: загрузка config.yaml через схемы пакета.
 * ВХОД: корень репозитория и необязательный относительный путь.
 * ВЫХОД: проверенный конфиг или отказ с файлом, строкой и причиной.
 * Запись config.yaml живёт в setup.ts: этот модуль только читает.
 */

import { loadConfigAt, selectConfigRequest, type ConfigFailure, type LoadedConfig } from './load.js'

export { SCHEMA_PACKAGE as schemaPackageForConfig } from '@tinybots/schema'
export {
  loadConfigAt,
  locateConfig,
  parseConfigText,
  resolveDataDir,
  selectConfigRequest,
  type ConfigFailure,
  type LoadedConfig,
} from './load.js'

/** Тот же разбор, что у API: без пути берётся config.yaml или демо-набор. */
export function loadConfig(root: string, explicit?: string): LoadedConfig | ConfigFailure {
  return loadConfigAt(root, selectConfigRequest(root, explicit))
}
