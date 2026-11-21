/**
 * FILE: apps/server/src/tools/diff.ts
 * НАЗНАЧЕНИЕ: разобрать unified diff и наложить его на байты строго, без fuzz.
 * ВХОД: текст diff и карта текущих файлов. Новый файл — пустые байты и --- /dev/null.
 * ВЫХОД: итоговые байты или отказ. Удаление, переименование, режимы и бинарный патч не проходят.
 * CRLF и BOM исходника сохраняются. Противоречивый маркер «нет перевода строки» — отказ.
 */

import { DIFF_FILE_MAX, DIFF_FILES_MAX, DIFF_MAX } from './limits.js'

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

function applyOne(file: FileDiff, original: string): { ok: true; text: string } | { ok: false; reason: string } {
  const src = splitLf(original)
  if (file.isNew && original.length > 0) {
    return { ok: false, reason: 'файл уже есть' }
  }
  const out: string[] = []
  let cursor = 0
  for (const hunk of file.hunks) {
    const start = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1
    if (start < cursor || start > src.lines.length) {
      return { ok: false, reason: 'контекст не совпал' }
    }
    out.push(...src.lines.slice(cursor, start))
    cursor = start
    for (const line of hunk.lines) {
      if (line.kind === '+' ) {
        out.push(line.text)
        continue
      }
      if (src.lines[cursor] !== line.text) {
        return { ok: false, reason: 'контекст не совпал' }
      }
      if (line.kind === ' ') {
        out.push(line.text)
      }
      cursor += 1
    }
  }
  out.push(...src.lines.slice(cursor))
  let text = out.join('\n')
  const trailing = file.noNewline ? false : (file.hunks.length === 0 ? src.trailing : true)
  if (file.hunks.length === 0) {
    return { ok: false, reason: 'нет хунка' }
  }
  if (!file.noNewline) {
    text += '\n'
    if (!src.trailing && !file.isNew && cursor === src.lines.length && original.length > 0 && !original.endsWith('\n')) {
      // Хунк не заявлял снятие перевода строки, а исходник его не имел — только если хунк трогал хвост.
      const touchesEnd = file.hunks.some((hunk) => {
        const start = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1
        return start + hunk.lines.filter((line) => line.kind !== '+').length >= src.lines.length
      })
      if (!touchesEnd) {
        text = text.slice(0, -1)
      }
    }
  }
  void trailing
  return { ok: true, text }
}

function newlineStyle(bytes: Buffer): { bom: boolean; crlf: boolean; lf: string } {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const body = bom ? bytes.subarray(3) : bytes
  const text = body.toString('latin1')
  let crlf = false
  let bare = false
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      if (i > 0 && text[i - 1] === '\r') {
        crlf = true
      } else {
        bare = true
      }
    }
  }
  return { bom, crlf: crlf && !bare, lf: text.replace(/\r\n/g, '\n') }
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
    const style = newlineStyle(before ?? Buffer.alloc(0))
    const applied = applyOne(file, style.lf)
    if (!applied.ok) {
      return applied
    }
    let body = applied.text
    if (style.crlf) {
      body = body.replace(/\n/g, '\r\n')
    }
    const out = Buffer.from(body, 'utf8')
    const after = style.bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), out]) : out
    if (after.length > DIFF_FILE_MAX) {
      return { ok: false, reason: 'файл больше 1 МиБ' }
    }
    files.push({ path: file.path, isNew: file.isNew, before: before ?? Buffer.alloc(0), after })
  }
  return { ok: true, files }
}
