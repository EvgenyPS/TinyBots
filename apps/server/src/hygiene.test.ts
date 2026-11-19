/**
 * FILE: apps/server/src/hygiene.test.ts
 * НАЗНАЧЕНИЕ: LICENSE, NOTICE, .gitignore и стоп-лист §3.7 на всём дереве, включая docs/.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { repoRoot } from './root.js'

const root = repoRoot()

function runNode(script: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [path.join(root, script)], {
    cwd: root,
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('.gitignore закрывает секреты, data_dir и сборку', () => {
  const text = readFileSync(path.join(root, '.gitignore'), 'utf8')
  const lines = new Set(text.split(/\r?\n/).map((line) => line.trim()))
  for (const required of [
    '.env',
    'config.yaml',
    'data/',
    'data_dir/',
    'node_modules/',
    'dist/',
    '*.log',
    'scripts/forbidden.local.txt',
  ]) {
    expect(lines.has(required), required).toBe(true)
  }
})

test('LICENSE и NOTICE на месте', () => {
  const result = runNode('scripts/check-license.mjs')
  expect(result.status, result.stderr).toBe(0)
})

test('стоп-лист не находит запрещённые строки, включая docs', () => {
  const list = readFileSync(path.join(root, 'scripts', 'forbidden.txt'), 'utf8')
  expect(list.includes('/' + 'workspace/')).toBe(true)
  expect(list.includes('b' + '64:')).toBe(false)
  const result = runNode('scripts/check-forbidden.mjs')
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})

test('пример конфига без токенов и чужих путей', () => {
  const text = readFileSync(path.join(root, 'config.example.yaml'), 'utf8')
  expect(text.includes('data_dir:')).toBe(true)
  expect(text.includes('gh' + 'p_')).toBe(false)
  expect(text.includes('github' + '_pat_')).toBe(false)
  expect(text.includes('BE' + 'GIN ')).toBe(false)
  expect(/[A-Za-z]:\\/.test(text)).toBe(false)
  expect(text.includes('/' + 'home/')).toBe(false)
})
