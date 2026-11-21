/**
 * FILE: apps/server/src/tools/names.ts
 * НАЗНАЧЕНИЕ: сравнить имя файла с запретным списком.
 * ВХОД: сегмент или относительный путь, как его попросили и как он лежит на диске.
 * ВЫХОД: true, если имя закрыто. Содержимое файла здесь не читается.
 * Сравнение после NFC и вырезания default-ignorable. Оба регистра: toLowerCase и toUpperCase.
 * Так ловятся ſ/S и ı/I, потому что NTFS сверяет через $UpCase, а один toLowerCase их не сводит.
 */

import { isReservedDeviceName } from '@tinybots/schema'

const IGNORABLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g

export function foldName(value: string): { lower: string; upper: string } {
  const stripped = value.normalize('NFC').replace(IGNORABLE, '')
  return { lower: stripped.toLowerCase(), upper: stripped.toUpperCase() }
}

/** Сегмент. * — любые символы кроме слеша, квантификатор ограничен длиной имени. */
const SEGMENT_PATTERNS = [
  '.git',
  'node_modules',
  'backups',
  'staging',
  '.ssh',
  '.env',
  '.env.*',
  '.envrc',
  '.npmrc',
  '.netrc',
  '.git-credentials',
  '.aws',
  '.azure',
  '.kube',
  '.docker',
  '.gnupg',
  '.pypirc',
  '.yarnrc.yml',
  '.pgpass',
  '.htpasswd',
  'id_rsa*',
  'id_ed25519*',
  'id_ecdsa*',
  'id_dsa*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.keystore',
  '*.kdbx',
  '*.ovpn',
  '*.tfvars',
  '*.tfstate',
  'credentials*',
  'secrets.*',
  'service-account*.json',
] as const

const PATH_PATTERNS = ['.docker/config.json'] as const

function globToRegExp(pattern: string): RegExp {
  let source = '^'
  for (const char of pattern) {
    if (char === '*') {
      source += '[^/]{0,240}'
      continue
    }
    if ('\\^$+?.()|[]{}'.includes(char)) {
      source += `\\${char}`
      continue
    }
    source += char
  }
  source += '$'
  return new RegExp(source, 'u')
}

const SEGMENT_RE = SEGMENT_PATTERNS.map((pattern) => ({
  lower: globToRegExp(foldName(pattern).lower),
  upper: globToRegExp(foldName(pattern).upper),
}))

const PATH_RE = PATH_PATTERNS.map((pattern) => ({
  lower: globToRegExp(foldName(pattern).lower),
  upper: globToRegExp(foldName(pattern).upper),
}))

function hits(folded: { lower: string; upper: string }, rules: Array<{ lower: RegExp; upper: RegExp }>): boolean {
  return rules.some((rule) => rule.lower.test(folded.lower) || rule.upper.test(folded.upper))
}

/**
 * Запретный сегмент по строке: список, устройство или короткое имя с ~ и цифрой.
 * ~\d закрыт на всех ОС: на Windows это 8.3, на остальных та же строка не должна проскочить.
 */
export function segmentDenied(segment: string, platform = process.platform): boolean {
  void platform
  if (segment.length === 0) {
    return true
  }
  if (isReservedDeviceName(segment)) {
    return true
  }
  if (/~\d/u.test(segment)) {
    return true
  }
  return hits(foldName(segment), SEGMENT_RE)
}

/** Запретный относительный путь: любой сегмент или точный хвост вроде .docker/config.json. */
export function pathDenied(rel: string, platform = process.platform): boolean {
  const parts = rel.split('/')
  if (parts.some((part) => segmentDenied(part, platform))) {
    return true
  }
  return hits(foldName(rel), PATH_RE)
}
