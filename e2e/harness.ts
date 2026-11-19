/**
 * FILE: e2e/harness.ts
 * НАЗНАЧЕНИЕ: запуск и остановка пульта из e2e.
 * Сервер — отдельный процесс node e2e/boot.mjs, чтобы бандл Playwright не подменял корень репозитория.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'

export type Running = {
  port: number
  stop: () => Promise<void>
}

const NOW = '2026-11-19T10:00:00.000Z'

export function origin(port: number): string {
  return `http://127.0.0.1:${port}`
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, 2_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

export async function boot(configPath: string, nowIso = NOW): Promise<Running> {
  const child = spawn(process.execPath, [path.join(process.cwd(), 'e2e', 'boot.mjs')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TINYBOTS_CONFIG: configPath,
      TINYBOTS_NOW: nowIso,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const port = await new Promise<number>((resolve, reject) => {
    let out = ''
    const stderr: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`сервер не поднялся: ${Buffer.concat(stderr).toString('utf8')}`))
    }, 15_000)
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
    })
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
      const match = out.match(/READY (\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve(Number(match[1]))
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`сервер вышел с кодом ${code}: ${Buffer.concat(stderr).toString('utf8')}`))
    })
  })
  return { port, stop: () => stop(child) }
}
