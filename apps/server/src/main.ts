/**
 * FILE: apps/server/src/main.ts
 * НАЗНАЧЕНИЕ: команда npm start после сборки и вход sidecar.
 * ВХОД: --browser (только argv) или --session-stdin (токен одной строкой, не в лог).
 * ВЫХОД: процесс на 127.0.0.1. Браузер открывается только в режиме --browser.
 * Собранный sidecar без токена выходит сразу. Окружение режим не включает.
 */

import path from 'node:path'
import { BIND_HOST, DESKTOP_PORT, resolvePort } from './bind.js'
import { loadDotEnv } from './env.js'
import { runKeyringSelftest, runKeyringWorker, runningAsSea } from './llm/keyring-native.js'
import { openBrowser } from './open-browser.js'
import { repoRoot } from './root.js'
import { planLaunch, SESSION_TOKEN_BYTES, tokenFromLine } from './session.js'
import { startServer } from './server.js'

void main()

async function main(): Promise<void> {
  if (process.argv.includes('--keyring-worker')) {
    process.exit(await runKeyringWorker(process.argv))
  }

  if (process.argv.includes('--keyring-selftest')) {
    process.exit(await runKeyringSelftest())
  }

  const plan = planLaunch(process.argv.slice(2), runningAsSea(), process.env)
  if (plan.kind === 'refuse') {
    console.error(plan.message)
    process.exit(1)
  }

  const root = repoRoot()
  process.chdir(root)
  loadDotEnv(path.join(root, '.env'))

  const requestedHost = process.env.HOST
  if (
    requestedHost !== undefined &&
    requestedHost.trim() !== '' &&
    requestedHost !== BIND_HOST &&
    requestedHost.toLowerCase() !== 'localhost'
  ) {
    // Само значение не печатаем: в переменной мог оказаться не адрес.
    console.warn('HOST проигнорирован: сервер слушает только 127.0.0.1')
  }

  if (plan.kind === 'desktop') {
    const token = await readSessionToken()
    if (token === null) {
      console.error('Токен сессии отклонён')
      process.exit(1)
    }
    try {
      const running = await startServer({
        port: DESKTOP_PORT,
        sessionToken: token,
        desktopHost: true,
      })
      console.log(`TinyBots: http://${BIND_HOST}:${running.port}`)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code === 'EADDRINUSE') {
        console.error('Порт 8787 занят другим процессом')
      } else {
        console.error('Сервер не стартовал')
      }
      process.exit(1)
    }
    return
  }

  const port = resolvePort(process.env.PORT, DESKTOP_PORT)
  const running = await startServer({ port })
  const url = `http://${BIND_HOST}:${running.port}`
  console.log(`TinyBots: ${url}`)
  openBrowser(url)
}

async function readSessionToken(): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  const stdin = process.stdin
  const timer = setTimeout(() => {
    stdin.destroy()
  }, 5_000)
  try {
    for await (const chunk of stdin) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.length
      if (size > SESSION_TOKEN_BYTES * 4) {
        return null
      }
      chunks.push(buf)
      const text = Buffer.concat(chunks).toString('utf8')
      const nl = text.indexOf('\n')
      if (nl !== -1) {
        return tokenFromLine(text.slice(0, nl))
      }
    }
  } finally {
    clearTimeout(timer)
  }
  return null
}
