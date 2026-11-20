/**
 * FILE: apps/server/src/llm/secret.ts
 * НАЗНАЧЕНИЕ: взять ключ модели из окружения.
 * ВХОД: имя переменной, уже прошедшее шаблон *_API_KEY.
 * ВЫХОД: значение только для заголовка Authorization. Сразу rememberSecret.
 * В ошибку, лог и data_dir значение не кладём.
 */

import { API_KEY_ENV_PATTERN } from '@tinybots/schema'
import { rememberSecret } from '../redact.js'

export function readApiKey(name: string, env: NodeJS.ProcessEnv = process.env): { ok: true; value: string } | { ok: false; reason: string } {
  if (!API_KEY_ENV_PATTERN.test(name)) {
    return { ok: false, reason: 'имя переменной ключа не подходит' }
  }
  const value = env[name]
  if (value === undefined || value.trim().length === 0) {
    return { ok: false, reason: 'ключа в окружении нет' }
  }
  rememberSecret(value)
  return { ok: true, value }
}
