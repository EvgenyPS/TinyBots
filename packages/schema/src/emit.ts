/**
 * FILE: packages/schema/src/emit.ts
 * НАЗНАЧЕНИЕ: записать packages/schema/json. CI сравнивает результат с тем, что уже в git.
 * ВХОД: jsonDocuments().
 * ВЫХОД: файлы *.schema.json. Запись только при прямом запуске node, импорт из теста файлы не трогает.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { jsonDocuments } from './json-docs.js'

const here = path.dirname(fileURLToPath(import.meta.url))

/** dist/emit.js пишет в packages/schema/json, исходник из src — туда же. */
export function jsonOutputDir(): string {
  return path.resolve(here, '..', 'json')
}

export function renderJsonSchemas(): Map<string, string> {
  const rendered = new Map<string, string>()
  for (const doc of jsonDocuments()) {
    rendered.set(doc.file, `${JSON.stringify(doc.schema, null, 2)}\n`)
  }
  return rendered
}

function isDirectRun(): boolean {
  const argv = process.argv[1]
  if (!argv) {
    return false
  }
  return path.normalize(argv) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  const outDir = jsonOutputDir()
  mkdirSync(outDir, { recursive: true })
  for (const [file, text] of renderJsonSchemas()) {
    writeFileSync(path.join(outDir, file), text)
  }
}
