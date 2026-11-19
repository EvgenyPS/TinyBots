/**
 * FILE: apps/server/src/env.ts
 * НАЗНАЧЕНИЕ: подхватить .env, не печатая значения.
 * Уже заданные переменные окружения не затираем.
 * Полная проверка и отказ от лишних ключей — PR 3 (модуль config).
 */

import { existsSync, readFileSync } from 'node:fs'

export function loadDotEnv(filePath: string): void {
  if (!existsSync(filePath)) {
    return
  }
  const text = readFileSync(filePath, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }
    const eq = line.indexOf('=')
    if (eq <= 0) {
      continue
    }
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue
    }
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
