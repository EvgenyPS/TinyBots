/**
 * FILE: apps/web/src/ui/markdown.ts
 * НАЗНАЧЕНИЕ: разобрать markdown демо-доков в блоки, без HTML.
 * ВХОД: текст файла. Теги вроде script остаются обычным текстом блока.
 * ВЫХОД: заголовки, абзацы, списки, таблицы и код. Сырой HTML не выделяется.
 */

export type MdBlock =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

function isSpecial(line: string): boolean {
  return line.startsWith('```') || /^(#{1,3})\s+/.test(line) || /^\s*[-*]\s+/.test(line) || line.includes('|')
}

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.startsWith('```')) {
      const buf: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        buf.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      blocks.push({ kind: 'code', text: buf.join('\n') })
      continue
    }
    if (line.trim().length === 0) {
      index += 1
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]?.length ?? 1
      blocks.push({ kind: 'h', level, text: heading[2] ?? '' })
      index += 1
      continue
    }
    const divider = lines[index + 1] ?? ''
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(divider)) {
      const header = splitRow(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim().length > 0) {
        rows.push(splitRow(lines[index] ?? ''))
        index += 1
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*]\s+/, ''))
        index += 1
      }
      blocks.push({ kind: 'ul', items })
      continue
    }
    const para: string[] = [line]
    index += 1
    while (index < lines.length && (lines[index] ?? '').trim().length > 0 && !isSpecial(lines[index] ?? '')) {
      para.push(lines[index] ?? '')
      index += 1
    }
    blocks.push({ kind: 'p', text: para.join('\n') })
  }
  return blocks
}
