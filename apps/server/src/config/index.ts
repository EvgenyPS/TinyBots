/**
 * FILE: apps/server/src/config/index.ts
 * НАЗНАЧЕНИЕ: загрузка config.yaml и .env, мастер настройки пишет файл.
 * ВХОД: путь к config.yaml и окружение.
 * ВЫХОД: проверенный конфиг.
 * СТАТУС: заглушка. Реализация — PR 3.
 */

import { SCHEMA_PACKAGE } from '@tinybots/schema'

/** Связка workspace: сервер уже зависит от пакета схем. */
export const schemaPackageForConfig = SCHEMA_PACKAGE

export function loadConfig(): never {
  // TODO(PR 3): разбор config.yaml и .env, ошибки с файлом и строкой, без падения процесса.
  throw new Error('config: не реализовано (PR 3)')
}
