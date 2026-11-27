/**
 * FILE: apps/server/src/desktop-data.ts
 * НАЗНАЧЕНИЕ: каталог данных окна Tauri.
 * ВХОД: argv с --data-dir, который передала оболочка. Это не папка программы.
 * ВЫХОД: bots.json. Нет файла — создаётся пустой список. Есть — не трогаем.
 * Битый файл не затираем и не удаляем. Браузерный режим этот модуль не включает.
 * Ключи сюда не пишутся: они остаются в keyring.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { botSchema } from '@tinybots/schema'
import { z } from 'zod'

export const DATA_DIR_FLAG = '--data-dir'

/** Пустой список проходит z.array(botSchema). Хвост — перевод строки, чтобы файл был текстом. */
export const EMPTY_BOTS_JSON = '[]\n'

const botsListSchema = z.array(botSchema)

export type BotsEnsure = 'created' | 'kept' | 'invalid'

export function dataDirFromArgv(argv: readonly string[]): string | null {
  const index = argv.indexOf(DATA_DIR_FLAG)
  if (index === -1) {
    return null
  }
  const value = argv[index + 1]
  if (value === undefined || value.length === 0 || value.startsWith('--') || value.includes('\0')) {
    return null
  }
  return path.resolve(value)
}

/** Флаг данных действует только в режиме окна. --browser его игнорирует. */
export function desktopDataDir(kind: 'browser' | 'desktop' | 'refuse', argv: readonly string[]): string | null {
  if (kind !== 'desktop') {
    return null
  }
  return dataDirFromArgv(argv)
}

export function botsFilePath(dir: string): string {
  return path.join(dir, 'bots.json')
}

export function parseBotsList(raw: string): { ok: true; bots: unknown[] } | { ok: false } {
  let data: unknown
  try {
    data = JSON.parse(raw) as unknown
  } catch {
    return { ok: false }
  }
  const parsed = botsListSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false }
  }
  return { ok: true, bots: parsed.data }
}

/**
 * Создаёт пустой список только если файла нет.
 * Существующий файл не открывается на запись: битый остаётся как был.
 */
export function ensureBotsFile(dir: string): BotsEnsure {
  mkdirSync(dir, { recursive: true })
  const file = botsFilePath(dir)
  if (!existsSync(file)) {
    const empty = parseBotsList(EMPTY_BOTS_JSON)
    if (!empty.ok) {
      throw new Error('пустой список ботов не проходит схему')
    }
    try {
      writeFileSync(file, EMPTY_BOTS_JSON, { encoding: 'utf8', flag: 'wx' })
      return 'created'
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code !== 'EEXIST') {
        throw error
      }
    }
  }
  const raw = readFileSync(file, 'utf8')
  if (!parseBotsList(raw).ok) {
    return 'invalid'
  }
  return 'kept'
}

export function loadDesktopBots(dir: string):
  | { status: 200; body: unknown[] }
  | { status: 500; body: { error: 'bots_invalid' | 'bots_unreadable' }; log: string } {
  let raw: string
  try {
    raw = readFileSync(botsFilePath(dir), 'utf8')
  } catch {
    return {
      status: 500,
      body: { error: 'bots_unreadable' },
      log: 'bots.json не прочитан, файл не перезаписан',
    }
  }
  const parsed = parseBotsList(raw)
  if (!parsed.ok) {
    return {
      status: 500,
      body: { error: 'bots_invalid' },
      log: 'bots.json повреждён, файл не перезаписан',
    }
  }
  return { status: 200, body: parsed.bots }
}
