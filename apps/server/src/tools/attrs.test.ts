/**
 * FILE: apps/server/src/tools/attrs.test.ts
 * НАЗНАЧЕНИЕ: таблица .gitattributes. Понятные атрибуты не закрывают путь.
 * Неизвестный атрибут по-прежнему закрывает.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { attributeBlock } from './attrs.js'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function rootWith(text: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'tinybots-attr-'))
  dirs.push(root)
  await writeFile(path.join(root, '.gitattributes'), text)
  await writeFile(path.join(root, 'note.txt'), 'x\n')
  return root
}

const rows: Array<[string, string | null]> = [
  ['* text', null],
  ['* -text', null],
  ['* !text', null],
  ['* eol=lf', null],
  ['* diff', null],
  ['* diff=text', null],
  ['* merge=union', null],
  ['* linguist-generated', null],
  ['* filter=lfs', 'unsupported_filter'],
  ['* ident', 'unsupported_filter'],
  ['* working-tree-encoding=UTF-16', 'unsupported_filter'],
  ['* eol=native', 'unsupported_filter'],
  ['* binary', 'unsupported_filter'],
  ['* -binary', 'unsupported_filter'],
]

test.each(rows)('%s → %s', async (line, expected) => {
  const root = await rootWith(`${line}\n`)
  expect(await attributeBlock(root, 'note.txt')).toBe(expected)
})
