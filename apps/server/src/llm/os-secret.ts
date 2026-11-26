/**
 * FILE: apps/server/src/llm/os-secret.ts
 * НАЗНАЧЕНИЕ: прочитать значение ключа своего бота из хранилища ОС.
 * ВХОД: имя переменной (учётная запись). Сервис всегда `tinybots`.
 * ВЫХОД: строка или null. null — записи нет, модуль не загрузился или хранилище недоступно.
 * Ошибка не печатается: в тексте исключения может оказаться само значение.
 * На Linux требуется Secret Service. Ядро keyutils не используем: оно не переживает перезагрузку
 * и на headless-машине притворялось бы хранилищем. Нет Secret Service — тихий отказ, дальше .env.
 */

import { createRequire } from 'node:module'
import type { Entry } from '@napi-rs/keyring'

/** Сервис в Credential Manager, Keychain и Secret Service. */
export const OS_SECRET_SERVICE = 'tinybots'

/**
 * На Linux без этого флага библиотека молча падает в keyutils.
 * Флаг на Windows и macOS игнорируется.
 */
export const OS_SECRET_OPTIONS = { linux: { store: 'secret-service' as const } }

export type OsKeyring = {
  Entry: new (
    service: string,
    account: string,
    options?: { linux?: { store?: 'secret-service' | 'keyutils' } },
  ) => Pick<Entry, 'getPassword'>
}

const require = createRequire(import.meta.url)

let loaded: OsKeyring | null | undefined

/**
 * Модуль кэшируем: повторный require нативного бинарника не нужен.
 * Неудачную загрузку тоже запоминаем, чтобы чат не пытался грузить его на каждое сообщение.
 * Ошибку самого хранилища не кэшируем: связка может появиться позже, в том же процессе.
 */
export function loadOsKeyring(): OsKeyring | null {
  if (loaded !== undefined) {
    return loaded
  }
  try {
    loaded = require('@napi-rs/keyring') as OsKeyring
  } catch {
    loaded = null
  }
  return loaded
}

/** Сброс кэша модуля. Нужен тестам, в рантайме не вызывается. */
export function resetOsKeyringCache(): void {
  loaded = undefined
}

function blank(value: string | null): boolean {
  return value === null || value.trim().length === 0
}

/**
 * Прочитать пароль учётной записи.
 * load подменяется в тестах. Исключение из конструктора или getPassword — это недоступное хранилище.
 */
export function readOsSecret(name: string, load: () => OsKeyring | null = loadOsKeyring): string | null {
  let keyring: OsKeyring | null
  try {
    keyring = load()
  } catch {
    return null
  }
  if (!keyring) {
    return null
  }
  try {
    const entry = new keyring.Entry(OS_SECRET_SERVICE, name, OS_SECRET_OPTIONS)
    const value = entry.getPassword()
    if (blank(value)) {
      return null
    }
    return value
  } catch {
    return null
  }
}
