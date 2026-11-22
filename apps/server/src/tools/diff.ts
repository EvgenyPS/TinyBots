/**
 * FILE: apps/server/src/tools/diff.ts
 * НАЗНАЧЕНИЕ: разобрать unified diff и наложить его на байты строго, без fuzz.
 * ВХОД: текст diff и карта текущих файлов. Новый файл — пустые байты и --- /dev/null.
 * ВЫХОД: итоговые байты или отказ. Удаление, переименование, режимы и бинарный патч не проходят.
 * Только UTF-8: невалидные байты — отказ, без подмены кодировки.
 * Окончания строк сохраняются построчно, BOM тоже. Противоречивый маркер «нет перевода строки» — отказ.
 */

import { DELETE_LINE_RATIO_MAX, DIFF_FILE_MAX, DIFF_FILES_MAX, DIFF_MAX } from './limits.js'

export type AppliedFile = {
  path: string
  isNew: boolean
  before: Buffer
  after: Buffer
}

const MODE_LINE = /^(?:old mode|new mode|deleted file mode|new file mode|rename |copy |similarity |dissimilarity )/
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

type HunkLine = { kind: ' ' | '+' | '-'; text: string }

type Hunk = {
  oldStart: number
  oldCount: number
  lines: HunkLine[]
  noNewline: boolean
}

type FileDiff = {
  path: string
  isNew: boolean
  hunks: Hunk[]
  noNewline: boolean
}

function stripPrefix(header: string, mark: 'a' | 'b'): string | null {
  if (header === '/dev/null') {
    return null
  }
  const prefix = `${mark}/`
  if (!header.startsWith(prefix)) {
    return null
  }
  return header.slice(prefix.length)
}

export function parseUnifiedDiff(diff: string): { ok: true; files: FileDiff[] } | { ok: false; reason: string } {
  if (Buffer.byteLength(diff) > DIFF_MAX) {
    return { ok: false, reason: 'дифф больше 256 КиБ' }
  }
  if (diff.includes('GIT binary patch') || diff.includes('Binary files ')) {
    return { ok: false, reason: 'бинарный патч' }
  }
  const lines = diff.split(/\n/u)
  const files: FileDiff[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.length === 0) {
      index += 1
      continue
    }
    if (line.startsWith('diff --git ')) {
      index += 1
      continue
    }
    if (MODE_LINE.test(line) || line.startsWith('index ')) {
      if (MODE_LINE.test(line)) {
        return { ok: false, reason: 'режим или переименование' }
      }
      index += 1
      continue
    }
    if (!line.startsWith('--- ')) {
      return { ok: false, reason: 'нет заголовка ---' }
    }
    const oldHeader = line.slice(4).split('\t')[0] ?? ''
    const next = lines[index + 1] ?? ''
    if (!next.startsWith('+++ ')) {
      return { ok: false, reason: 'нет заголовка +++' }
    }
    const newHeader = next.slice(4).split('\t')[0] ?? ''
    const oldPath = stripPrefix(oldHeader, 'a')
    const newPath = stripPrefix(newHeader, 'b')
    if (newHeader === '/dev/null' || (oldPath && newPath && oldPath !== newPath)) {
      return { ok: false, reason: 'удаление или переименование' }
    }
    if (!newPath) {
      return { ok: false, reason: 'путь' }
    }
    if (oldHeader !== '/dev/null' && !oldPath) {
      return { ok: false, reason: 'путь' }
    }
    index += 2
    const hunks: Hunk[] = []
    let fileNoNl = false
    while (index < lines.length && (lines[index] ?? '').startsWith('@@')) {
      const header = HUNK.exec(lines[index] ?? '')
      if (!header) {
        return { ok: false, reason: 'битый @@' }
      }
      const oldStart = Number(header[1])
      const oldCount = header[2] === undefined ? 1 : Number(header[2])
      index += 1
      const hunkLines: HunkLine[] = []
      let noNewline = false
      let seenMarker = false
      while (index < lines.length) {
        const raw = lines[index] ?? ''
        if (raw.startsWith('@@') || raw.startsWith('diff --git ') || raw.startsWith('--- ')) {
          break
        }
        if (raw === '\\ No newline at end of file') {
          if (seenMarker || hunkLines.length === 0) {
            return { ok: false, reason: 'противоречивый перевод строки' }
          }
          seenMarker = true
          noNewline = true
          fileNoNl = true
          index += 1
          continue
        }
        if (seenMarker) {
          return { ok: false, reason: 'противоречивый перевод строки' }
        }
        if (raw.startsWith('+')) {
          hunkLines.push({ kind: '+', text: raw.slice(1) })
        } else if (raw.startsWith('-')) {
          hunkLines.push({ kind: '-', text: raw.slice(1) })
        } else if (raw.startsWith(' ')) {
          hunkLines.push({ kind: ' ', text: raw.slice(1) })
        } else if (raw.length === 0 && index === lines.length - 1) {
          break
        } else {
          return { ok: false, reason: 'битая строка diff' }
        }
        index += 1
      }
      const oldSeen = hunkLines.filter((item) => item.kind !== '+').length
      if (oldSeen !== oldCount && !(oldStart === 0 && oldCount === 0 && oldSeen === 0)) {
        return { ok: false, reason: 'счётчик @@' }
      }
      hunks.push({ oldStart, oldCount, lines: hunkLines, noNewline })
    }
    files.push({ path: newPath, isNew: oldHeader === '/dev/null', hunks, noNewline: fileNoNl })
  }
  if (files.length === 0 || files.length > DIFF_FILES_MAX) {
    return { ok: false, reason: files.length === 0 ? 'пустой diff' : 'больше 20 файлов' }
  }
  const seen = new Set<string>()
  for (const file of files) {
    if (seen.has(file.path)) {
      return { ok: false, reason: 'файл повторяется' }
    }
    seen.add(file.path)
  }
  return { ok: true, files }
}

function splitLf(text: string): { lines: string[]; trailing: boolean } {
  if (text.length === 0) {
    return { lines: [], trailing: false }
  }
  const trailing = text.endsWith('\n')
  const body = trailing ? text.slice(0, -1) : text
  return { lines: body.split('\n'), trailing }
}

type SourceLine = { text: string; nl: '\n' | '\r\n' | '' }

function applyOne(file: FileDiff, lines: SourceLine[]): { ok: true; text: string } | { ok: false; reason: string } {
  const originalLen = lines.reduce((sum, line) => sum + line.text.length + line.nl.length, 0)
  if (file.isNew && originalLen > 0) {
    return { ok: false, reason: 'файл уже есть' }
  }
  if (file.hunks.length === 0) {
    return { ok: false, reason: 'нет хунка' }
  }
  // Смешанный файл не схлопываем в один стиль: новая строка берёт LF, кроме целиком CRLF.
  const fresh: '\n' | '\r\n' = uniformCrlf(lines) ? '\r\n' : '\n'
  const out: SourceLine[] = []
  let cursor = 0
  for (const hunk of file.hunks) {
    const start = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1
    if (start < cursor || start > lines.length) {
      return { ok: false, reason: 'контекст не совпал' }
    }
    out.push(...lines.slice(cursor, start))
    cursor = start
    for (const line of hunk.lines) {
      if (line.kind === '+') {
        out.push({ text: line.text, nl: fresh })
        continue
      }
      const src = lines[cursor]
      if (!src || src.text !== line.text) {
        return { ok: false, reason: 'контекст не совпал' }
      }
      if (line.kind === ' ') {
        out.push(src)
      }
      cursor += 1
    }
  }
  out.push(...lines.slice(cursor))
  if (out.length === 0) {
    return { ok: true, text: '' }
  }
  const last = out[out.length - 1]
  if (!last) {
    return { ok: true, text: '' }
  }
  if (file.noNewline) {
    out[out.length - 1] = { text: last.text, nl: '' }
  } else if (last.nl === '') {
    const touchesEnd = file.hunks.some((hunk) => {
      const start = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1
      return start + hunk.lines.filter((line) => line.kind !== '+').length >= lines.length
    })
    if (file.isNew || touchesEnd) {
      out[out.length - 1] = { text: last.text, nl: fresh }
    }
  }
  return { ok: true, text: out.map((line) => line.text + line.nl).join('') }
}

/**
 * Пустой итог или убыль числа строк строго больше половины.
 * Замена строки на строку убыли не даёт: минус в хунке сам по себе не запрет.
 */
function asLf(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

function deletionRefusal(before: string, after: string): string | null {
  const left = asLf(before)
  const right = asLf(after)
  const beforeBody = left.replace(/\s/g, '')
  const afterBody = right.replace(/\s/g, '')
  if (beforeBody.length > 0 && afterBody.length === 0) {
    return 'файл станет пустым'
  }
  const originalLines = splitLf(left).lines.length
  if (originalLines === 0) {
    return null
  }
  const nextLines = splitLf(right).lines.length
  if ((originalLines - nextLines) / originalLines > DELETE_LINE_RATIO_MAX) {
    return 'удалено больше половины файла'
  }
  return null
}

/** Строгий UTF-8. BOM снимается до разбора и возвращается при записи. Невалидные байты не подменяются. */
function decodeStrict(bytes: Buffer): { ok: true; bom: boolean; text: string } | { ok: false; reason: string } {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const body = bom ? bytes.subarray(3) : bytes
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    return { ok: true, bom, text }
  } catch {
    return { ok: false, reason: 'не utf-8' }
  }
}

function splitKeep(text: string): SourceLine[] {
  if (text.length === 0) {
    return []
  }
  const lines: SourceLine[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\n') {
      continue
    }
    const cr = index > start && text[index - 1] === '\r'
    lines.push({ text: text.slice(start, cr ? index - 1 : index), nl: cr ? '\r\n' : '\n' })
    start = index + 1
  }
  if (start < text.length) {
    lines.push({ text: text.slice(start), nl: '' })
  }
  return lines
}

function uniformCrlf(lines: SourceLine[]): boolean {
  let crlf = false
  for (const line of lines) {
    if (line.nl === '\n') {
      return false
    }
    if (line.nl === '\r\n') {
      crlf = true
    }
  }
  return crlf
}

/** Наложить diff. Несовпадение контекста не создаёт предложение. */
export function applyUnifiedDiff(
  diff: string,
  current: (path: string) => Buffer | null,
): { ok: true; files: AppliedFile[] } | { ok: false; reason: string } {
  const parsed = parseUnifiedDiff(diff)
  if (!parsed.ok) {
    return parsed
  }
  const files: AppliedFile[] = []
  for (const file of parsed.files) {
    const before = file.isNew ? Buffer.alloc(0) : current(file.path)
    if (!file.isNew && before === null) {
      return { ok: false, reason: 'нет файла' }
    }
    const decoded = decodeStrict(before ?? Buffer.alloc(0))
    if (!decoded.ok) {
      return decoded
    }
    const applied = applyOne(file, splitKeep(decoded.text))
    if (!applied.ok) {
      return applied
    }
    if (!file.isNew) {
      const refusal = deletionRefusal(decoded.text, applied.text)
      if (refusal) {
        return { ok: false, reason: refusal }
      }
    }
    const out = Buffer.from(applied.text, 'utf8')
    const after = decoded.bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), out]) : out
    if (after.length > DIFF_FILE_MAX) {
      return { ok: false, reason: 'файл больше 1 МиБ' }
    }
    files.push({ path: file.path, isNew: file.isNew, before: before ?? Buffer.alloc(0), after })
  }
  return { ok: true, files }
}
