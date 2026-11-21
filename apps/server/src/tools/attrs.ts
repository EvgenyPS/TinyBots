/**
 * FILE: apps/server/src/tools/attrs.ts
 * НАЗНАЧЕНИЕ: решить, можно ли править путь без внешнего git-фильтра.
 * ВХОД: корень репозитория и относительный путь. Читаем .gitattributes сами, git не зовём.
 * ВЫХОД: null, если путь обычный, иначе код unsupported_filter.
 * Ближний файл перекрывает дальний. Непонятная строка закрывает путь.
 * filter, ident и working-tree-encoding не запускаем. text/eol годится только как CRLF↔LF.
 */

import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'

type Effect = {
  filter: string | null
  ident: boolean
  encoding: string | null
  eol: string | null
  odd: boolean
}

function blank(): Effect {
  return { filter: null, ident: false, encoding: null, eol: null, odd: false }
}

function matches(pattern: string, relFromFile: string): boolean {
  const rel = relFromFile.replace(/\\/g, '/')
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  if (pattern.includes('[') || pattern.includes('?') || pattern.includes('**')) {
    return true
  }
  if (pattern.startsWith('*.')) {
    return base.endsWith(pattern.slice(1))
  }
  if (pattern.includes('/')) {
    return rel === pattern || rel.endsWith(`/${pattern}`) || rel.startsWith(`${pattern}/`)
  }
  return base === pattern || rel.split('/').includes(pattern)
}

function applyLine(effect: Effect, line: string, relFromFile: string): void {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    return
  }
  const parts = trimmed.split(/\s+/u)
  const pattern = parts[0]
  if (!pattern || parts.length < 2) {
    effect.odd = true
    return
  }
  if (!matches(pattern, relFromFile)) {
    return
  }
  for (const attr of parts.slice(1)) {
    if (attr.startsWith('-')) {
      const name = attr.slice(1)
      if (name === 'filter') {
        effect.filter = null
      } else if (name === 'ident') {
        effect.ident = false
      } else if (name === 'text') {
        effect.odd = false
      }
      continue
    }
    const eq = attr.indexOf('=')
    const name = (eq === -1 ? attr : attr.slice(0, eq)).toLowerCase()
    const value = eq === -1 ? '' : attr.slice(eq + 1)
    if (name === 'filter') {
      effect.filter = value
      continue
    }
    if (name === 'ident') {
      effect.ident = true
      continue
    }
    if (name === 'working-tree-encoding') {
      effect.encoding = value
      continue
    }
    if (name === 'eol') {
      effect.eol = value.toLowerCase()
      continue
    }
    if (name === 'text') {
      continue
    }
    effect.odd = true
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    const st = await lstat(file)
    if (st.isSymbolicLink() || !st.isFile()) {
      return ''
    }
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

/** null — фильтр не мешает. Иначе править нельзя. */
export async function attributeBlock(rootReal: string, rel: string): Promise<string | null> {
  const effect = blank()
  const dirs = [rootReal]
  const parts = rel.split('/').slice(0, -1)
  let cursor = rootReal
  for (const part of parts) {
    cursor = path.join(cursor, part)
    dirs.push(cursor)
  }
  const files = [
    ...dirs.map((dir) => path.join(dir, '.gitattributes')),
    path.join(rootReal, '.git', 'info', 'attributes'),
  ]
  for (const file of files) {
    const text = await readText(file)
    if (text === null || text.length === 0) {
      continue
    }
    const base = path.dirname(file)
    const from = file.endsWith(`${path.sep}info${path.sep}attributes`) || file.endsWith('/info/attributes')
      ? rel
      : path.relative(base, path.join(rootReal, rel)).split(path.sep).join('/')
    for (const line of text.split(/\r?\n/u)) {
      applyLine(effect, line, from)
    }
  }
  if (effect.odd || effect.filter !== null || effect.ident || effect.encoding) {
    return 'unsupported_filter'
  }
  if (effect.eol && effect.eol !== 'lf' && effect.eol !== 'crlf') {
    return 'unsupported_filter'
  }
  return null
}
