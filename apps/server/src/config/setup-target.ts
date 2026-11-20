/**
 * FILE: apps/server/src/config/setup-target.ts
 * НАЗНАЧЕНИЕ: куда мастер имеет право положить config.
 * ВХОД: корень и явный путь (аргумент запуска или TINYBOTS_CONFIG).
 * ВЫХОД: относительная цель. Тело запроса цель не выбирает.
 * Нет своего файла — пишем config.yaml в корне и считаем, что мастер нужен.
 * Пустой файл (обрыв записи) тоже мастер: разбирать там нечего.
 * demo/ и config.example.yaml не трогаем даже с подтверждением.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { staysInRoot } from './confine.js'
import { locateConfig } from './load.js'

export type SetupTarget =
  | {
      ok: true
      target: string
      absolute: string
      exists: boolean
      required: boolean
      writable: boolean
      demo: boolean
    }
  | { ok: false; reason: string }

function writeBlocked(display: string): boolean {
  const posix = display.split('\\').join('/')
  if (posix === 'config.example.yaml') {
    return true
  }
  return posix === 'demo' || posix.startsWith('demo/')
}

/** Пустой или из одних пробелов файл — это не конфиг, а след оборванной записи. */
export function isBlankFile(absolute: string): boolean {
  if (!existsSync(absolute)) {
    return false
  }
  try {
    return readFileSync(absolute, 'utf8').trim().length === 0
  } catch {
    return false
  }
}

export function resolveSetupTarget(root: string, explicit?: string): SetupTarget {
  const fromCall = explicit?.trim() ?? ''
  const fromEnv = fromCall.length > 0 ? '' : (process.env.TINYBOTS_CONFIG?.trim() ?? '')
  const chosen = fromCall || fromEnv

  if (chosen.length === 0) {
    const target = 'config.yaml'
    const absolute = path.resolve(root, target)
    const onDisk = existsSync(absolute)
    const blank = onDisk && isBlankFile(absolute)
    const outside = onDisk && !staysInRoot(root, absolute)
    return {
      ok: true,
      target,
      absolute,
      exists: onDisk && !blank,
      required: !onDisk || blank,
      writable: !outside,
      demo: !onDisk || blank,
    }
  }

  const located = locateConfig(root, chosen)
  if ('ok' in located) {
    return { ok: false, reason: located.reason }
  }
  const onDisk = existsSync(located.absolute)
  const blank = onDisk && isBlankFile(located.absolute)
  const outside = !staysInRoot(root, located.absolute)
  const blocked = writeBlocked(located.display) || outside
  return {
    ok: true,
    target: located.display,
    absolute: located.absolute,
    exists: onDisk && !blank,
    required: (!onDisk || blank) && !blocked,
    writable: !blocked,
    demo: false,
  }
}
