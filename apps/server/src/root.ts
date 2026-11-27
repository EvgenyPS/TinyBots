/**
 * FILE: apps/server/src/root.ts
 * НАЗНАЧЕНИЕ: найти корень репозитория по расположению этого модуля.
 * Работает и из src (vitest), и из dist (node): оба лежат на одной глубине.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runningAsSea } from './llm/keyring-native.js'

function findRoot(start: string): string | null {
  let dir = start
  for (let hop = 0; hop < 8; hop += 1) {
    if (existsSync(path.join(dir, 'demo', 'bots.json')) && existsSync(path.join(dir, 'package.json'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return null
}

export function repoRoot(): string {
  const starts: string[] = []
  try {
    starts.push(path.dirname(fileURLToPath(import.meta.url)))
  } catch {
    // В SEA адрес модуля может не быть файлом на диске.
  }
  starts.push(process.cwd())
  starts.push(path.dirname(process.execPath))
  for (const start of starts) {
    const found = findRoot(start)
    if (found) {
      return found
    }
  }
  // Установленное окно не лежит в репозитории. Каталог задаёт Tauri, конфиг создаст мастер.
  if (runningAsSea()) {
    return process.cwd()
  }
  throw new Error('Не найден корень TinyBots (demo/bots.json)')
}
