/**
 * FILE: scripts/check-motion.mjs
 * НАЗНАЧЕНИЕ: D7. Анимации в CSS только через transform и opacity, 150–300 мс.
 * ВХОД: текст CSS. Блок prefers-reduced-motion: reduce не проверяем: там длительность 0.
 * ВЫХОД: список ошибок. Пустой список — файл годится. Запуск без аргументов читает App.css.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROPS = new Set([
  'transition',
  'animation',
  'transition-duration',
  'animation-duration',
  'transition-property',
  'animation-name',
])

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function stripReduced(css) {
  const needle = 'prefers-reduced-motion: reduce'
  let out = ''
  let index = 0
  while (index < css.length) {
    const at = css.indexOf('@media', index)
    if (at === -1) {
      out += css.slice(index)
      break
    }
    out += css.slice(index, at)
    const open = css.indexOf('{', at)
    if (open === -1) {
      out += css.slice(at)
      break
    }
    const header = css.slice(at, open)
    let depth = 0
    let cursor = open
    for (; cursor < css.length; cursor += 1) {
      const char = css[cursor]
      if (char === '{') {
        depth += 1
      } else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          cursor += 1
          break
        }
      }
    }
    if (!header.includes(needle)) {
      out += css.slice(at, cursor)
    }
    index = cursor
  }
  return out
}

function variables(css) {
  const vars = new Map()
  const root = css.match(/:root\s*\{([^}]*)\}/)
  if (!root) {
    return vars
  }
  for (const match of root[1].matchAll(/--([A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) {
    vars.set(match[1], match[2].trim())
  }
  return vars
}

function resolveVars(value, vars) {
  return value.replace(/var\(\s*--([A-Za-z0-9_-]+)\s*\)/g, (_, name) => vars.get(name) ?? `var(--${name})`)
}

function durationsMs(value) {
  const found = []
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)) {
    const amount = Number(match[1])
    found.push(match[2] === 'ms' ? amount : amount * 1000)
  }
  return found
}

function durationOk(ms) {
  return ms === 0 || (ms >= 150 && ms <= 300)
}

function propertiesOf(chunk) {
  const word = chunk.trim().split(/\s+/)[0] ?? ''
  return word.replace(/!important$/, '')
}

export function checkMotion(css, filename = 'css') {
  const errors = []
  const cleaned = stripReduced(stripComments(css))
  const vars = variables(cleaned)
  const decl = /(?:^|[;{}])\s*(transition(?:-duration|-property)?|animation(?:-duration|-name)?)\s*:\s*([^;{}]+)/g
  for (const match of cleaned.matchAll(decl)) {
    const prop = match[1]
    if (!PROPS.has(prop)) {
      continue
    }
    const raw = match[2].trim()
    const value = resolveVars(raw, vars)
    if (value.includes('var(')) {
      errors.push(`${filename}: ${prop} ссылается на неизвестную длительность (${raw})`)
      continue
    }
    if (prop === 'animation' || prop === 'animation-name') {
      if (value === 'none' || value === 'none !important') {
        continue
      }
      errors.push(`${filename}: animation только none, сейчас ${raw}`)
      continue
    }
    if (prop === 'animation-duration' || prop === 'transition-duration') {
      const times = durationsMs(value)
      if (times.length === 0 || times.some((ms) => !durationOk(ms))) {
        errors.push(`${filename}: длительность ${raw} вне 0 или 150–300 мс`)
      }
      continue
    }
    if (prop === 'transition-property') {
      const names = value.split(',').map((item) => item.trim().replace(/\s*!important$/, ''))
      if (names.some((name) => name !== 'transform' && name !== 'opacity' && name !== 'none')) {
        errors.push(`${filename}: transition-property только transform и opacity (${raw})`)
      }
      continue
    }
    if (value === 'none' || value === 'none !important') {
      continue
    }
    for (const chunk of value.split(',')) {
      const name = propertiesOf(chunk)
      if (name !== 'transform' && name !== 'opacity' && name !== 'none') {
        errors.push(`${filename}: переход только transform/opacity, сейчас ${chunk.trim()}`)
      }
      const times = durationsMs(chunk)
      if (times.length === 0 || times.some((ms) => !durationOk(ms))) {
        errors.push(`${filename}: длительность ${chunk.trim()} вне 150–300 мс`)
      }
    }
  }
  return errors
}

function main() {
  const file = path.resolve('apps/web/src/App.css')
  const errors = checkMotion(readFileSync(file, 'utf8'), 'apps/web/src/App.css')
  if (errors.length > 0) {
    console.error(errors.join('\n'))
    process.exit(1)
  }
  console.log('движение: только transform и opacity, 150–300 мс')
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : ''
const self = fileURLToPath(import.meta.url)
if (entry && path.normalize(entry) === path.normalize(self)) {
  main()
}
