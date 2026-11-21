/**
 * FILE: apps/server/src/server.ts
 * НАЗНАЧЕНИЕ: HTTP пульта на 127.0.0.1.
 * ВХОД: config.yaml (или демо-набор) и сборка apps/web/dist, если она есть.
 * ВЫХОД: /health, /api/bots, пульт, Git, дерево файлов, markdown и страница.
 * Чужой Host, Origin или чужой порт — 403. Запись — POST /api/setup, решения по мержу,
 * POST /api/chat и POST /api/brief/send: тот же requestAllowed, плюс непустой Origin и токен.
 * На всём /api Sec-Fetch-Site: только same-origin, none или отсутствие заголовка.
 * same-site и cross-site — 403 до сети, чтобы чужая страница не тратила ключ.
 * Нет заголовка Origin или он пустой — чтение пускает (так открывают страницу), запись нет.
 * Исключение: GET /api/setup/source читает диск и запускает git.
 * Токен обязателен до этого. Чужой Origin, строка null и чужой порт — 403.
 * Заголовка Origin у GET с той же страницы нет: браузер его не ставит, и это не чужой сайт.
 * Строка null — это не пустой заголовок. requestAllowed отклоняет её и на чтении, и на записи:
 * непрозрачный origin не разбирается как http://127.0.0.1.
 * Параллельные POST идут по одному. Любой другой не-GET отвечает 405.
 * / и /setup не отдаются во фрейме.
 * Битый конфиг не роняет процесс: API отдаёт файл, строку и причину.
 * GET /api/brief собирает бриф. Текста в ответе нет, если главный на паузе или не задан.
 * Решение по мержу пишется в outbox и не меняет статус, пока не вызван POST /api/sync/apply.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { serve, type HttpBindings, type ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import type { Server } from 'node:http'
import { BIND_HOST } from './bind.js'
import { describeSetup, saveSetup } from './config/setup.js'
import { inspectSource } from './config/source-check.js'
import { newCsrfToken, tokensMatch } from './csrf.js'
import { FALLBACK_HTML } from './fallback-html.js'
import { briefStatus, loadBrief } from './briefs/load.js'
import { readProjectDoc, readProjectTree } from './files/index.js'
import { readGitSummary } from './git/index.js'
import { fetchSiteAllowed, requestAllowed } from './guard.js'
import { postBotChat, postBriefSend, readBotChat } from './llm/http.js'
import { loadLauncher, type LaunchOptions, type LauncherView } from './launcher/view.js'
import { postDecision, postSync } from './merge/http.js'
import type { ConfigFailure } from './config/load.js'
import { repoRoot } from './root.js'

export type RunningServer = {
  port: number
  address: string
  close: () => Promise<void>
}

export type AppOptions = LaunchOptions & {
  /** Порт, который процесс уже занял. Пока 0 — ни один Host не подходит. */
  boundPort?: { current: number }
}

function hostFromContext(c: { req: { header: (name: string) => string | undefined }; env: HttpBindings }): string | undefined {
  return c.req.header('host') ?? c.env.incoming.headers.host
}

function publish(result: LauncherView | ConfigFailure): { body: LauncherView | ConfigFailure; status: 200 | 422 } {
  if (!result.ok) {
    return { body: result, status: 422 }
  }
  return { body: result, status: 200 }
}

const SETUP_BODY_LIMIT = 65_536

function isWrite(method: string, pathname: string): boolean {
  return method === 'POST' && (
    pathname === '/api/setup'
    || pathname === '/api/merge/decide'
    || pathname === '/api/sync/apply'
    || pathname === '/api/chat'
    || pathname === '/api/brief/send'
  )
}

function isSetupPath(pathname: string): boolean {
  return pathname === '/setup' || pathname === '/setup/' || pathname === '/api/setup' || pathname.startsWith('/api/setup/')
}

/**
 * Чтение пускает запрос без Origin и с пустым Origin: так открывают страницу.
 * Запись так нельзя: иначе порт Origin не с чем сверить.
 * Строка null — непрозрачный origin из четырёх букв. Её не пускает уже requestAllowed,
 * потому что это не адрес http(s) на loopback. Здесь она тоже не считается «есть Origin».
 */
function writeOriginPresent(origin: string | undefined): boolean {
  if (origin === undefined) {
    return false
  }
  const trimmed = origin.trim()
  return trimmed.length > 0 && trimmed.toLowerCase() !== 'null'
}

type QueuedReply = { status: number; body: Record<string, unknown> }

/** Очередь одного маршрута: второй POST ждёт, пока первый закончит запись. */
function queueWrites(): <T extends QueuedReply>(job: () => Promise<T>) => Promise<T> {
  let chain: Promise<void> = Promise.resolve()
  return (job) => {
    const run = chain.then(job, job)
    chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

export function createApp(options?: AppOptions): Hono<{ Bindings: HttpBindings }> {
  const app = new Hono<{ Bindings: HttpBindings }>()
  const root = repoRoot()
  const csrf = newCsrfToken()
  const boundPort = options?.boundPort ?? { current: 0 }
  const setupQueue = queueWrites()
  const botsFile = path.join(root, 'demo', 'bots.json')
  const webDist = path.join(root, 'apps', 'web', 'dist')
  const indexFile = path.join(webDist, 'index.html')
  const hasWeb = existsSync(indexFile)

  const launcher = (): LauncherView | ConfigFailure => loadLauncher(root, options)

  app.use('*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    const host = hostFromContext(c)
    const origin = c.req.header('origin')
    const pathname = new URL(c.req.url).pathname
    if (pathname === '/' || isSetupPath(pathname)) {
      c.header('X-Frame-Options', 'DENY')
      c.header('Content-Security-Policy', "frame-ancestors 'none'")
    }
    // До записи и до GitHub/модели: same-site с другого порта тот же 127.0.0.1 тоже 403.
    if ((pathname === '/api' || pathname.startsWith('/api/')) && !fetchSiteAllowed(c.req.header('sec-fetch-site'))) {
      return c.json({ error: 'forbidden_host' }, 403)
    }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      if (!isWrite(c.req.method, pathname)) {
        return c.json({ error: 'writes_not_ready' }, 405)
      }
      // Порт проверяет тот же requestAllowed, что и чтение. Без Origin запись не пускаем.
      if (!writeOriginPresent(origin) || !requestAllowed(host, origin, boundPort.current)) {
        return c.json({ error: 'forbidden_host' }, 403)
      }
      await next()
      return
    }
    if (!requestAllowed(host, origin, boundPort.current)) {
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

  app.get('/api/launcher', (c) => {
    const sent = publish(launcher())
    if (sent.status === 200 && sent.body.ok) {
      return c.json({ ...sent.body, csrf }, sent.status)
    }
    return c.json(sent.body, sent.status)
  })

  app.get('/api/projects', (c) => {
    const result = launcher()
    if (!result.ok) {
      return c.json(result, 422)
    }
    return c.json({ ok: true, projects: result.projects })
  })

  app.get('/api/roster', (c) => {
    const result = launcher()
    if (!result.ok) {
      return c.json(result, 422)
    }
    return c.json({ ok: true, bots: result.bots })
  })

  app.get('/api/chats', (c) => {
    const result = launcher()
    if (!result.ok) {
      return c.json(result, 422)
    }
    return c.json({ ok: true, chats: result.chats })
  })

  app.get('/api/notes', (c) => {
    const result = launcher()
    if (!result.ok) {
      return c.json(result, 422)
    }
    return c.json({ ok: true, notes: result.notes })
  })

  app.get('/api/tasks', (c) => {
    const result = launcher()
    if (!result.ok) {
      return c.json(result, 422)
    }
    return c.json({ ok: true, tasks: result.tasks })
  })

  app.get('/api/sync', (c) => {
    const result = launcher()
    if (!result.ok) {
      return c.json(result, 422)
    }
    return c.json({ ok: true, synced_at: result.synced_at, synced_label: result.synced_label })
  })

  app.get('/api/git', async (c) => {
    c.header('Cache-Control', 'no-store')
    const sent = await readGitSummary(root, options?.configPath, c.req.query('project') ?? '')
    return c.json(sent.body, sent.status)
  })

  app.get('/api/files', async (c) => {
    c.header('Cache-Control', 'no-store')
    const sent = await readProjectTree(root, options?.configPath, c.req.query('project') ?? '')
    return c.json(sent.body, sent.status)
  })

  app.get('/api/docs', async (c) => {
    c.header('Cache-Control', 'no-store')
    const sent = await readProjectDoc(root, options?.configPath, c.req.query('project') ?? '', c.req.query('path') ?? '')
    return c.json(sent.body, sent.status)
  })

  app.get('/api/chat', (c) => {
    c.header('Cache-Control', 'no-store')
    const sent = readBotChat(root, options, c.req.query('bot') ?? '')
    return c.json(sent.body, sent.status)
  })

  app.get('/api/brief', (c) => {
    const body = loadBrief(root, options, {
      project: c.req.query('project') ?? '',
      chat: c.req.query('chat') ?? '',
      task: c.req.query('task') ?? '',
    })
    return c.json(body, briefStatus(body))
  })

  app.get('/api/setup', (c) => {
    // Токен и флаг «файла ещё нет» нельзя отдать из кэша: после записи пульт должен увидеть файл.
    c.header('Cache-Control', 'no-store')
    const sent = describeSetup(root, options?.configPath, csrf)
    return c.json(sent.body, sent.status)
  })

  app.get('/api/setup/source', async (c) => {
    c.header('Cache-Control', 'no-store')
    const host = hostFromContext(c)
    const origin = c.req.header('origin')
    // Чужой сайт не должен дотянуть этот GET до диска и git.
    // Своя страница шлёт GET без Origin: браузер не ставит его на same-origin.
    // Origin, если он есть, обязан быть адресом этой страницы. Токен — до диска.
    if (!requestAllowed(host, origin, boundPort.current)) {
      return c.json({ error: 'forbidden_host' }, 403)
    }
    if (!tokensMatch(csrf, c.req.header('x-csrf-token'))) {
      return c.json({ error: 'csrf' }, 403)
    }
    const report = await inspectSource(root, options?.configPath, c.req.query('path') ?? '')
    return c.json(report, report.ok ? 200 : 422)
  })

  app.post('/api/setup', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (!tokensMatch(csrf, c.req.header('x-csrf-token'))) {
      return c.json({ error: 'csrf' }, 403)
    }
    const raw = await c.req.text()
    if (raw.length > SETUP_BODY_LIMIT) {
      return c.json({ error: 'too_large' }, 413)
    }
    let payload: unknown
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      return c.json({ error: 'json' }, 400)
    }
    const saved = await setupQueue(() => saveSetup(root, options?.configPath, payload))
    return c.json(saved.body, saved.status)
  })

  app.post('/api/merge/decide', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (!tokensMatch(csrf, c.req.header('x-csrf-token'))) {
      return c.json({ error: 'csrf' }, 403)
    }
    const raw = await c.req.text()
    if (raw.length > SETUP_BODY_LIMIT) {
      return c.json({ error: 'too_large' }, 413)
    }
    let payload: unknown
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      return c.json({ error: 'json' }, 400)
    }
    const saved = await setupQueue(() => postDecision(root, options, payload))
    return c.json(saved.body, saved.status)
  })

  app.post('/api/chat', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (!tokensMatch(csrf, c.req.header('x-csrf-token'))) {
      return c.json({ error: 'csrf' }, 403)
    }
    const raw = await c.req.text()
    if (raw.length > SETUP_BODY_LIMIT) {
      return c.json({ error: 'too_large' }, 413)
    }
    let payload: unknown
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      return c.json({ error: 'json' }, 400)
    }
    const saved = await setupQueue(() => postBotChat(root, options, payload))
    return c.json(saved.body, saved.status)
  })

  app.post('/api/brief/send', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (!tokensMatch(csrf, c.req.header('x-csrf-token'))) {
      return c.json({ error: 'csrf' }, 403)
    }
    const raw = await c.req.text()
    if (raw.length > SETUP_BODY_LIMIT) {
      return c.json({ error: 'too_large' }, 413)
    }
    let payload: unknown
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      return c.json({ error: 'json' }, 400)
    }
    const saved = await setupQueue(() => postBriefSend(root, options, payload))
    return c.json(saved.body, saved.status)
  })

  app.post('/api/sync/apply', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (!tokensMatch(csrf, c.req.header('x-csrf-token'))) {
      return c.json({ error: 'csrf' }, 403)
    }
    const saved = await setupQueue(() => postSync(root, options))
    return c.json(saved.body, saved.status)
  })

  // Абсолютный root у serveStatic в типах не обещан, поэтому путь относительно cwd.
  if (hasWeb) {
    const relativeDist = path.relative(process.cwd(), webDist)
    app.use('/*', serveStatic({ root: relativeDist }))
  }

  app.get('*', async (c) => {
    const pathname = new URL(c.req.url).pathname
    if (pathname.includes('.') && pathname !== '/index.html') {
      return c.text('не найдено', 404)
    }
    if (hasWeb) {
      return c.html(await readFile(indexFile, 'utf8'))
    }
    return c.html(FALLBACK_HTML)
  })

  return app
}

function asNodeServer(server: ServerType): Server {
  return server as Server
}

/**
 * Поднять сервер. hostname передаётся всегда: без него listen открывает все интерфейсы.
 * configPath и now нужны тестам: подмена конфига и часов без перезапуска процесса-родителя.
 */
export async function startServer(options?: { port?: number } & AppOptions): Promise<RunningServer> {
  const boundPort = options?.boundPort ?? { current: 0 }
  const app = createApp({ ...options, boundPort })
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
      const listening = server.address()
      if (listening && typeof listening !== 'string') {
        boundPort.current = listening.port
      }
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
