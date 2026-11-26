/**
 * FILE: apps/server/src/redact.ts
 * НАЗНАЧЕНИЕ: не пустить секрет в журнал.
 * ВХОД: значения из .env и текст, который собираемся напечатать.
 * ВЫХОД: та же строка, но известные секреты заменены на [secret].
 * Короткое значение не прячем: иначе «6» или «ok» выедали бы обычные слова.
 */

import { maskClosedChannel } from './secrets/mask.js'

const secrets = new Set<string>()

export function rememberSecret(value: string | undefined): void {
  if (!value || value.length < 8) {
    return
  }
  secrets.add(value)
}

/** Значения, которые уже видел этот процесс. В окружение детей их не кладём. */
export function knownSecrets(): string[] {
  return [...secrets]
}

/** Только для тестов: процесс не должен тащить канарейку в следующий файл. */
export function forgetSecrets(): void {
  secrets.clear()
}

export function redact(text: string): string {
  return maskClosedChannel(text, knownSecrets())
}

export function logSafe(message: string): void {
  console.info(redact(message))
}
