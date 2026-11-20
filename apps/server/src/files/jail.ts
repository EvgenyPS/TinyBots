/**
 * FILE: apps/server/src/files/jail.ts
 * НАЗНАЧЕНИЕ: не отдать файл вне папки source.files.path.
 * ВХОД: корень папки проекта (уже realpath) и относительный запрос.
 * ВЫХОД: абсолютный путь внутри корня или null.
 * ../, абсолютный путь, обратный слеш, UNC и симлинк — отказ.
 * Содержимое цели симлинка не читаем и не кладём в ответ.
 */

import path from 'node:path'
import { lstat, realpath } from 'node:fs/promises'
import { isContainedPath } from '@tinybots/schema'

export function staysIn(rootReal: string, candidate: string): boolean {
  const rel = path.relative(rootReal, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function isUnc(value: string): boolean {
  return value.replace(/\\/g, '/').startsWith('//')
}

/** Запрос снаружи. null — путь нельзя даже резолвить. */
export function requestAllowed(rel: string): boolean {
  if (rel.length === 0 || rel.length > 300 || isUnc(rel) || rel.includes(':') || rel.includes('\0')) {
    return false
  }
  return isContainedPath(rel)
}

/**
 * Обычный файл или каталог внутри корня.
 * Симлинк на любом шаге — null, даже если цель тоже внутри.
 */
export async function resolveInside(rootReal: string, rel: string): Promise<string | null> {
  if (!requestAllowed(rel)) {
    return null
  }
  const parts = rel.split('/')
  let current = rootReal
  for (const part of parts) {
    if (part.length === 0 || part === '.' || part === '..') {
      return null
    }
    const next = path.join(current, part)
    let st: Awaited<ReturnType<typeof lstat>>
    try {
      st = await lstat(next)
    } catch {
      return null
    }
    if (st.isSymbolicLink()) {
      return null
    }
    let real: string
    try {
      real = await realpath(next)
    } catch {
      return null
    }
    if (!staysIn(rootReal, real)) {
      return null
    }
    current = real
  }
  return current
}
