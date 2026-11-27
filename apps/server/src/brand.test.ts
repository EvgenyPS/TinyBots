/**
 * FILE: apps/server/src/brand.test.ts
 * НАЗНАЧЕНИЕ: знак «Вожак» в шапке страницы и отдача /favicon.ico и /icon.svg.
 * В режиме окна каталог данных пустой: файлы всё равно читаются из репозитория.
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { repoRoot } from './root.js'
import { createApp, startServer, type RunningServer } from './server.js'

const SVG_SHA = 'e685f0f887f6f07d8f0a2a5a1deaab7329daf1fe7854e503f88fd89fb2a9d056'
const ICO_SHA = '1a42a1f30c2eae1fab931741dc6b8ec0ed6e5bb111c752f75dc3454570345f49'
const servers: RunningServer[] = []
const dirs: string[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close()
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function sha(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

test('index.html ссылается на оба знака, байты совпадают', () => {
  const html = readFileSync(path.join(repoRoot(), 'apps/web/index.html'), 'utf8')
  expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="any">')
  expect(html).toContain('<link rel="icon" href="/icon.svg" type="image/svg+xml">')
  expect(sha(path.join(repoRoot(), 'apps/web/public/icon.svg'))).toBe(SVG_SHA)
  expect(sha(path.join(repoRoot(), 'apps/web/public/favicon.ico'))).toBe(ICO_SHA)
})

test('сервер отдаёт знаки и в режиме окна', async () => {
  const browser = await startServer({ port: 0 })
  servers.push(browser)
  for (const name of ['/favicon.ico', '/icon.svg'] as const) {
    const res = await fetch(`http://127.0.0.1:${browser.port}${name}`)
    expect(res.status, name).toBe(200)
    const bytes = Buffer.from(await res.arrayBuffer())
    const digest = createHash('sha256').update(bytes).digest('hex')
    expect(digest).toBe(name === '/favicon.ico' ? ICO_SHA : SVG_SHA)
  }

  const dataDir = mkdtempSync(path.join(tmpdir(), 'tinybots-brand-'))
  dirs.push(dataDir)
  const window = createApp({
    boundPort: { current: 8787 },
    sessionToken: 'ab'.repeat(32),
    desktopHost: true,
    dataDir,
  })
  for (const name of ['/favicon.ico', '/icon.svg'] as const) {
    const res = await window.request(`http://127.0.0.1:8787${name}`, {
      headers: { host: '127.0.0.1:8787' },
    })
    expect(res.status, name).toBe(200)
    const bytes = Buffer.from(await res.arrayBuffer())
    const digest = createHash('sha256').update(bytes).digest('hex')
    expect(digest).toBe(name === '/favicon.ico' ? ICO_SHA : SVG_SHA)
  }
})
