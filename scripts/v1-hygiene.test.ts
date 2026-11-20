/**
 * FILE: scripts/v1-hygiene.test.ts
 * НАЗНАЧЕНИЕ: Н42 и D1/D8. Скрипт e2e собирает страницу, токена нет во фронте,
 * README указывает на демо-скриншоты и ручной чеклист.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const child = path.join(dir, name)
    if (statSync(child).isDirectory()) {
      walk(child, out)
    } else {
      out.push(child)
    }
  }
  return out
}

describe('этап 3, гигиена', () => {
  test('Н42: npm run e2e собирает web', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: { e2e: string } }
    expect(pkg.scripts.e2e.startsWith('npm run build -w @tinybots/web && playwright test')).toBe(true)
  })

  test('D1: фронт не упоминает токен GitHub', () => {
    const files = walk(path.join(root, 'apps/web/src'))
    const hit = files.filter((file) => readFileSync(file, 'utf8').includes('GITHUB_TOKEN'))
    expect(hit).toEqual([])
  })

  test('D8: README и чеклист ручной проверки', () => {
    const readme = readFileSync(path.join(root, 'README.md'), 'utf8')
    expect(readme).toContain('npm install\nnpm start')
    for (const name of ['dashboard.png', 'files.png', 'docs.png', 'git.png']) {
      expect(readme).toContain(`docs/screenshots/${name}`)
      const bytes = readFileSync(path.join(root, 'docs/screenshots', name))
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(bytes.includes(0)).toBe(true)
    }
    const manual = readFileSync(path.join(root, 'docs/v1-manual.md'), 'utf8')
    expect(manual).toContain('npm install')
    expect(manual).toContain('npm start')
    expect(manual).toContain('docs/xss.md')
  })
})
