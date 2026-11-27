/**
 * FILE: apps/server/src/llm/keyring-native.ts
 * НАЗНАЧЕНИЕ: открыть .node @napi-rs/keyring рядом с исполняемым файлом.
 * ВХОД: process.execPath. В SEA это sidecar, не системный node.
 * ВЫХОД: AsyncEntry или отказ без значения ключа в тексте.
 * Обычный node по-прежнему ходит в пакет через дочерний node -e.
 * Sidecar так не может: его execPath — он сам, флаг -e он не исполняет.
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { OS_SECRET_OPTIONS, OS_SECRET_SERVICE } from './os-secret.js'

type AsyncEntryLike = {
  getPassword: () => Promise<string | null>
  setPassword: (value: string) => Promise<void>
  deletePassword: () => Promise<boolean>
}

export type SeaKeyring = {
  AsyncEntry: new (
    service: string,
    username: string,
    options?: { linux: { store: 'secret-service' } },
  ) => AsyncEntryLike
}

const LINUX_OPTIONS = { linux: { store: 'secret-service' as const } }

function seaRequire(): NodeRequire {
  const url = import.meta.url
  if (typeof url === 'string' && url.startsWith('file:')) {
    return createRequire(url)
  }
  return createRequire(process.execPath)
}

export function runningAsSea(): boolean {
  try {
    const sea = seaRequire()('node:sea') as { isSea?: () => boolean }
    return typeof sea.isSea === 'function' && sea.isSea()
  } catch {
    return false
  }
}

/** Имена файлов, которые кладёт napi-rs. Рядом с exe ищем только их. */
export function keyringAddonNames(platform = process.platform, arch = process.arch): string[] {
  if (platform === 'win32' && arch === 'x64') {
    return ['keyring.win32-x64-msvc.node']
  }
  if (platform === 'win32' && arch === 'arm64') {
    return ['keyring.win32-arm64-msvc.node']
  }
  if (platform === 'linux' && arch === 'x64') {
    return ['keyring.linux-x64-gnu.node', 'keyring.linux-x64-musl.node']
  }
  if (platform === 'linux' && arch === 'arm64') {
    return ['keyring.linux-arm64-gnu.node', 'keyring.linux-arm64-musl.node']
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return ['keyring.darwin-arm64.node']
  }
  if (platform === 'darwin' && arch === 'x64') {
    return ['keyring.darwin-x64.node']
  }
  return []
}

export function findKeyringAddon(execPath = process.execPath): string | null {
  const dir = path.dirname(execPath)
  const roots = [dir, path.join(dir, 'resources')]
  for (const name of keyringAddonNames()) {
    for (const root of roots) {
      const file = path.join(root, name)
      if (existsSync(file)) {
        return file
      }
    }
  }
  return null
}

export function loadSeaKeyring(execPath = process.execPath): SeaKeyring | null {
  const file = findKeyringAddon(execPath)
  if (file === null) {
    return null
  }
  const mod = { exports: {} as SeaKeyring }
  try {
    process.dlopen(mod as unknown as NodeJS.Module, file)
  } catch {
    return null
  }
  if (typeof mod.exports.AsyncEntry !== 'function') {
    return null
  }
  return mod.exports
}

function failKind(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('ENOENT')) {
    return 'missing'
  }
  if (message.includes('DBus') || message.includes('dbus')) {
    return 'dbus'
  }
  return 'native'
}

/**
 * Дочерний процесс sidecar. Протокол тот же, что у node -e:
 * check пишет 1 или 0, write пишет ok, read пишет значение в stdout и больше никуда.
 */
export async function runKeyringWorker(argv: readonly string[]): Promise<number> {
  const marker = argv.indexOf('--keyring-worker')
  const positional = argv.slice(marker + 1).filter((item) => item !== '--')
  const name = positional[0]
  const mode = positional[1] ?? 'read'
  const replace = positional[2] === 'replace'
  if (typeof name !== 'string' || name.length === 0) {
    return 2
  }
  const native = loadSeaKeyring()
  if (native === null) {
    process.stderr.write('KEYRING_LOAD_FAIL missing\n')
    return 2
  }
  let entry: AsyncEntryLike
  try {
    entry = new native.AsyncEntry(OS_SECRET_SERVICE, name, OS_SECRET_OPTIONS)
  } catch {
    return 2
  }
  const filled = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0
  try {
    if (mode === 'check') {
      const value = await entry.getPassword()
      process.stdout.write(filled(value) ? '1' : '0')
      return 0
    }
    if (mode === 'write') {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const value = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
      if (!filled(value)) {
        return 2
      }
      const existing = await entry.getPassword()
      if (filled(existing) && !replace) {
        return 3
      }
      await entry.setPassword(value)
      process.stdout.write('ok')
      return 0
    }
    if (mode === 'read') {
      const value = await entry.getPassword()
      if (typeof value === 'string' && value.length > 0) {
        process.stdout.write(value)
      }
      return 0
    }
    return 2
  } catch {
    return 2
  }
}

/**
 * Проба для CI: записать случайное значение, прочитать и стереть.
 * Само значение в stdout не попадает. Учётная запись служебная, не ключ бота.
 */
export async function runKeyringSelftest(): Promise<number> {
  const native = loadSeaKeyring()
  if (native === null) {
    process.stderr.write('KEYRING_SEA_FAIL load\n')
    return 1
  }
  const secret = randomBytes(32).toString('hex')
  const hide = (text: string): string => text.split(secret).join('[secret]').slice(0, 180)
  try {
    const entry = new native.AsyncEntry('tinybots', 'TINYBOTS_SEA_SELFTEST', LINUX_OPTIONS)
    await entry.setPassword(secret)
    const got = await entry.getPassword()
    try {
      await entry.deletePassword()
    } catch {
      // Стирание не должно подменять результат сверки. Значение всё равно не печатаем.
    }
    if (got !== secret) {
      process.stderr.write('KEYRING_SEA_FAIL mismatch\n')
      return 1
    }
    process.stdout.write('KEYRING_SEA_OK\n')
    return 0
  } catch (error) {
    process.stderr.write(`KEYRING_SEA_FAIL ${failKind(error)} ${hide(error instanceof Error ? error.message : 'error')}\n`)
    return 1
  }
}
