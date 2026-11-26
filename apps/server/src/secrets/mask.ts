/**
 * FILE: apps/server/src/secrets/mask.ts
 * НАЗНАЧЕНИЕ: убрать значение закрытого ключа из текста, который увидит бот или журнал.
 * ВХОД: текст и сами значения. Короче 8 символов не трогаем: иначе «ok» съело бы обычные слова.
 * ВЫХОД: текст без значения и его кодировок, либо фраза «ответ похож на ключ», если кусок
 * виден только после склейки и его нельзя вырезать, не оставив хвост.
 * Перед сравнением снимаем JSON-экранирование и percent-encoding до трёх раз.
 * Пробел рвёт base64-серию. Серию и hex читаем со сдвигом, MIME-перенос склеиваем отдельно.
 * Маскируется любой непрерывный кусок от 8 символов.
 */

/** Короче этого порога значение не маскируется. Тот же порог, что у журнала и приёма ключа. */
export const SECRET_MASK_MIN = 8

/** Тело ответа не отдаём: после нормализации ключ всё ещё читается, а вырезать его целиком нельзя. */
export const SECRET_LOOKS_LIKE = 'ответ похож на ключ'

const PLACEHOLDER = /\{\{secret:[A-Z][A-Z0-9_]{0,63}\}\}/g

type Span = { start: number; end: number }

type View = {
  text: string
  from: number[]
  to: number[]
}

function reverseSecret(secret: string): string {
  return [...secret].reverse().join('')
}

function tracked(keys: readonly string[]): string[] {
  const all = new Set<string>()
  for (const key of keys) {
    if (key.length < SECRET_MASK_MIN) {
      continue
    }
    all.add(key)
    const rev = reverseSecret(key)
    if (rev.length >= SECRET_MASK_MIN) {
      all.add(rev)
    }
  }
  return [...all]
}

function pushChar(view: { text: string; from: number[]; to: number[] }, ch: string, start: number, end: number): void {
  view.text += ch
  for (let index = 0; index < ch.length; index += 1) {
    view.from.push(start)
    view.to.push(end)
  }
}

function identity(text: string): View {
  const from: number[] = []
  const to: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    from.push(index)
    to.push(index + 1)
  }
  return { text, from, to }
}

function jsonUnescape(text: string): View {
  const view = { text: '', from: [] as number[], to: [] as number[] }
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\\' || index + 1 >= text.length) {
      pushChar(view, text[index] ?? '', index, index + 1)
      continue
    }
    const next = text[index + 1] ?? ''
    const simple: Record<string, string> = {
      '/': '/',
      '"': '"',
      '\\': '\\',
      n: '\n',
      r: '\r',
      t: '\t',
      b: '\b',
      f: '\f',
    }
    if (Object.hasOwn(simple, next)) {
      pushChar(view, simple[next] ?? '', index, index + 2)
      index += 1
      continue
    }
    if (next === 'u' && /^[0-9a-fA-F]{4}$/u.test(text.slice(index + 2, index + 6))) {
      const code = Number.parseInt(text.slice(index + 2, index + 6), 16)
      const pair = text.slice(index + 6, index + 12)
      if (code >= 0xD800 && code <= 0xDBFF && pair.startsWith('\\u') && /^[0-9a-fA-F]{4}$/u.test(pair.slice(2))) {
        const low = Number.parseInt(pair.slice(2), 16)
        if (low >= 0xDC00 && low <= 0xDFFF) {
          const point = (code - 0xD800) * 0x400 + (low - 0xDC00) + 0x10000
          pushChar(view, String.fromCodePoint(point), index, index + 12)
          index += 11
          continue
        }
      }
      pushChar(view, String.fromCharCode(code), index, index + 6)
      index += 5
      continue
    }
    pushChar(view, text[index] ?? '', index, index + 1)
  }
  return view
}

function isHex(char: string | undefined): boolean {
  return char !== undefined && /^[0-9a-fA-F]$/u.test(char)
}

function percentDecode(text: string): View {
  const view = { text: '', from: [] as number[], to: [] as number[] }
  let index = 0
  while (index < text.length) {
    if (text[index] === '%' && isHex(text[index + 1]) && isHex(text[index + 2])) {
      const bytes: number[] = []
      const ranges: Span[] = []
      while (text[index] === '%' && isHex(text[index + 1]) && isHex(text[index + 2])) {
        bytes.push(Number.parseInt(text.slice(index + 1, index + 3), 16))
        ranges.push({ start: index, end: index + 3 })
        index += 3
      }
      let byte = 0
      while (byte < bytes.length) {
        const lead = bytes[byte] ?? 0
        let need = 1
        if ((lead & 0xE0) === 0xC0) {
          need = 2
        } else if ((lead & 0xF0) === 0xE0) {
          need = 3
        } else if ((lead & 0xF8) === 0xF0) {
          need = 4
        }
        const run = bytes.slice(byte, byte + need)
        const cont = need > 1 && run.length === need && run.slice(1).every((item) => (item & 0xC0) === 0x80)
        if (cont) {
          const start = ranges[byte]?.start ?? index
          const end = ranges[byte + need - 1]?.end ?? index
          pushChar(view, Buffer.from(run).toString('utf8'), start, end)
          byte += need
          continue
        }
        const range = ranges[byte]
        pushChar(view, String.fromCharCode(lead), range?.start ?? index, range?.end ?? index)
        byte += 1
      }
      continue
    }
    pushChar(view, text[index] ?? '', index, index + 1)
    index += 1
  }
  return view
}

function compose(outer: View, inner: View): View {
  const from = inner.from.map((at) => outer.from[at] ?? 0)
  const to = inner.to.map((at) => outer.to[at - 1] ?? outer.to[outer.to.length - 1] ?? 0)
  return { text: inner.text, from, to }
}

function viewOk(view: View): boolean {
  return view.from.length === view.text.length && view.to.length === view.text.length
}

/** Непрерывные куски ключа от порога. Индекс 8-грамм сужает сравнение. */
function chunkSpans(text: string, secret: string): Span[] {
  if (secret.length < SECRET_MASK_MIN || text.length < SECRET_MASK_MIN) {
    return []
  }
  const grams = new Map<string, number[]>()
  for (let index = 0; index <= secret.length - SECRET_MASK_MIN; index += 1) {
    const gram = secret.slice(index, index + SECRET_MASK_MIN)
    const list = grams.get(gram)
    if (list) {
      list.push(index)
    } else {
      grams.set(gram, [index])
    }
  }
  const spans: Span[] = []
  let index = 0
  while (index <= text.length - SECRET_MASK_MIN) {
    const list = grams.get(text.slice(index, index + SECRET_MASK_MIN))
    if (!list) {
      index += 1
      continue
    }
    let best = 0
    for (const at of list) {
      let len = 0
      const max = Math.min(secret.length - at, text.length - index)
      while (len < max && text.charCodeAt(index + len) === secret.charCodeAt(at + len)) {
        len += 1
      }
      if (len > best) {
        best = len
      }
    }
    if (best >= SECRET_MASK_MIN) {
      spans.push({ start: index, end: index + best })
      index += best
      continue
    }
    index += 1
  }
  return spans
}

function mappedSpans(view: View, keys: readonly string[]): Span[] {
  if (!viewOk(view)) {
    return []
  }
  const spans: Span[] = []
  for (const key of keys) {
    for (const span of chunkSpans(view.text, key)) {
      const start = view.from[span.start]
      const end = view.to[span.end - 1]
      if (start === undefined || end === undefined || end <= start) {
        continue
      }
      spans.push({ start, end })
    }
  }
  return spans
}

function isBase64Char(char: string): boolean {
  return /[A-Za-z0-9+/_=-]/u.test(char)
}

function isGap(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

function decodedHasKey(decoded: string, keys: readonly string[]): boolean {
  return keys.some((key) => chunkSpans(decoded, key).length > 0)
}

/** Сдвиг 0..3: префикс вроде abc или Basic не должен сбивать квант base64. */
function shiftsHit(raw: string, keys: readonly string[]): boolean {
  for (let shift = 0; shift < 4; shift += 1) {
    const cleaned = raw.slice(shift).replace(/-/gu, '+').replace(/_/gu, '/').replace(/[^A-Za-z0-9+/]/gu, '')
    if (cleaned.length < 12) {
      continue
    }
    const padded = cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4)
    const decoded = Buffer.from(padded, 'base64').toString('utf8')
    if (decodedHasKey(decoded, keys)) {
      return true
    }
  }
  return false
}

function gapOnly(text: string, from: number, to: number): boolean {
  if (from >= to) {
    return false
  }
  for (let index = from; index < to; index += 1) {
    if (!isGap(text[index] ?? '')) {
      return false
    }
  }
  return true
}

function hasBreak(text: string, from: number, to: number): boolean {
  const gap = text.slice(from, to)
  return gap.includes('\n') || gap.includes('\r')
}

function base64Spans(text: string, keys: readonly string[]): Span[] {
  const spans: Span[] = []
  const runs: Span[] = []
  let index = 0
  while (index < text.length) {
    if (!isBase64Char(text[index] ?? '')) {
      index += 1
      continue
    }
    const start = index
    while (index < text.length && isBase64Char(text[index] ?? '')) {
      index += 1
    }
    const run = text.slice(start, index)
    runs.push({ start, end: index })
    if (shiftsHit(run, keys)) {
      spans.push({ start, end: index })
    }
  }
  let cursor = 0
  while (cursor < runs.length) {
    let last = cursor
    while (last + 1 < runs.length) {
      const left = runs[last]
      const right = runs[last + 1]
      if (!left || !right || !gapOnly(text, left.end, right.start) || !hasBreak(text, left.end, right.start)) {
        break
      }
      last += 1
    }
    if (last > cursor) {
      const head = runs[cursor]
      const tail = runs[last]
      if (head && tail) {
        const joined = runs.slice(cursor, last + 1).map((run) => text.slice(run.start, run.end)).join('')
        if (shiftsHit(joined, keys)) {
          spans.push({ start: head.start, end: tail.end })
        }
      }
    }
    cursor = last + 1
  }
  return spans
}

function hexSpans(text: string, keys: readonly string[]): Span[] {
  const spans: Span[] = []
  for (const match of text.matchAll(/[0-9a-fA-F]{16,}/gu)) {
    const raw = match[0]
    if (match.index === undefined) {
      continue
    }
    for (const offset of [0, 1]) {
      const slice = raw.slice(offset)
      const even = slice.length % 2 === 0 ? slice : slice.slice(0, -1)
      if (even.length < 16) {
        continue
      }
      const decoded = Buffer.from(even, 'hex').toString('utf8')
      if (decodedHasKey(decoded, keys)) {
        spans.push({ start: match.index + offset, end: match.index + offset + even.length })
      }
    }
  }
  return spans
}

/** До трёх проходов: %252F сначала становится %2F, затем слэшем. */
function unfoldPercent(outer: View): View {
  let view = outer
  for (let step = 0; step < 3; step += 1) {
    const next = percentDecode(view.text)
    if (next.text === view.text) {
      return view
    }
    view = compose(view, next)
    if (!viewOk(view)) {
      return view
    }
  }
  return view
}

function views(text: string): View[] {
  const json = jsonUnescape(text)
  const percent = unfoldPercent(identity(text))
  return [
    identity(text),
    json,
    percent,
    unfoldPercent(json),
    compose(percent, jsonUnescape(percent.text)),
  ]
}

function compact(text: string): string {
  return text.replace(/\s+/gu, '')
}

function leaks(text: string, keys: readonly string[]): boolean {
  if (keys.length === 0) {
    return false
  }
  const texts = views(text).map((view) => view.text)
  for (const view of texts) {
    const packed = compact(view)
    for (const key of keys) {
      if (chunkSpans(view, key).length > 0 || chunkSpans(packed, key).length > 0) {
        return true
      }
    }
  }
  return base64Spans(text, keys).length > 0 || hexSpans(text, keys).length > 0
}

function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].filter((span) => span.end > span.start).sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Span[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (!last || span.start > last.end) {
      merged.push({ ...span })
      continue
    }
    if (span.end > last.end) {
      last.end = span.end
    }
  }
  return merged
}

function applySpans(text: string, spans: readonly Span[]): string {
  const merged = mergeSpans(spans)
  let out = ''
  let cursor = 0
  for (const span of merged) {
    if (span.start < cursor || span.end > text.length) {
      return SECRET_LOOKS_LIKE
    }
    out += text.slice(cursor, span.start)
    out += '[secret]'
    cursor = span.end
  }
  return out + text.slice(cursor)
}

function collect(text: string, keys: readonly string[]): Span[] | null {
  const spans: Span[] = []
  for (const view of views(text)) {
    if (!viewOk(view)) {
      return null
    }
    spans.push(...mappedSpans(view, keys))
  }
  spans.push(...base64Spans(text, keys), ...hexSpans(text, keys))
  return spans
}

/**
 * Маска одного текста. Ссылка {{secret:NAME}} убирается всегда:
 * в промпт боту её кладёт описание инструмента, а в ответ и журнал она не возвращается.
 */
export function maskClosedChannel(text: string, secrets: readonly string[]): string {
  const keys = tracked(secrets)
  const out = text.replace(PLACEHOLDER, '[secret]')
  if (keys.length === 0) {
    return out
  }
  const spans = collect(out, keys)
  if (spans === null) {
    return SECRET_LOOKS_LIKE
  }
  const masked = spans.length === 0 ? out : applySpans(out, spans)
  if (masked === SECRET_LOOKS_LIKE || leaks(masked, keys)) {
    return SECRET_LOOKS_LIKE
  }
  return masked
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
