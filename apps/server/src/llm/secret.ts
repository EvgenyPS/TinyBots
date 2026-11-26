/**
 * FILE: apps/server/src/llm/secret.ts
 * НАЗНАЧЕНИЕ: взять ключ своего бота.
 * ВХОД: имя переменной. Сначала хранилище ОС (сервис tinybots), затем окружение после .env.
 * ВЫХОД: значение только для заголовка Authorization. Сразу rememberSecret.
 * В ошибку, лог и data_dir значение не кладём. Сбой хранилища не печатаем и не роняем процесс.
 */

import { API_KEY_ENV_PATTERN } from '@tinybots/schema'
import { z } from 'zod'
import { rememberSecret } from '../redact.js'
import { readOsSecret } from './os-secret.js'

/**
 * Имя ключа своего бота: заглавные A–Z, цифры и _.
 * Суффикс _API_KEY тот же, что в конфиге: GITHUB_TOKEN и PATH сюда не проходят.
 */
export const apiKeyNameSchema = z.string().regex(API_KEY_ENV_PATTERN, 'имя переменной *_API_KEY')

export type ApiKeyResult = { ok: true; value: string } | { ok: false; reason: string }

let osReader: (name: string) => string | null = readOsSecret

/** Подмена хранилища в тестах. null возвращает настоящий читатель. */
export function useOsSecretReader(reader: ((name: string) => string | null) | null): void {
  osReader = reader ?? readOsSecret
}

function fromEnv(name: string, env: NodeJS.ProcessEnv): string | null {
  const value = env[name]
  if (value === undefined || value.trim().length === 0) {
    return null
  }
  return value
}

export function readApiKey(name: string, env: NodeJS.ProcessEnv = process.env): ApiKeyResult {
  const parsed = apiKeyNameSchema.safeParse(name)
  if (!parsed.success) {
    return { ok: false, reason: 'имя переменной ключа не подходит' }
  }
  let fromOs: string | null = null
  try {
    const raw = osReader(parsed.data)
    fromOs = raw !== null && raw.trim().length > 0 ? raw : null
  } catch {
    // Читатель теста или обёртка модуля бросили исключение. Берём .env и молчим.
    fromOs = null
  }
  const value = fromOs ?? fromEnv(parsed.data, env)
  if (value === null) {
    return { ok: false, reason: 'ключа нет' }
  }
  rememberSecret(value)
  const unused = fromOs === null ? null : fromEnv(parsed.data, env)
  if (unused !== null) {
    rememberSecret(unused)
  }
  return { ok: true, value }
}
