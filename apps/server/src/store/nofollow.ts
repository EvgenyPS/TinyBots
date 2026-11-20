/**
 * FILE: apps/server/src/store/nofollow.ts
 * НАЗНАЧЕНИЕ: читать файл и проверять путь, не идя по симлинку.
 * ВХОД: абсолютный путь. Файла может ещё не быть — тогда проверяем только родителя.
 * ВЫХОД: байты файла или отказ «путь файла».
 * На POSIX открытие с O_NOFOLLOW падает, если последний компонент уже симлинк.
 * Окно между закрытием дескриптора каталога и rename по строке пути остаётся:
 * в Node нет openat. На Windows O_NOFOLLOW нет, там только повторный lstat.
 * Этот остаток описан в docs/files-safety.md.
 */

import path from 'node:path'
import { constants, lstat, open, type FileHandle } from 'node:fs/promises'

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')
}

export function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
}

/** Прочитать обычный файл. Симлинк — отказ, цель симлинка не читаем. */
export async function readNoFollow(file: string): Promise<Buffer> {
  const st = await lstat(file)
  if (st.isSymbolicLink() || !st.isFile()) {
    throw new Error('путь файла')
  }
  const handle = await open(file, constants.O_RDONLY | noFollowFlag())
  try {
    return Buffer.from(await handle.readFile())
  } finally {
    await handle.close()
  }
}

/**
 * Повторная проверка прямо перед записью.
 * Родитель не симлинк. Сам файл либо отсутствует, либо не симлинк.
 * Где есть O_NOFOLLOW, родитель ещё и открывается с этим флагом.
 */
export async function assertPathNotSymlink(file: string): Promise<void> {
  const parent = path.dirname(file)
  const parentStat = await lstat(parent)
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error('путь файла')
  }
  const follow = noFollowFlag()
  if (follow !== 0) {
    const flag = constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | follow
    let handle: FileHandle | undefined
    try {
      handle = await open(parent, flag)
    } catch {
      throw new Error('путь файла')
    } finally {
      await handle?.close()
    }
  }
  try {
    const st = await lstat(file)
    if (st.isSymbolicLink()) {
      throw new Error('путь файла')
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'путь файла') {
      throw error
    }
    if (isEnoent(error)) {
      return
    }
    throw error
  }
}
