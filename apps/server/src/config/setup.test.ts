/**
 * FILE: apps/server/src/config/setup.test.ts
 * НАЗНАЧЕНИЕ: B17 и B18 на сервере, плюс потолок шагов для B19.
 * Запись идёт только после схемы. Без подтверждения старый файл остаётся байт в байт.
 * Папка без своего .git получает фразу «вкладка Git будет скрыта».
 */

import { execFileSync } from 'node:child_process'
import http from 'node:http'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { BIND_HOST } from '../bind.js'
import { tokensMatch } from '../csrf.js'
import { repoRoot } from '../root.js'
import { startServer, type RunningServer } from '../server.js'
import { parseConfigText } from './load.js'
import { saveSetup, SETUP_STEP_LIMIT, SETUP_STEPS, describeSetup } from './setup.js'
import { resolveSetupTarget } from './setup-target.js'
import { GIT_HIDDEN_WARNING, inspectSource, judgeSource } from './source-check.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'tinybots-setup-'))
  dirs.push(dir)
  return dir
}

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  delete env.GIT_PREFIX
  return env
}

function withoutConfigEnv<T>(run: () => T): T {
  const previous = process.env.TINYBOTS_CONFIG
  delete process.env.TINYBOTS_CONFIG
  try {
    return run()
  } finally {
    if (previous === undefined) {
      delete process.env.TINYBOTS_CONFIG
    } else {
      process.env.TINYBOTS_CONFIG = previous
    }
  }
}

function sampleConfig(title: string): Record<string, unknown> {
  return {
    schema_version: 1,
    owner: { name: 'Nika', confirms_merge: true },
    data_dir: 'data',
    delivery: 'clipboard',
    bots: [{ id: 'mira', name: 'Мира', role: 'код', executor_for_merge: true }],
    projects: [
      {
        id: 'kit',
        title,
        lead: 'mira',
        owner: 'owner',
        merge_executor: 'mira',
        source: { files: { path: 'app' } },
        chats: [
          {
            id: 'build',
            title: 'Сборка',
            lead: 'mira',
            members: ['mira'],
            rules: { do: 'код и проверка', dont: 'не будить весь чат' },
            context: [],
            economy: { wake: 'mentioned_only', reply_limit: 'short' },
          },
        ],
      },
    ],
    economy: {
      defaults: { wake: 'mentioned_only', reply_limit: 'short', max_wakes_per_task: 3 },
      stale_after_hours: 6,
    },
  }
}

test('шагов семь, и это не больше потолка', () => {
  expect(SETUP_STEPS).toHaveLength(7)
  expect(SETUP_STEPS.length).toBeLessThanOrEqual(SETUP_STEP_LIMIT)
  expect(SETUP_STEP_LIMIT).toBe(10)
  const doc = readFileSync(path.join(repoRoot(), 'docs', 'setup-manual.md'), 'utf8')
  for (const step of SETUP_STEPS) {
    expect(doc).toContain(step.title)
  }
  expect(doc.toLowerCase()).toContain('чек-лист')
  expect(doc).toContain('10 минут')
  expect(doc).toContain(GIT_HIDDEN_WARNING)
})

test('без git вкладка скрывается, со своим репозиторием — нет', () => {
  expect(judgeSource({ exists: false, directory: false, ownRepo: false })).toMatchObject({ ok: false })
  expect(judgeSource({ exists: true, directory: false, ownRepo: false })).toMatchObject({
    ok: false,
    reason: 'нужна папка, не файл',
  })
  expect(judgeSource({ exists: true, directory: true, ownRepo: false })).toEqual({
    ok: true,
    path: '',
    git: false,
    warning: GIT_HIDDEN_WARNING,
  })
  const ready = judgeSource({ exists: true, directory: true, ownRepo: true })
  expect(ready).toMatchObject({ ok: true, git: true, warning: null })
})

test('проверка папки: нет .git, есть свой git, файл и выход наверх', async () => {
  const root = scratch()
  const base = path.join(root, 'proj')
  mkdirSync(path.join(base, 'plain'), { recursive: true })
  writeFileSync(path.join(base, 'plain', 'note.txt'), 'demo\n')
  const plain = await inspectSource(root, 'proj/config.yaml', 'plain')
  expect(plain).toMatchObject({ ok: true, git: false, warning: GIT_HIDDEN_WARNING })

  const repo = path.join(base, 'repo')
  mkdirSync(repo)
  writeFileSync(path.join(repo, 'note.txt'), 'demo\n')
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore', env: gitEnv() })
  const withGit = await inspectSource(root, 'proj/config.yaml', 'repo')
  expect(withGit).toMatchObject({ ok: true, git: true, warning: null })

  writeFileSync(path.join(base, 'note.txt'), 'x\n')
  const file = await inspectSource(root, 'proj/config.yaml', 'note.txt')
  expect(file).toMatchObject({ ok: false, reason: 'нужна папка, не файл' })
  const missing = await inspectSource(root, 'proj/config.yaml', 'nope')
  expect(missing).toMatchObject({ ok: false, reason: 'путь не найден' })
  const up = await inspectSource(root, 'proj/config.yaml', '../plain')
  expect(up.ok).toBe(false)
})

test('ссылка на папку вне корня не считается источником', async () => {
  const root = scratch()
  const outside = scratch()
  mkdirSync(path.join(root, 'proj'), { recursive: true })
  symlinkSync(outside, path.join(root, 'proj', 'link'))
  const report = await inspectSource(root, 'proj/config.yaml', 'link')
  expect(report.ok).toBe(false)
  expect(JSON.stringify(report)).not.toContain(outside)
})

test('нет config.yaml — мастер нужен, демо и пример не перезаписываются', () => {
  const root = scratch()
  const fresh = withoutConfigEnv(() => resolveSetupTarget(root))
  expect(fresh).toMatchObject({ ok: true, target: 'config.yaml', exists: false, required: true, writable: true, demo: true })

  writeFileSync(path.join(root, 'config.yaml'), 'schema_version: 1\n')
  const present = withoutConfigEnv(() => resolveSetupTarget(root))
  expect(present).toMatchObject({ exists: true, required: false, writable: true, demo: false })

  const missing = resolveSetupTarget(root, 'data/fresh/config.yaml')
  expect(missing).toMatchObject({ exists: false, required: true, writable: true, demo: false })

  const demo = resolveSetupTarget(repoRoot(), 'demo/sets/primary/config.yaml')
  expect(demo).toMatchObject({ writable: false, required: false })
  const example = resolveSetupTarget(repoRoot(), 'config.example.yaml')
  expect(example).toMatchObject({ writable: false })
})

test('схема до записи: битое тело не создаёт файл', async () => {
  const root = scratch()
  mkdirSync(path.join(root, 'proj'))
  const bad = await saveSetup(root, 'proj/config.yaml', {
    confirm_overwrite: false,
    config: { ...sampleConfig('Demo Kit'), delivery: 'nope' },
  })
  expect(bad.status).toBe(422)
  expect(bad.body.error).toBe('invalid_config')
  expect(existsSync(path.join(root, 'proj', 'config.yaml'))).toBe(false)
})

test('валидный конфиг пишется, повтор без подтверждения его не трогает', async () => {
  const root = scratch()
  const rel = 'proj/config.yaml'
  const absolute = path.join(root, 'proj', 'config.yaml')
  const first = await saveSetup(root, rel, { config: sampleConfig('Demo Kit') })
  expect(first).toMatchObject({ status: 200, body: { ok: true, file: rel } })
  const text = readFileSync(absolute, 'utf8')
  const parsed = parseConfigText(text, rel)
  expect(parsed.ok).toBe(true)
  if (parsed.ok) {
    expect(parsed.config.projects[0]?.title).toBe('Demo Kit')
  }

  const blocked = await saveSetup(root, rel, { confirm_overwrite: false, config: sampleConfig('Другой') })
  expect(blocked.status).toBe(409)
  expect(readFileSync(absolute, 'utf8')).toBe(text)

  const replaced = await saveSetup(root, rel, { confirm_overwrite: true, config: sampleConfig('Другой') })
  expect(replaced.status).toBe(200)
  const next = parseConfigText(readFileSync(absolute, 'utf8'), rel)
  expect(next.ok).toBe(true)
  if (next.ok) {
    expect(next.config.projects[0]?.title).toBe('Другой')
  }
})

test('демо-файл и ссылка наружу не становятся целью записи', async () => {
  const example = path.join(repoRoot(), 'config.example.yaml')
  const before = readFileSync(example, 'utf8')
  const denied = await saveSetup(repoRoot(), 'config.example.yaml', {
    confirm_overwrite: true,
    config: sampleConfig('Demo Kit'),
  })
  expect(denied.status).toBe(403)
  expect(readFileSync(example, 'utf8')).toBe(before)

  const root = scratch()
  const outside = scratch()
  symlinkSync(outside, path.join(root, 'link'))
  const escaped = await saveSetup(root, 'link/config.yaml', {
    confirm_overwrite: true,
    config: sampleConfig('Demo Kit'),
  })
  expect(escaped.status).toBe(403)
  expect(existsSync(path.join(outside, 'config.yaml'))).toBe(false)
})

test('токен записи сравнивается целиком', () => {
  expect(tokensMatch('abcd', 'abcd')).toBe(true)
  expect(tokensMatch('abcd', 'abce')).toBe(false)
  expect(tokensMatch('abcd', 'abc')).toBe(false)
  expect(tokensMatch('abcd', undefined)).toBe(false)
})

function call(
  port: number,
  method: string,
  pathname: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: BIND_HOST, port, path: pathname, method, headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          try {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) as unknown })
          } catch {
            resolve({ status: res.statusCode ?? 0, json: text })
          }
        })
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

test('HTTP: порт, токен, схема и отказ затереть файл', async () => {
  const rel = 'data/setup-http/config.yaml'
  const absolute = path.join(repoRoot(), rel)
  rmSync(path.dirname(absolute), { recursive: true, force: true })
  let server: RunningServer | undefined
  try {
    server = await startServer({ port: 0, configPath: rel })
    const host = `${BIND_HOST}:${server.port}`
    const opened = await call(server.port, 'GET', '/api/setup', { Host: host })
    expect(opened.status).toBe(200)
    const info = opened.json as { csrf?: string; required?: boolean; steps?: unknown[] }
    expect(info.required).toBe(true)
    expect(info.steps).toHaveLength(7)
    const csrf = info.csrf ?? ''
    expect(csrf.length).toBeGreaterThan(10)

    const otherPort = await call(
      server.port,
      'POST',
      '/api/setup',
      { Host: host, Origin: `http://${BIND_HOST}:9`, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
      JSON.stringify({ config: sampleConfig('Demo Kit') }),
    )
    expect(otherPort.status).toBe(403)
    expect(otherPort.json).toMatchObject({ error: 'forbidden_host' })

    const noToken = await call(
      server.port,
      'POST',
      '/api/setup',
      { Host: host, Origin: `http://${host}`, 'Content-Type': 'application/json' },
      JSON.stringify({ config: sampleConfig('Demo Kit') }),
    )
    expect(noToken.status).toBe(403)
    expect(noToken.json).toMatchObject({ error: 'csrf' })

    const headers = {
      Host: host,
      Origin: `http://${host}`,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
    }
    const invalid = await call(server.port, 'POST', '/api/setup', headers, JSON.stringify({ config: { schema_version: 1 } }))
    expect(invalid.status).toBe(422)
    expect(invalid.json).toMatchObject({ error: 'invalid_config' })
    expect(existsSync(absolute)).toBe(false)

    const closed = await call(server.port, 'POST', '/health', headers, '{}')
    expect(closed.status).toBe(405)

    const saved = await call(server.port, 'POST', '/api/setup', headers, JSON.stringify({ config: sampleConfig('Demo Kit') }))
    expect(saved.status).toBe(200)
    expect(saved.json).toMatchObject({ ok: true, file: rel })
    expect(JSON.stringify(saved.json)).not.toContain(repoRoot())
    const text = readFileSync(absolute, 'utf8')
    expect(parseConfigText(text, rel).ok).toBe(true)

    const again = await call(
      server.port,
      'POST',
      '/api/setup',
      headers,
      JSON.stringify({ confirm_overwrite: false, config: sampleConfig('Другой') }),
    )
    expect(again.status).toBe(409)
    expect(readFileSync(absolute, 'utf8')).toBe(text)
  } finally {
    await server?.close()
    rmSync(path.dirname(absolute), { recursive: true, force: true })
  }
})

test('описание мастера отдаёт шаги и не светит абсолютный путь', () => {
  const root = scratch()
  const sent = withoutConfigEnv(() => describeSetup(root, undefined, 'csrf-demo'))
  expect(sent.status).toBe(200)
  expect(sent.body.steps).toEqual(SETUP_STEPS)
  expect(JSON.stringify(sent.body)).not.toContain(root)
})
