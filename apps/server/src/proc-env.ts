/**
 * FILE: apps/server/src/proc-env.ts
 * НАЗНАЧЕНИЕ: окружение дочернего процесса без ключей.
 * ВХОД: process.env и значения, которые уже помнит журнал.
 * ВЫХОД: короткий набор служебных переменных. Ключи *_API_KEY и значения из хранилища не копируются.
 * В process.env родителя значение из хранилища не записывается: эта функция только читает.
 */

import { API_KEY_ENV_PATTERN } from '@tinybots/schema'
import { knownSecrets } from './redact.js'

/** То, без чего дочерний процесс не откроет git, браузер или связку Secret Service. */
const ALLOW = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'SYSTEMDRIVE',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS',
  'XDG_CURRENT_DESKTOP',
  'XAUTHORITY',
] as const

function carriesSecret(value: string, secrets: readonly string[]): boolean {
  return secrets.some((secret) => secret.length >= 8 && value.includes(secret))
}

/** Узкое окружение. Чужие переменные родителя, даже безобидные, сюда не входят. */
export function minimalChildEnv(secrets: readonly string[] = knownSecrets()): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ALLOW) {
    if (API_KEY_ENV_PATTERN.test(key)) {
      continue
    }
    const value = process.env[key]
    if (value === undefined || carriesSecret(value, secrets)) {
      continue
    }
    env[key] = value
  }
  return env
}

/** Срезать ключи и значения из уже собранного окружения (git собирает своё и потом чистит). */
export function withoutSecrets(env: NodeJS.ProcessEnv, secrets: readonly string[] = knownSecrets()): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (API_KEY_ENV_PATTERN.test(key)) {
      continue
    }
    if (typeof value === 'string' && carriesSecret(value, secrets)) {
      continue
    }
    next[key] = value
  }
  return next
}

/** Имя или значение секрета всё ещё лежит в окружении. Для теста дочерних процессов. */
export function secretInEnv(env: NodeJS.ProcessEnv, names: readonly string[], values: readonly string[]): boolean {
  for (const name of names) {
    if (env[name] !== undefined) {
      return true
    }
  }
  for (const value of Object.values(env)) {
    if (typeof value === 'string' && values.some((secret) => secret.length >= 8 && value.includes(secret))) {
      return true
    }
  }
  return false
}
