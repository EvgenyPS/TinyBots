/**
 * FILE: scripts/check-forbidden.test.ts
 * НАЗНАЧЕНИЕ: общие шаблоны, варианты пути и формат журнала.
 * Личные строки сюда не пишем: куски пути и маркеры собираются на месте.
 */

import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import {
  REPO_LOGIN,
  isAllowed,
  loadPatterns,
  matchesPattern,
  patternsFromSources,
  scanText,
} from './check-forbidden.mjs'

const drive = 'D:'
const folder = 'de' + 'vel' + 'op'
const backslash = `${drive}\\${folder}`
const forward = `${drive}/${folder}`
const jsonEscaped = `${drive}\\\\${folder}`
const drivePrefix = 'D:' + '\\'

const publicText = readFileSync('scripts/forbidden.txt', 'utf8')
const patterns = loadPatterns(publicText)

test('общий список без личных строк и без упаковки', () => {
  expect(patterns).toContain(drivePrefix)
  expect(patterns).toContain('/' + 'home/')
  expect(patterns).toContain('/' + 'workspace/')
  expect(patterns).toContain('grok' + '_id=')
  expect(patterns).toContain('gh' + 'p_')
  expect(patterns).toContain('github' + '_pat_')
  expect(patterns.some((item) => item.startsWith('re:'))).toBe(true)
  expect(publicText.includes('b' + '64:')).toBe(false)
})

test('префикс диска ловит обратный слеш, прямой и json', () => {
  expect(matchesPattern(`корень ${backslash}`, drivePrefix)).toBe(true)
  expect(matchesPattern(`корень ${forward}`, drivePrefix)).toBe(true)
  expect(matchesPattern(`{"root":"${jsonEscaped}"}`, drivePrefix)).toBe(true)
})

test('uuid из общего правила', () => {
  const uuid = ['aaaaaaaa', 'bbbb', '4ccc', '8ddd', 'eeeeeeeeeeee'].join('-')
  const rule = patterns.find((item) => item.startsWith('re:'))
  expect(rule).toBeTruthy()
  expect(matchesPattern(`версия ${uuid}`, rule ?? '')).toBe(true)
  expect(matchesPattern('версия 1.2.3', rule ?? '')).toBe(false)
})

test('нет локального списка и секрета — это предупреждение, не ошибка', () => {
  const loaded = patternsFromSources({
    publicText,
    localText: null,
    extraText: null,
  })
  expect(loaded.warnings).toHaveLength(2)
  expect(loaded.patterns).toEqual(patterns)
})

test('секрет добавляет правило, журнал не печатает сам текст', () => {
  const marker = 'qq' + '-marker-' + 'qq'
  const loaded = patternsFromSources({
    publicText: 'gh' + 'p_\n',
    localText: null,
    extraText: `${marker}\n`,
  })
  expect(loaded.warnings).toHaveLength(1)
  const hits = scanText('note.txt', `see ${marker} here`, loaded.patterns)
  expect(hits).toEqual(['note.txt:1: #2'])
  expect(hits[0].includes(marker)).toBe(false)
})

test('логин репозитория разрешён только в URL и в LICENSE/NOTICE', () => {
  const url = `https://github.com/${REPO_LOGIN}/TinyBots.git`
  expect(isAllowed('package.json', `"url": "${url}"`, REPO_LOGIN)).toBe(true)
  expect(isAllowed('package.json', `"name": "${REPO_LOGIN}"`, REPO_LOGIN)).toBe(false)
  expect(isAllowed('README.md', `<img src="https://img.shields.io/badge/x" alt=""> ${url}`, REPO_LOGIN)).toBe(true)
  expect(isAllowed('README.md', `автор ${REPO_LOGIN}`, REPO_LOGIN)).toBe(false)
  expect(isAllowed('LICENSE', REPO_LOGIN, REPO_LOGIN)).toBe(true)
  expect(isAllowed('NOTICE', `см. ${REPO_LOGIN}`, REPO_LOGIN)).toBe(true)
  expect(isAllowed('src/app.ts', url, REPO_LOGIN)).toBe(false)
})
