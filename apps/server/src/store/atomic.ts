/**
 * FILE: apps/server/src/store/atomic.ts
 * НАЗНАЧЕНИЕ: записать файл так, чтобы читатель видел либо старое, либо новое целиком.
 * ВХОД: путь и тело. Необязательный afterChunk — крюк для теста обрыва.
 * ВЫХОД: файл заменён через rename. Пока идёт запись, цель не трогаем: пишем во временный файл рядом.
 * rename на том же томе в Node — замена целиком (на Windows это MoveFileEx с REPLACE_EXISTING).
 * На Windows цель иногда занята долю секунды (EPERM, EBUSY, EACCES). Повторяем только rename:
 * тело уже лежит во временном файле, саму цель до успешного rename не трогаем.
 * Обрыв процесса до rename оставляет прежний файл. Временный хвост после kill — ожидаемый мусор, не данные.
 */

import { randomBytes } from 'node:crypto'
import { open, rename, rm, type FileHandle } from 'node:fs/promises'
import path from 'node:path'

export type AtomicHooks = {
  afterChunk?: (index: number) => Promise<void> | void
  /** Подмена rename в тесте. Боевой путь зовёт fs.rename. */
  rename?: (from: string, to: string) => Promise<void>
  pause?: (ms: number) => Promise<void> | void
}

const RENAME_ATTEMPTS = 5
const RETRYABLE_RENAME = new Set(['EPERM', 'EBUSY', 'EACCES'])

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return ''
  }
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : ''
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Повторяет rename, пока цель кратко заблокирована. Другие ошибки — сразу наружу. */
export async function renameReplacing(
  from: string,
  to: string,
  attempt: (from: string, to: string) => Promise<void>,
  pause: (ms: number) => Promise<void> | void,
): Promise<void> {
  for (let n = 1; n <= RENAME_ATTEMPTS; n += 1) {
    try {
      await attempt(from, to)
      return
    } catch (error) {
      const again = RETRYABLE_RENAME.has(errorCode(error)) && n < RENAME_ATTEMPTS
      if (!again) {
        throw error
      }
      await pause(20 * n)
    }
  }
}

const CHUNK = 16 * 1024

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
    await renameReplacing(tmp, target, hooks?.rename ?? rename, hooks?.pause ?? delay)
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
