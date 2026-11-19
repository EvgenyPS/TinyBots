/**
 * Проверка наличия LICENSE (Apache-2.0) и NOTICE.
 * Падает с кодом 1, если одного из файлов нет или текст лицензии не тот.
 */

import { readFileSync } from 'node:fs'

const errors = []

let license = ''
let notice = ''
try {
  license = readFileSync('LICENSE', 'utf8')
} catch {
  errors.push('нет файла LICENSE')
}
try {
  notice = readFileSync('NOTICE', 'utf8')
} catch {
  errors.push('нет файла NOTICE')
}

if (license && (!license.includes('Apache License') || !license.includes('Version 2.0'))) {
  errors.push('LICENSE не похож на текст Apache-2.0')
}
if (notice && (!notice.includes('TinyBots') || notice.trim().length < 40)) {
  errors.push('NOTICE пустой или без названия проекта')
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log('LICENSE и NOTICE на месте')
