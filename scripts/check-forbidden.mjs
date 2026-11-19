/**
 * FILE: scripts/check-forbidden.mjs
 * НАЗНАЧЕНИЕ: стоп-лист по всему дереву, включая docs/.
 * ВХОД: scripts/forbidden.txt (общий, в git), scripts/forbidden.local.txt и
 *       переменная FORBIDDEN_EXTRA (личные строки, оба необязательны).
 * ВЫХОД: код 0, если совпадений нет. В журнал пишется файл:строка и номер правила,
 *        сам текст совпадения не печатается.
 * Сами списки в проверку не входят.
 *
 * Путь с обратным слешем ловит и прямой слеш, и JSON-экранирование.
 * Строка re: — регулярное выражение. Строка w: — слово с границей.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PUBLIC_LIST = 'scripts/forbidden.txt'
const LOCAL_LIST = 'scripts/forbidden.local.txt'

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-types',
  'coverage',
  'data',
  'data_dir',
])

const SKIP_FILES = new Set([PUBLIC_LIST, LOCAL_LIST])

// Логин репозитория собираем по частям: в исходнике нет цельной строки.
const REPO_LOGIN = 'Evgen' + 'yPS'
const REPO_URL = `github.com/${REPO_LOGIN}/TinyBots`

export { REPO_LOGIN }

export function loadPatterns(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

/**
 * Общий список обязателен. Локальный файл и FORBIDDEN_EXTRA можно не передавать:
 * null означает «источника нет», это предупреждение, не ошибка.
 */
export function patternsFromSources({ publicText, localText, extraText }) {
  const warnings = []
  if (localText == null) {
    warnings.push(`предупреждение: нет ${LOCAL_LIST}, источник пропущен`)
  }
  if (extraText == null || extraText === '') {
    warnings.push('предупреждение: нет FORBIDDEN_EXTRA, источник пропущен')
  }
  const patterns = [
    ...loadPatterns(publicText),
    ...loadPatterns(localText ?? ''),
    ...loadPatterns(extraText ?? ''),
  ]
  return { patterns, warnings }
}

function wordHit(line, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?:$|[^\\p{L}\\p{N}_])`, 'u')
  return re.test(line)
}

/** Варианты пути: как в списке, со слешами наоборот и с удвоенным обратным слешем из JSON. */
export function pathVariants(pattern) {
  if (!pattern.includes('\\') && !pattern.includes('/')) {
    return [pattern]
  }
  const forward = pattern.replaceAll('\\', '/')
  const back = pattern.replaceAll('/', '\\')
  const jsonEscaped = back.replaceAll('\\', '\\\\')
  return [...new Set([pattern, forward, back, jsonEscaped])]
}

export function compilePattern(raw) {
  if (raw.startsWith('re:')) {
    const re = new RegExp(raw.slice(3), 'i')
    return (line) => re.test(line)
  }
  if (raw.startsWith('w:')) {
    const word = raw.slice(2)
    return (line) => wordHit(line, word)
  }
  const variants = pathVariants(raw)
  const asWord = [...raw].length <= 3 && !raw.includes('\\') && !raw.includes('/')
  if (asWord) {
    return (line) => variants.some((variant) => wordHit(line, variant))
  }
  return (line) => variants.some((variant) => line.includes(variant))
}

export function matchesPattern(line, raw) {
  return compilePattern(raw)(line)
}

/**
 * Логин репозитория разрешён только в его URL (package.json и бейдж README)
 * и в файлах LICENSE / NOTICE. В остальных местах это совпадение.
 */
export function isAllowed(rel, line, pattern) {
  if (pattern !== REPO_LOGIN) {
    return false
  }
  const file = rel.replaceAll('\\', '/')
  if (file === 'LICENSE' || file === 'NOTICE') {
    return true
  }
  if (!line.includes(REPO_URL)) {
    return false
  }
  if (file === 'package.json' && /"url"\s*:/.test(line)) {
    return true
  }
  if (file === 'README.md' && /(badge|shields\.io)/i.test(line)) {
    return true
  }
  return false
}

export function scanText(rel, text, patterns) {
  const compiled = patterns.map((raw, index) => ({
    index,
    raw,
    test: compilePattern(raw),
  }))
  const hits = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    for (const pattern of compiled) {
      if (!pattern.test(line) || isAllowed(rel, line, pattern.raw)) {
        continue
      }
      // Номер правила, не текст: личный шаблон не должен попасть в журнал.
      hits.push(`${rel}:${i + 1}: #${pattern.index + 1}`)
    }
  }
  return hits
}

export function scanTree(root, patterns) {
  const hits = []

  function scan(filePath, rel) {
    const info = statSync(filePath)
    if (info.size > 2_000_000) {
      return
    }
    const buf = readFileSync(filePath)
    if (buf.includes(0)) {
      return
    }
    hits.push(...scanText(rel, buf.toString('utf8'), patterns))
  }

  function walk(dir, rel) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        continue
      }
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      const childPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue
        }
        walk(childPath, childRel)
        continue
      }
      if (!entry.isFile() || SKIP_FILES.has(childRel)) {
        continue
      }
      scan(childPath, childRel)
    }
  }

  walk(root, '')
  return hits
}

function main() {
  if (!existsSync(PUBLIC_LIST)) {
    console.error(`нет ${PUBLIC_LIST}`)
    process.exit(1)
  }
  const localText = existsSync(LOCAL_LIST) ? readFileSync(LOCAL_LIST, 'utf8') : null
  const extra = process.env.FORBIDDEN_EXTRA
  const extraText = extra == null || extra === '' ? null : extra
  const { patterns, warnings } = patternsFromSources({
    publicText: readFileSync(PUBLIC_LIST, 'utf8'),
    localText,
    extraText,
  })
  for (const warning of warnings) {
    console.warn(warning)
  }
  if (patterns.length === 0) {
    console.error('стоп-лист пуст')
    process.exit(1)
  }
  const hits = scanTree(process.cwd(), patterns)
  if (hits.length > 0) {
    console.error(hits.join('\n'))
    console.error(`стоп-лист: ${hits.length}`)
    process.exit(1)
  }
  console.log(`стоп-лист: совпадений нет (${patterns.length} строк)`)
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : ''
const self = fileURLToPath(import.meta.url)
if (entry && path.normalize(entry) === path.normalize(self)) {
  main()
}

export const entryUrl = pathToFileURL(self).href
