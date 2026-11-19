/**
 * FILE: apps/server/src/briefs/api.test.ts
 * НАЗНАЧЕНИЕ: HTTP брифа. Успех отдаёт текст и ссылку. Пауза и пустой главный — отказ без поля text.
 */

import { expect, test, afterAll, beforeAll } from 'vitest'
import { BIND_HOST } from '../bind.js'
import { startServer, type RunningServer } from '../server.js'

const NOW = '2026-11-19T10:00:00.000Z'
let primary: RunningServer | undefined
let leads: RunningServer | undefined

beforeAll(async () => {
  primary = await startServer({
    port: 0,
    configPath: 'demo/sets/primary/config.yaml',
    now: () => new Date(NOW),
  })
  leads = await startServer({
    port: 0,
    configPath: 'demo/sets/lead-cases/config.yaml',
    now: () => new Date(NOW),
  })
})

afterAll(async () => {
  await primary?.close()
  await leads?.close()
})

function url(server: RunningServer, pathname: string): string {
  return `http://${BIND_HOST}:${server.port}${pathname}`
}

test('primary: бриф уходит Биту, ссылка с его id, очередь выключена', async () => {
  if (!primary) {
    throw new Error('сервер не запущен')
  }
  const res = await fetch(url(primary, '/api/brief?project=demo-game&chat=build&task=task-01'))
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    ok: boolean
    text: string
    recipient: string
    href: string | null
    via: string
    delivery: string
    lines: number
    fallback: string | null
  }
  expect(body.ok).toBe(true)
  expect(body.recipient).toBe('Уйдёт: Бит')
  expect(body.via).toBe('chat')
  expect(body.href).toBe('grokbot://app/v1/agent?id=demo-bit')
  expect(body.fallback).toBe('Если чат не открылся, откройте Бит вручную.')
  expect(body.delivery).toBe('clipboard')
  expect(body.lines).toBeLessThanOrEqual(8)
  expect(body.text).toContain('Что: Превью в доке')
  expect(body.text).toContain('Лимит ответа: короткий')
  expect(body.text.includes('Ава')).toBe(false)
})

test('пауза и пустой главный не отдают текст брифа', async () => {
  if (!leads) {
    throw new Error('сервер не запущен')
  }
  const paused = await fetch(url(leads, '/api/brief?project=demo-loom&chat=hold&task=task-hold'))
  expect(paused.status).toBe(409)
  const pausedBody = (await paused.json()) as { ok: boolean; text?: string; message: string; hint: string }
  expect(pausedBody.ok).toBe(false)
  expect(pausedBody.text).toBeUndefined()
  expect(pausedBody.message).toContain('Тишь')
  expect(pausedBody.hint).toBe('Выберите главного')

  const missing = await fetch(url(leads, '/api/brief?project=demo-bare&chat=bare&task=task-bare'))
  expect(missing.status).toBe(409)
  const missingBody = (await missing.json()) as { ok: boolean; text?: string; message: string; hint: string }
  expect(missingBody.ok).toBe(false)
  expect(missingBody.text).toBeUndefined()
  expect(missingBody.message).toContain('не задан')
  expect(missingBody.hint).toBe('Выберите главного')
})

test('нет главного в чате — берём главного проекта, без ссылки если id пуст', async () => {
  if (!leads) {
    throw new Error('сервер не запущен')
  }
  const res = await fetch(url(leads, '/api/brief?project=demo-loom&chat=relay&task=task-relay'))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { recipient: string; via: string; href: string | null; fallback: string | null }
  expect(body.recipient).toBe('Уйдёт: Нить')
  expect(body.via).toBe('project')
  expect(body.href).toBeNull()
  expect(body.fallback).toBe('Если чат не открылся, откройте Нить вручную.')
})
