/**
 * FILE: apps/server/src/store/index.ts
 * НАЗНАЧЕНИЕ: чтение data_dir и атомарная запись.
 * ВХОД: каталог данных, для записи — путь и тело.
 * ВЫХОД: задачи, записки, метка синка. Второй процесс и SSE сюда не входят.
 */

export { writeAtomic, type AtomicHooks } from './atomic.js'
export { readLatestSync, readNotes, readTasks, type NoteRecord } from './read.js'

import { readLatestSync, readTasks } from './read.js'

/** Снимок файлов, которые лаунчер только читает. Записки читаются отдельно: им нужен список ботов. */
export function readStore(dataDir: string): { tasks: ReturnType<typeof readTasks>; syncedAt: string | null } {
  return {
    tasks: readTasks(dataDir),
    syncedAt: readLatestSync(dataDir),
  }
}
