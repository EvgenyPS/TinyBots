/**
 * FILE: apps/server/src/store/atomic.ts
 * НАЗНАЧЕНИЕ: записать файл так, чтобы читатель видел либо старое, либо новое целиком.
 * ВХОД: путь и тело. Необязательный afterChunk — крюк для теста обрыва.
 * ВЫХОД: файл заменён через rename. Пока идёт запись, цель не трогаем: пишем во временный файл рядом.
 * rename на том же томе в Node — замена целиком (на Windows это MoveFileEx с REPLACE_EXISTING).
 * На Windows файл часто ещё держит индексатор или антивирус: EPERM и EBUSY повторяем несколько раз с паузой.
 * Другие коды не повторяем. Обрыв процесса до успешного rename оставляет прежний файл.
 * Временный хвост после kill — ожидаемый мусор, не данные.
 */

import { randomBytes } from 'node:crypto'
import { chmod, open, rename, rm, type FileHandle } from 'node:fs/promises'
import path from 'node:path'

export type AtomicHooks = {
  afterChunk?: (index: number) => Promise<void> | void
  /** Подмена rename в тесте. В бою — fs.promises.rename. */
  rename?: (from: string, to: string) => Promise<void>
  /** Подмена паузы в тесте, чтобы не ждать настоящие миллисекунды. */
  sleep?: (ms: number) => Promise<void>
  /**
   * Прямо перед rename. Сюда кладём повторную проверку симлинка:
   * между планом и записью путь могли подменить.
   */
  beforeCommit?: () => Promise<void> | void
  /** POSIX: режим временного файла до rename. Без поля режим не трогаем, C9 не меняется. */
  mode?: number
}

const CHUNK = 16 * 1024
export const RENAME_ATTEMPTS = 5
export const RENAME_PAUSE_MS = 25

function retryableRename(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false
  }
  const code = (error as { code?: unknown }).code
  return code === 'EPERM' || code === 'EBUSY'
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function renameReplace(from: string, to: string, hooks?: AtomicHooks): Promise<void> {
  const renameFn = hooks?.rename ?? rename
  const sleepFn = hooks?.sleep ?? defaultSleep
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt += 1) {
    try {
      await renameFn(from, to)
      return
    } catch (error) {
      if (!retryableRename(error) || attempt === RENAME_ATTEMPTS - 1) {
        throw error
      }
      await sleepFn(RENAME_PAUSE_MS * (attempt + 1))
    }
  }
}

async function writeAll(handle: FileHandle, data: Buffer): Promise<void> {
  let offset = 0
  while (offset < data.length) {
    const { bytesWritten } = await handle.write(data.subarray(offset))
    if (bytesWritten <= 0) {
      throw new Error('запись файла остановилась')
    }
    offset += bytesWritten
  }
}

export async function writeAtomic(target: string, body: string | Uint8Array, hooks?: AtomicHooks): Promise<void> {
  const dir = path.dirname(target)
  const tmp = path.join(
    dir,
    `.${path.basename(target)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`,
  )
  const data = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body)
  let handle: FileHandle | undefined
  let committed = false
  try {
    handle = await open(tmp, 'w')
    let offset = 0
    let index = 0
    // Пустое тело тоже проходит крюк один раз: тест обрыва не зависит от размера.
    while (index === 0 || offset < data.length) {
      const end = Math.min(data.length, offset + CHUNK)
      if (end > offset) {
        await writeAll(handle, data.subarray(offset, end))
      }
      if (hooks?.afterChunk) {
        await hooks.afterChunk(index)
      }
      offset = end
      index += 1
      if (offset >= data.length) {
        break
      }
    }
    await handle.sync()
    await handle.close()
    handle = undefined
    if (typeof hooks?.mode === 'number' && process.platform !== 'win32') {
      await chmod(tmp, hooks.mode & 0o777)
    }
    if (hooks?.beforeCommit) {
      await hooks.beforeCommit()
    }
    await renameReplace(tmp, target, hooks)
    committed = true
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined)
    }
    if (!committed) {
      await rm(tmp, { force: true }).catch(() => undefined)
    }
    throw error
  }
}
