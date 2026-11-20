/**
 * FILE: scripts/markdown.test.ts
 * НАЗНАЧЕНИЕ: D4. Таблица и код разбираются, script остаётся текстом блока.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { parseMarkdown } from '../apps/web/src/ui/markdown.ts'

test('D4: таблица, код и script не становятся html', () => {
  const source = [
    '# Заголовок',
    '',
    '| Файл | Роль |',
    '| --- | --- |',
    '| plugin.gd | док |',
    '',
    '```',
    'return id',
    '```',
    '',
    '<script>alert(1)</script>',
    '',
  ].join('\n')
  const blocks = parseMarkdown(source)
  expect(blocks.some((block) => block.kind === 'table' && block.rows[0]?.[0] === 'plugin.gd')).toBe(true)
  expect(blocks.some((block) => block.kind === 'code' && block.text.includes('return id'))).toBe(true)
  const script = blocks.find((block) => block.kind === 'p' && block.text.includes('<script>'))
  expect(script?.kind).toBe('p')
  expect(JSON.stringify(blocks).includes('"kind":"html"')).toBe(false)
  const web = readFileSync(path.join(process.cwd(), 'apps/web/src/ui/markdown-view.tsx'), 'utf8')
  expect(web.includes('dangerouslySetInnerHTML')).toBe(false)
})
