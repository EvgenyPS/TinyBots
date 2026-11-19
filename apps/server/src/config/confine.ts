/**
 * FILE: apps/server/src/config/confine.ts
 * НАЗНАЧЕНИЕ: не пустить запись и проверку пути из корня по символической ссылке.
 * ВХОД: корень репозитория и абсолютный путь. Файла по нему может ещё не быть.
 * ВЫХОД: true, если ближайший существующий предок реально внутри корня,
 * а оставшийся хвост не поднимается выше этого предка.
 * locateConfig смотрит на текст. Ссылка с именем внутри корня может вести наружу.
 */

import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

function existingAncestor(start: string): string {
  let dir = start
  while (!existsSync(dir)) {
    const parent = path.dirname(dir)
    if (parent === dir) {
      return dir
    }
    dir = parent
  }
  return dir
}

export function staysInRoot(root: string, absolute: string): boolean {
  let rootReal: string
  try {
    rootReal = realpathSync(root)
  } catch {
    return false
  }
  const ancestor = existingAncestor(absolute)
  let ancestorReal: string
  try {
    ancestorReal = realpathSync(ancestor)
  } catch {
    return false
  }
  const fromRoot = path.relative(rootReal, ancestorReal)
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
    return false
  }
  const rest = path.relative(ancestor, absolute)
  return rest.length === 0 || (!rest.startsWith('..') && !path.isAbsolute(rest))
}
