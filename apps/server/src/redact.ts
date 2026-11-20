/**
 * FILE: apps/server/src/redact.ts
 * НАЗНАЧЕНИЕ: не пустить секрет в журнал.
 * ВХОД: значения из .env и текст, который собираемся напечатать.
 * ВЫХОД: та же строка, но известные секреты заменены на [secret].
 * Короткое значение не прячем: иначе «6» или «ok» выедали бы обычные слова.
 */

const secrets = new Set<string>()

export function rememberSecret(value: string | undefined): void {
  if (!value || value.length < 8) {
    return
  }
  secrets.add(value)
}

export function redact(text: string): string {
  let out = text
  for (const secret of secrets) {
    if (secret.length < 8 || !out.includes(secret)) {
      continue
    }
    out = out.split(secret).join('[secret]')
  }
  return out
}

export function logSafe(message: string): void {
  console.info(redact(message))
}
