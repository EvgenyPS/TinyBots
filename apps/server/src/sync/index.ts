/**
 * FILE: apps/server/src/sync/index.ts
 * НАЗНАЧЕНИЕ: манифест и бандлы синхронизации в обе стороны.
 * ВХОД: каталоги data_dir.
 * ВЫХОД: архив и sync_manifest (path, sha256, updated_at).
 * СТАТУС: заглушка. Реализация — PR 7.
 */

export function packSyncBundle(): never {
  // TODO(PR 7): один бандл в каждую сторону, пропуск неизменённых файлов и чужого писателя.
  throw new Error('sync: не реализовано (PR 7)')
}
