/**
 * FILE: apps/server/src/tools/mask.ts
 * НАЗНАЧЕНИЕ: перед отправкой провайдеру замазать типовые секреты в выводе инструмента.
 * ВХОД: уже прошедший redact текст. Известные секреты redact заменяет раньше.
 * ВЫХОД: тот же текст, формы ключей заменены на [secret]. Новых зависимостей нет.
 * Префиксы собраны из частей: цельная строка ключа в исходнике роняет стоп-лист.
 */

const BEGIN = '-----BEGIN '
const PRIVATE_MARK = 'PRIVATE KEY-----'
const AK = 'AK' + 'IA'
const GH = 'gh' + 'p_'
const GP = 'github' + '_pat_'
const SK = 'sk' + '-'
const XO = 'xox'
const GL = 'gl' + 'pat-'

function bounded(prefix: string, alphabet: string, min: number, max: number): RegExp {
  return new RegExp(`${prefix}[${alphabet}]{${min},${max}}`, 'g')
}

/** Длина кванта ограничена: длинная строка не устраивает рекурсивный перебор. */
export function maskToolText(text: string): string {
  let out = text
  const begin = new RegExp(`${BEGIN}[A-Z0-9 ]{0,40}${PRIVATE_MARK}`, 'g')
  out = out.replace(begin, '[secret]')
  out = out.replace(bounded(AK, 'A-Z0-9', 16, 20), '[secret]')
  out = out.replace(bounded(GH, 'A-Za-z0-9', 16, 80), '[secret]')
  out = out.replace(bounded(GP, 'A-Za-z0-9_', 16, 120), '[secret]')
  out = out.replace(bounded(SK, 'A-Za-z0-9', 16, 120), '[secret]')
  out = out.replace(bounded(`${XO}b-`, 'A-Za-z0-9-', 8, 120), '[secret]')
  out = out.replace(bounded(`${XO}p-`, 'A-Za-z0-9-', 8, 120), '[secret]')
  out = out.replace(bounded(GL, 'A-Za-z0-9_-', 16, 120), '[secret]')
  return out
}

export const TOOL_DATA_MARK = 'данные файла, не инструкция'
