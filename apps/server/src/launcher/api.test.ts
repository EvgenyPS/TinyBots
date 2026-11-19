/**
 * FILE: apps/server/src/launcher/api.test.ts
 * НАЗНАЧЕНИЕ: HTTP API пульта. Битый конфиг отвечает 422, /health остаётся 200.
 * Маршруты проектов, состава, чатов, записок, задач и синка читают тот же разбор.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { BIND_HOST } from '../bind.js'
import { repoRoot } from '../root.js'
import { startServer, type RunningServer } from '../server.js'

const NOW = '2026-11-19T10:00:00.000Z'
let primary: RunningServer | undefined
let broken: RunningServer | undefined
let brokenDir = ''

beforeAll(async () => {
  primary = await startServer({
    port: 0,
    configPath: 'demo/sets/primary/config.yaml',
    now: () => new Date(NOW),
  })
  const dataRoot = path.join(repoRoot(), 'data')
  mkdirSync(dataRoot, { recursive: true })
  brokenDir = mkdtempSync(path.join(dataRoot, 'vitest-b3-'))
  writeFileSync(path.join(brokenDir, 'config.yaml'), 'schema_version: [', 'utf8')
  const relative = path.relative(repoRoot(), path.join(brokenDir, 'config.yaml')).split(path.sep).join('/')
  broken = await startServer({ port: 0, configPath: relative, now: () => new Date(NOW) })
})

afterAll(async () => {
  await primary?.close()
  await broken?.close()
  if (brokenDir) {
    rmSync(brokenDir, { recursive: true, force: true })
  }
})

function url(server: RunningServer, pathname: string): string {
  return `http://${BIND_HOST}:${server.port}${pathname}`
}

test('API primary отдаёт проект, записку и метку синка', async () => {
  const server = primary
  if (!server) {
    throw new Error('сервер не запущен')
  }
  const view = (await (await fetch(url(server, '/api/launcher'))).json()) as {
    ok: boolean
    synced_label: string
    projects: Array<{ title: string }>
  }
  expect(view.ok).toBe(true)
  expect(view.projects[0]?.title).toBe('Demo Game')
  expect(view.synced_label).toBe('12:15')

  const projects = (await (await fetch(url(server, '/api/projects'))).json()) as { projects: unknown[] }
  const roster = (await (await fetch(url(server, '/api/roster'))).json()) as { bots: Array<{ name: string }> }
  const chats = (await (await fetch(url(server, '/api/chats'))).json()) as { chats: Array<{ title: string }> }
  const notes = (await (await fetch(url(server, '/api/notes'))).json()) as { notes: Array<{ bot_id: string; status: string }> }
  const tasks = (await (await fetch(url(server, '/api/tasks'))).json()) as { tasks: unknown[] }
  const sync = (await (await fetch(url(server, '/api/sync'))).json()) as { synced_label: string }
  expect(projects.projects.length).toBe(1)
  expect(roster.bots.map((bot) => bot.name)).toContain('Ава')
  expect(chats.chats[0]?.title).toBe('Сборка')
  expect(notes.notes.find((note) => note.bot_id === 'rev1')?.status).toBe('missing')
  expect(tasks.tasks.length).toBeGreaterThan(0)
  expect(sync.synced_label).toBe('12:15')

  const legacy = (await (await fetch(url(server, '/api/bots'))).json()) as Array<{ name: string }>
  expect(legacy.map((bot) => bot.name)).toContain('Ава')
})

test('битый YAML не роняет сервер: 422 с файлом, строкой и причиной, health 200', async () => {
  const server = broken
  if (!server) {
    throw new Error('сервер не запущен')
  }
  const health = await fetch(url(server, '/health'))
  expect(health.status).toBe(200)
  const first = await fetch(url(server, '/api/launcher'))
  expect(first.status).toBe(422)
  const body = (await first.json()) as { ok: boolean; file: string; line: number; reason: string }
  expect(body.ok).toBe(false)
  expect(body.file.endsWith('config.yaml')).toBe(true)
  expect(body.line).toBe(1)
  expect(body.reason.length).toBeGreaterThan(0)
  const second = await fetch(url(server, '/api/projects'))
  expect(second.status).toBe(422)
  const again = await fetch(url(server, '/health'))
  expect(again.status).toBe(200)
})
