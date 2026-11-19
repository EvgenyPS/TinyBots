/**
 * FILE: apps/server/src/store/atomic.ts
 * НАЗНАЧЕНИЕ: записать файл так, чтобы читатель видел либо старое, либо новое целиком.
 * ВХОД: путь и тело. Необязательный afterChunk — крюк для теста обрыва.
 * ВЫХОД: файл заменён через rename. Пока идёт запись, цель не трогаем: пишем во временный файл рядом.
 * rename на том же томе в Node — замена целиком (на Windows это MoveFileEx с REPLACE_EXISTING).
 * Обрыв процесса до rename оставляет прежний файл. Временный хвост после kill — ожидаемый мусор, не данные.
 */

import { randomBytes } from 'node:crypto'
import { open, rename, rm, type FileHandle } from 'node:fs/promises'
import path from 'node:path'

export type AtomicHooks = {
  afterChunk?: (index: number) => Promise<void> | void
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
    await rename(tmp, target)
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
