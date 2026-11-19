/**
 * FILE: apps/server/src/server.test.ts
 * НАЗНАЧЕНИЕ: дымовая проверка каркаса.
 * Сервер слушает только 127.0.0.1, /health отвечает 200, чужой Host получает 403.
 */

import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { BIND_HOST } from './bind.js'
import { startServer, type RunningServer } from './server.js'

let running: RunningServer | undefined

beforeAll(async () => {
  running = await startServer({ port: 0 })
})

afterAll(async () => {
  await running?.close()
})

function requireServer(): RunningServer {
  if (!running) {
    throw new Error('сервер не запущен')
  }
  return running
}

function statusOf(options: { hostHeader: string; origin?: string }): Promise<number> {
  const server = requireServer()
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Host: options.hostHeader }
    if (options.origin !== undefined) {
      headers.Origin = options.origin
    }
    const req = http.request(
      {
        hostname: BIND_HOST,
        port: server.port,
        path: '/health',
        method: 'GET',
        headers,
      },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

function connectRejected(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve()
    }, 1500)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.end()
      reject(new Error(`удалось подключиться к ${host}`))
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

test('слушает только loopback и отвечает на /health', async () => {
  const server = requireServer()
  expect(server.address).toBe(BIND_HOST)
  expect(server.address).not.toBe('0.0.0.0')

  const source = readFileSync(fileURLToPath(new URL('./server.ts', import.meta.url)), 'utf8')
  expect(source.includes('hostname: BIND_HOST')).toBe(true)
  expect(source.includes('.listen(')).toBe(false)

  const res = await fetch(`http://${BIND_HOST}:${server.port}/health`)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean }
  expect(body.ok).toBe(true)
})

test('чужой Host и Origin отклоняются, свой Origin проходит', async () => {
  const server = requireServer()
  expect(await statusOf({ hostHeader: `evil.example:${server.port}` })).toBe(403)
  expect(await statusOf({ hostHeader: `${BIND_HOST}:${server.port}`, origin: 'http://evil.example' })).toBe(403)
  expect(await statusOf({ hostHeader: `${BIND_HOST}:${server.port}` })).toBe(200)
  expect(
    await statusOf({
      hostHeader: `${BIND_HOST}:${server.port}`,
      origin: `http://${BIND_HOST}:${server.port}`,
    }),
  ).toBe(200)
  const foreign = server.port === 65535 ? server.port - 1 : server.port + 1
  expect(await statusOf({ hostHeader: `${BIND_HOST}:${foreign}` })).toBe(403)
  expect(
    await statusOf({
      hostHeader: `${BIND_HOST}:${server.port}`,
      origin: `http://${BIND_HOST}:${foreign}`,
    }),
  ).toBe(403)
  expect(await statusOf({ hostHeader: BIND_HOST })).toBe(403)
})

test('запись закрыта, пока нет CSRF', async () => {
  const server = requireServer()
  const res = await fetch(`http://${BIND_HOST}:${server.port}/health`, { method: 'POST' })
  expect(res.status).toBe(405)
})

test('страница и список ботов из demo', async () => {
  const server = requireServer()
  const page = await fetch(`http://${BIND_HOST}:${server.port}/`)
  expect(page.status).toBe(200)
  expect(await page.text()).toContain('Hello TinyBots')

  const botsRes = await fetch(`http://${BIND_HOST}:${server.port}/api/bots`)
  expect(botsRes.status).toBe(200)
  const bots = (await botsRes.json()) as Array<{ id: string; name: string; role: string }>
  expect(bots.map((bot) => bot.name)).toContain('Ава')
  expect(bots.every((bot) => bot.id.length > 0 && bot.role.length > 0)).toBe(true)
})

test('внешний IPv4 хоста на этот порт не подключается', async () => {
  const server = requireServer()
  const hosts: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) {
      const family = String(item.family)
      if ((family === 'IPv4' || family === '4') && item.internal === false) {
        hosts.push(item.address)
      }
    }
  }
  await Promise.all(hosts.map((host) => connectRejected(host, server.port)))
})
