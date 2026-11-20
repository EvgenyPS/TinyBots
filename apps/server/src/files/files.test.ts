/**
 * FILE: apps/server/src/files/files.test.ts
 * НАЗНАЧЕНИЕ: G1 и G2 для /api/files и /api/docs.
 * ВХОД: папка проекта, секрет снаружи, симлинк, чужой Origin и Host.
 * ВЫХОД: секрет не попадает в ответ. Чужой заголовок — 403.
 */

import http from 'node:http'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { stringify } from 'yaml'
import { expect, test } from 'vitest'
import { BIND_HOST } from '../bind.js'
import { repoRoot } from '../root.js'
import { startServer, type RunningServer } from '../server.js'
import { edgesFromMarkdown } from './tree.js'

const secretText = 'секрет-снаружи'

function httpGet(port: number, pathname: string, headers: Record<string, string>): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: BIND_HOST, port, path: pathname, method: 'GET', headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

test('подпись ребра берётся из строки markdown', () => {
  const files = new Set(['plugin.gd', 'src/app.txt'])
  const edges = edgesFromMarkdown('plugin.gd → src/app.txt | вызывает\n', files)
  expect(edges).toEqual([{ from: 'plugin.gd', to: 'src/app.txt', label: 'вызывает' }])
  expect(edgesFromMarkdown('нет → такого | мимо\n', files)).toEqual([])
})

test('G1 и G2: файлы не выходят из папки, чужой Origin отклонён', async () => {
  const rel = 'data/files-g1'
  const dir = path.join(repoRoot(), rel)
  rmSync(dir, { recursive: true, force: true })
  const project = path.join(dir, 'proj')
  const outside = path.join(dir, 'outside')
  mkdirSync(path.join(project, 'docs'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(path.join(project, 'docs', 'readme.md'), '# Демо\n\nтекст\n')
  writeFileSync(path.join(project, '.env'), 'не-для-доков\n')
  mkdirSync(path.join(project, 'src'), { recursive: true })
  writeFileSync(path.join(project, 'src', 'app.txt'), 'не markdown\n')
  writeFileSync(path.join(outside, 'secret.txt'), secretText)
  symlinkSync(path.join(outside, 'secret.txt'), path.join(project, 'docs', 'leak.md'))
  symlinkSync(outside, path.join(project, 'out'))
  const config = {
    schema_version: 1,
    owner: { name: 'Ника', confirms_merge: true },
    data_dir: 'data',
    delivery: 'clipboard',
    bots: [{ id: 'bot1', name: 'Кедр', role: 'код' }],
    projects: [{
      id: 'demo-kit',
      title: 'Demo Kit',
      lead: 'bot1',
      owner: 'owner',
      merge_executor: 'bot1',
      source: { files: { path: 'proj' } },
      chats: [{
        id: 'chat1',
        title: 'Сборка',
        lead: 'bot1',
        members: ['bot1'],
        rules: { do: 'код', dont: 'шум' },
        context: [],
        economy: { wake: 'mentioned_only', reply_limit: 'short' },
      }],
    }],
    economy: {
      defaults: { wake: 'mentioned_only', reply_limit: 'short', max_wakes_per_task: 3 },
      stale_after_hours: 6,
    },
  }
  mkdirSync(path.join(dir, 'data'), { recursive: true })
  writeFileSync(path.join(dir, 'config.yaml'), stringify(config))
  let server: RunningServer | undefined
  try {
    server = await startServer({ port: 0, configPath: `${rel}/config.yaml` })
    const host = `${BIND_HOST}:${server.port}`
    const ok = await httpGet(server.port, '/api/files?project=demo-kit', { Host: host })
    expect(ok.status).toBe(200)
    expect(ok.text.includes(secretText)).toBe(false)
    expect(ok.text.includes('readme.md')).toBe(true)
    expect(ok.text.includes('leak.md')).toBe(false)
    const paths = [
      '../outside/secret.txt',
      '..\\outside\\secret.txt',
      '/etc/passwd',
      'C:/secret.txt',
      'docs/leak.md',
      'out/secret.txt',
      '//server/share/a.md',
      '\\\\server\\share\\a.md',
      'docs/readme.md:stream',
    ]
    for (const item of paths) {
      const sent = await httpGet(
        server.port,
        `/api/docs?project=demo-kit&path=${encodeURIComponent(item)}`,
        { Host: host },
      )
      expect(sent.status, item).toBe(404)
      expect(sent.text.includes(secretText), item).toBe(false)
    }
    for (const plain of ['.env', 'src/app.txt']) {
      const sent = await httpGet(
        server.port,
        `/api/docs?project=demo-kit&path=${encodeURIComponent(plain)}`,
        { Host: host },
      )
      expect(sent.status, plain).toBe(404)
      expect(sent.text.includes('не-для-доков'), plain).toBe(false)
      expect(sent.text.includes('не markdown'), plain).toBe(false)
    }
    const good = await httpGet(server.port, '/api/docs?project=demo-kit&path=docs/readme.md', { Host: host })
    expect(good.status).toBe(200)
    expect(good.text.includes('# Демо')).toBe(true)
    const evilOrigin = await httpGet(server.port, '/api/files?project=demo-kit', {
      Host: host,
      Origin: 'http://evil.example',
    })
    expect(evilOrigin.status).toBe(403)
    const evilHost = await httpGet(server.port, '/api/docs?project=demo-kit&path=docs/readme.md', {
      Host: `evil.example:${server.port}`,
    })
    expect(evilHost.status).toBe(403)
    const evilPort = await httpGet(server.port, '/api/git?project=demo-kit', {
      Host: host,
      Origin: `http://${BIND_HOST}:9`,
    })
    expect(evilPort.status).toBe(403)
    const crossSite = await httpGet(server.port, '/api/git?project=demo-kit', {
      Host: host,
      'Sec-Fetch-Site': 'cross-site',
    })
    expect(crossSite.status).toBe(403)
    const sameOrigin = await httpGet(server.port, '/api/git?project=demo-kit', {
      Host: host,
      'Sec-Fetch-Site': 'same-origin',
    })
    expect(sameOrigin.status).toBe(200)
  } finally {
    await server?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Н59: same-site и cross-site не доходят до GitHub', async () => {
  let hits = 0
  const mock = http.createServer((req, res) => {
    hits += 1
    if ((req.url ?? '').startsWith('/user')) {
      res.setHeader('X-OAuth-Scopes', 'read:org')
    }
    res.end(JSON.stringify({ login: 'demo-reader', commits: [] }))
  })
  await new Promise<void>((resolve) => {
    mock.listen(0, '127.0.0.1', () => resolve())
  })
  const address = mock.address()
  const mockPort = address && typeof address === 'object' ? address.port : 0
  const rel = 'data/files-h59'
  const dir = path.join(repoRoot(), rel)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.join(dir, 'proj'), { recursive: true })
  const config = {
    schema_version: 1,
    owner: { name: 'Ника', confirms_merge: true },
    data_dir: 'data',
    delivery: 'clipboard',
    bots: [{ id: 'bot1', name: 'Кедр', role: 'код' }],
    projects: [{
      id: 'demo-kit',
      title: 'Demo Kit',
      lead: 'bot1',
      owner: 'owner',
      merge_executor: 'bot1',
      source: { git: { provider: 'github', repo: 'example/demo-kit' }, files: { path: 'proj' } },
      chats: [{
        id: 'chat1',
        title: 'Сборка',
        lead: 'bot1',
        members: ['bot1'],
        rules: { do: 'код', dont: 'шум' },
        context: [],
        economy: { wake: 'mentioned_only', reply_limit: 'short' },
      }],
    }],
    economy: {
      defaults: { wake: 'mentioned_only', reply_limit: 'short', max_wakes_per_task: 3 },
      stale_after_hours: 6,
    },
  }
  mkdirSync(path.join(dir, 'data'), { recursive: true })
  writeFileSync(path.join(dir, 'config.yaml'), stringify(config))
  const previousToken = process.env.GITHUB_TOKEN
  const previousBase = process.env.GITHUB_API_BASE
  process.env.GITHUB_TOKEN = 'demo-read-token'
  process.env.GITHUB_API_BASE = `http://127.0.0.1:${mockPort}`
  let server: RunningServer | undefined
  try {
    server = await startServer({ port: 0, configPath: `${rel}/config.yaml` })
    const host = `${BIND_HOST}:${server.port}`
    const cases: Array<{ site?: string; status: number; called: boolean }> = [
      { site: 'same-site', status: 403, called: false },
      { site: 'cross-site', status: 403, called: false },
      { site: 'same-origin', status: 200, called: true },
      { site: 'none', status: 200, called: true },
      { status: 200, called: true },
    ]
    for (const item of cases) {
      hits = 0
      const headers: Record<string, string> = { Host: host }
      if (item.site !== undefined) {
        headers['Sec-Fetch-Site'] = item.site
      }
      const sent = await httpGet(server.port, '/api/git?project=demo-kit', headers)
      expect(sent.status, item.site ?? 'absent').toBe(item.status)
      expect(hits > 0, item.site ?? 'absent').toBe(item.called)
    }
  } finally {
    await server?.close()
    if (previousToken === undefined) {
      delete process.env.GITHUB_TOKEN
    } else {
      process.env.GITHUB_TOKEN = previousToken
    }
    if (previousBase === undefined) {
      delete process.env.GITHUB_API_BASE
    } else {
      process.env.GITHUB_API_BASE = previousBase
    }
    await new Promise<void>((resolve) => {
      mock.close(() => resolve())
    })
    rmSync(dir, { recursive: true, force: true })
  }
})
