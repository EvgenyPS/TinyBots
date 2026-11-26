/**
 * FILE: apps/server/src/secrets/mask.ts
 * НАЗНАЧЕНИЕ: убрать значение закрытого ключа из текста, который увидит бот или журнал.
 * ВХОД: текст и сами значения. Короткое значение не трогаем: иначе «ok» съело бы обычные слова.
 * ВЫХОД: тот же текст, но значение и его кодировки заменены на [secret].
 * Один проход по каждой форме: подставленный текст повторно не разбирается.
 * Части ответа склеиваются до замены, чтобы значение, разрезанное между ними, тоже пропало.
 */

/** Короче этого порога значение не маскируется. Тот же порог, что у журнала. */
export const SECRET_MASK_MIN = 8

const PLACEHOLDER = /\{\{secret:[A-Z][A-Z0-9_]{0,63}\}\}/g

function jsonEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

function variants(secret: string): string[] {
  if (secret.length < SECRET_MASK_MIN) {
    return []
  }
  const raw = [
    secret,
    Buffer.from(secret, 'utf8').toString('base64'),
    Buffer.from(secret, 'utf8').toString('base64url'),
    encodeURIComponent(secret),
    Buffer.from(secret, 'utf8').toString('hex'),
    Buffer.from(secret, 'utf8').toString('hex').toUpperCase(),
    jsonEscape(secret),
  ]
  return [...new Set(raw.filter((item) => item.length >= SECRET_MASK_MIN))]
}

/** Токены base64, внутри которых лежит значение, включая Basic user:pass. */
function maskBase64(text: string, secrets: readonly string[]): string {
  const live = secrets.filter((item) => item.length >= SECRET_MASK_MIN)
  if (live.length === 0) {
    return text
  }
  return text.replace(/[A-Za-z0-9+/_-]{12,}={0,2}/g, (token) => {
    const normalized = token.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    let decoded = ''
    try {
      decoded = Buffer.from(padded, 'base64').toString('utf8')
    } catch {
      return token
    }
    if (live.some((secret) => decoded.includes(secret))) {
      return '[secret]'
    }
    return token
  })
}

/**
 * Маска одного текста. Ссылка {{secret:NAME}} убирается всегда:
 * в промпт боту её кладёт описание инструмента, а в ответ и журнал она не возвращается.
 */
export function maskClosedChannel(text: string, secrets: readonly string[]): string {
  let out = text.replace(PLACEHOLDER, '[secret]')
  for (const secret of secrets) {
    for (const form of variants(secret)) {
      if (out.includes(form)) {
        out = out.split(form).join('[secret]')
      }
    }
  }
  return maskBase64(out, secrets)
}

/**
 * Склейка частей до маски. Возврат режется по исходным длинам, только если длина не изменилась.
 * Если замена съела значение на границе, вся склейка лежит в первой части: join снова без секрета.
 */
export function maskParts(parts: readonly string[], secrets: readonly string[]): string[] {
  const whole = parts.join('')
  const masked = maskClosedChannel(whole, secrets)
  if (masked.length === whole.length) {
    const out: string[] = []
    let offset = 0
    for (const part of parts) {
      out.push(masked.slice(offset, offset + part.length))
      offset += part.length
    }
    return out
  }
  return [masked, ...parts.slice(1).map(() => '')]
}
