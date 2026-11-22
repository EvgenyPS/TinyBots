/**
 * FILE: apps/server/src/tools/gitignore.ts
 * НАЗНАЧЕНИЕ: решить, закрыт ли путь корневым .gitignore.
 * ВХОД: текст корневого файла и относительный путь. Вложенные .gitignore и глобальные excludes не читаем.
 * ВЫХОД: true, если путь инструменту не показывать.
 * Простые шаблоны: имя, *.ext, dir/, /только-корень, комментарий #.
 * Строка с ! или ** и любая непонятная закрывает то, что могла задеть. Снятия игнора нет.
 */

type Rule =
  | { kind: 'all' }
  | { kind: 'name'; name: string }
  | { kind: 'ext'; ext: string }
  | { kind: 'dir'; name: string }
  | { kind: 'root'; path: string }
  | { kind: 'prefix'; prefix: string }
  | { kind: 'suffix'; suffix: string }

const SIMPLE_NAME = /^[A-Za-z0-9._@+-]+$/

function pushSimple(rules: Rule[], body: string, dirOnly: boolean, rooted: boolean): void {
  if (body.length === 0) {
    rules.push({ kind: 'all' })
    return
  }
  if (body.startsWith('*.') && SIMPLE_NAME.test(body.slice(2)) && !body.slice(2).includes('*')) {
    rules.push({ kind: 'ext', ext: body.slice(1).toLowerCase() })
    return
  }
  if (body.endsWith('/*') && SIMPLE_NAME.test(body.slice(0, -2))) {
    rules.push({ kind: 'dir', name: body.slice(0, -2).toLowerCase() })
    return
  }
  if (!body.includes('*') && !body.includes('?') && !body.includes('[') && SIMPLE_NAME.test(body.replace(/\//g, ''))) {
    if (rooted && dirOnly) {
      rules.push({ kind: 'root', path: `${body.toLowerCase()}/` })
      return
    }
    if (rooted) {
      rules.push({ kind: 'root', path: body.toLowerCase() })
      return
    }
    if (dirOnly) {
      rules.push({ kind: 'dir', name: body.toLowerCase() })
      return
    }
    if (body.includes('/')) {
      rules.push({ kind: 'prefix', prefix: body.toLowerCase() })
      return
    }
    rules.push({ kind: 'name', name: body.toLowerCase() })
    return
  }
  // Непонятный шаблон. Закрываем устойчивые куски, а если их нет — всё.
  const star = body.split('*').map((part) => part.replace(/[?[\]\\]/g, '')).filter((part) => part.length > 0)
  if (star.length === 0) {
    rules.push({ kind: 'all' })
    return
  }
  if (body.startsWith('*') && star.length === 1) {
    rules.push({ kind: 'suffix', suffix: star[0].toLowerCase() })
    return
  }
  if (body.endsWith('*') && star.length === 1 && !star[0].includes('/')) {
    rules.push({ kind: 'prefix', prefix: star[0].toLowerCase() })
    return
  }
  const literal = star.join('')
  if (literal.includes('/')) {
    rules.push({ kind: 'prefix', prefix: literal.toLowerCase() })
    return
  }
  rules.push({ kind: 'name', name: literal.toLowerCase() })
}

/** Разобрать корневой .gitignore. Отрицание ! не открывает путь заново. */
export function compileGitignore(text: string): Rule[] {
  const rules: Rule[] = []
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/\r$/u, '')
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }
    let body = line
    if (body.startsWith('!')) {
      body = body.slice(1)
    }
    if (body.includes('**')) {
      const stripped = body.replace(/\*\*/g, '')
      if (stripped.replace(/[/*?[\]]/g, '').length === 0) {
        rules.push({ kind: 'all' })
        continue
      }
    }
    const rooted = body.startsWith('/')
    if (rooted) {
      body = body.slice(1)
    }
    const dirOnly = body.endsWith('/')
    if (dirOnly) {
      body = body.slice(0, -1)
    }
    if (body.includes('**')) {
      const parts = body.split('**').map((part) => part.replace(/^\/|\/$/g, '')).filter((part) => part.length > 0)
      if (parts.length === 0) {
        rules.push({ kind: 'all' })
        continue
      }
      for (const part of parts) {
        pushSimple(rules, part, part.endsWith('/') || dirOnly, false)
      }
      continue
    }
    pushSimple(rules, body, dirOnly, rooted)
  }
  return rules
}

function matches(rule: Rule, rel: string): boolean {
  const value = rel.toLowerCase()
  const base = value.slice(value.lastIndexOf('/') + 1)
  if (rule.kind === 'all') {
    return true
  }
  if (rule.kind === 'name') {
    return base === rule.name || value.split('/').includes(rule.name)
  }
  if (rule.kind === 'ext') {
    return base.endsWith(rule.ext)
  }
  if (rule.kind === 'dir') {
    return value === rule.name || value.startsWith(`${rule.name}/`) || value.split('/').includes(rule.name)
  }
  if (rule.kind === 'root') {
    return value === rule.path || value.startsWith(`${rule.path}/`)
  }
  if (rule.kind === 'prefix') {
    return value === rule.prefix || value.startsWith(`${rule.prefix}/`) || value.startsWith(rule.prefix)
  }
  return value.endsWith(rule.suffix) || base.endsWith(rule.suffix)
}

/** true — путь закрыт и в вывод инструмента не попадает. */
export function gitignoreDenies(rules: readonly Rule[], rel: string): boolean {
  if (rel === '.gitignore') {
    return false
  }
  return rules.some((rule) => matches(rule, rel))
}
