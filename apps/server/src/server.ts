/**
 * FILE: apps/server/src/server.ts
 * НАЗНАЧЕНИЕ: HTTP-каркас пульта.
 * ВХОД: demo/bots.json и, если есть, сборка apps/web/dist.
 * ВЫХОД: /health, /api/bots и страница Hello TinyBots.
 * Слушаем только BIND_HOST. Запись отвечает 405, пока нет CSRF (PR 3).
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { serve, type HttpBindings, type ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import type { Server } from 'node:http'
import { BIND_HOST } from './bind.js'
import { FALLBACK_HTML } from './fallback-html.js'
import { requestAllowed } from './guard.js'
import { repoRoot } from './root.js'

export type RunningServer = {
  port: number
  address: string
  close: () => Promise<void>
}

function hostFromContext(c: { req: { header: (name: string) => string | undefined }; env: HttpBindings }): string | undefined {
  return c.req.header('host') ?? c.env.incoming.headers.host
}

export function createApp(): Hono<{ Bindings: HttpBindings }> {
  const app = new Hono<{ Bindings: HttpBindings }>()
  const root = repoRoot()
  const botsFile = path.join(root, 'demo', 'bots.json')
  const webDist = path.join(root, 'apps', 'web', 'dist')

  app.use('*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    // TODO(PR 3): CSRF-токен. Пока любого не-GET нет, запись закрыта целиком.
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      return c.json({ error: 'writes_not_ready' }, 405)
    }
    const host = hostFromContext(c)
    if (!requestAllowed(host, c.req.header('origin'))) {
      return c.json({ error: 'forbidden_host' }, 403)
    }
    await next()
  })

  app.get('/health', (c) => c.json({ ok: true }))

  app.get('/api/bots', async (c) => {
    try {
      const raw = await readFile(botsFile, 'utf8')
      const data: unknown = JSON.parse(raw) as unknown
      if (!Array.isArray(data)) {
        return c.json({ error: 'demo_bots_invalid' }, 500)
      }
      return c.json(data)
    } catch {
      // Путь и текст исключения наружу не отдаём.
      return c.json({ error: 'demo_bots_unreadable' }, 500)
    }
  })

  // Абсолютный root у serveStatic в типах не обещан, поэтому путь относительно cwd.
  if (existsSync(path.join(webDist, 'index.html'))) {
    const relativeDist = path.relative(process.cwd(), webDist)
    app.use('/*', serveStatic({ root: relativeDist }))
  }

  app.get('*', (c) => c.html(FALLBACK_HTML))

  return app
}

function asNodeServer(server: ServerType): Server {
  return server as Server
}

/**
 * Поднять сервер. hostname передаётся всегда: без него listen открывает все интерфейсы.
 */
export async function startServer(options?: { port?: number }): Promise<RunningServer> {
  const app = createApp()
  const port = options?.port ?? 8787
  const server = asNodeServer(
    serve({
      fetch: app.fetch,
      hostname: BIND_HOST,
      port,
      // Не подменяем глобальные Request/Response: иначе ломается fetch в том же процессе.
      overrideGlobalObjects: false,
    }),
  )

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
  })

  const info = server.address()
  if (info === null || typeof info === 'string') {
    server.close()
    throw new Error('Ожидали TCP-адрес loopback')
  }
  if (info.address !== BIND_HOST) {
    server.close()
    throw new Error('Сервер занял не loopback-адрес')
  }

  return {
    port: info.port,
    address: info.address,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err)
            return
          }
          resolve()
        })
      }),
  }
}
