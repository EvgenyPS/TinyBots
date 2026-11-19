/**
 * FILE: apps/server/src/root.ts
 * НАЗНАЧЕНИЕ: найти корень репозитория по расположению этого модуля.
 * Работает и из src (vitest), и из dist (node): оба лежат на одной глубине.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function repoRoot(): string {
  const start = path.dirname(fileURLToPath(import.meta.url))
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
  throw new Error('Не найден корень TinyBots (demo/bots.json)')
}
