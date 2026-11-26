/**
 * FILE: apps/server/src/llm/os-secret.ts
 * НАЗНАЧЕНИЕ: прочитать ключ своего бота из хранилища ОС, не останавливая пульт.
 * ВХОД: имя переменной (учётная запись). Сервис всегда `tinybots`.
 * ВЫХОД: строка или null. null — записи нет, модуль не загрузился, хранилище недоступно или не ответило за 2 с.
 * Почему отдельный процесс: AsyncEntry.getPassword крутится в пуле libuv и не блокирует цикл событий,
 * но AbortSignal не прерывает уже зависший вызов D-Bus или окно Keychain. Такой поток из пула нечем убить,
 * а их всего несколько. Дочерний процесс снимается SIGKILL, значение из его stdout в журнал не пишется.
 * Ответ кэшируется до конца процесса, в том числе отрицательный после таймаута: повторно связку не трогаем.
 * На Linux только Secret Service. keyutils не используем: оно не переживает перезагрузку.
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { repoRoot } from '../root.js'

/** Сервис в Credential Manager, Keychain и Secret Service. */
export const OS_SECRET_SERVICE = 'tinybots'

/** Сколько ждём хранилище, потом берём .env и больше в этом процессе не спрашиваем. */
export const OS_SECRET_TIMEOUT_MS = 2_000

/** Потолок ответа дочернего процесса. Длиннее — это уже не ключ, буфер выбрасываем. */
const OS_SECRET_MAX_BYTES = 8_192

/**
 * На Linux без этого флага библиотека молча падает в keyutils.
 * Флаг на Windows и macOS игнорируется.
 */
export const OS_SECRET_OPTIONS = { linux: { store: 'secret-service' as const } }

const require = createRequire(import.meta.url)

let loaded: object | null | undefined

/**
 * Загрузка нативного модуля. Сам пароль здесь не читается.
 * Неудача запоминается: бинарник, которого нет, не пробуем на каждом ходе.
 */
export function loadOsKeyring(): object | null {
  if (loaded !== undefined) {
    return loaded
  }
  try {
    loaded = require('@napi-rs/keyring') as object
  } catch {
    loaded = null
  }
  return loaded
}

/** Сброс кэша модуля. Нужен тестам. */
export function resetOsKeyringCache(): void {
  loaded = undefined
}

/** Имя, сервис и Linux-хранилище, которые уходят в дочерний процесс. */
export function osEntrySpec(name: string): {
  service: string
  account: string
  options: typeof OS_SECRET_OPTIONS
} {
  return { service: OS_SECRET_SERVICE, account: name, options: OS_SECRET_OPTIONS }
}

/**
 * Текст дочернего процесса. Имени ключа в нём нет: имя приходит аргументом.
 * Значение пишется только в stdout, ошибки глотаются.
 */
export function childReadSource(): string {
  const service = JSON.stringify(OS_SECRET_SERVICE)
  const store = JSON.stringify(OS_SECRET_OPTIONS.linux.store)
  return [
    "import { AsyncEntry } from '@napi-rs/keyring'",
    'const name = process.argv[1]',
    'if (typeof name !== "string" || name.length === 0) process.exit(2)',
    'let entry',
    'try {',
    `  entry = new AsyncEntry(${service}, name, { linux: { store: ${store} } })`,
    '} catch {',
    '  process.exit(2)',
    '}',
    'try {',
    '  const value = await entry.getPassword()',
    '  if (typeof value === "string" && value.length > 0) process.stdout.write(value)',
    '} catch {',
    '  process.exit(2)',
    '}',
    '',
  ].join('\n')
}

function filled(value: string | null): string | null {
  if (value === null || value.trim().length === 0) {
    return null
  }
  return value
}

/**
 * Чтение в отдельном процессе. signal.abort убивает процесс, частичный stdout выбрасывается.
 * В журнал не пишем ни код выхода, ни байты: среди них может быть ключ.
 */
export function readOsSecret(name: string, signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null)
      return
    }
    const child = spawn(process.execPath, ['--input-type=module', '-e', childReadSource(), '--', name], {
      cwd: repoRoot(),
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      shell: false,
    })
    const chunks: Buffer[] = []
    let settled = false
    let dropped = false
    const finish = (value: string | null) => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', onAbort)
      chunks.length = 0
      resolve(value)
    }
    const onAbort = () => {
      dropped = true
      chunks.length = 0
      child.kill('SIGKILL')
      finish(null)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      const size = chunks.reduce((sum, item) => sum + item.length, 0)
      if (size + chunk.length > OS_SECRET_MAX_BYTES) {
        dropped = true
        chunks.length = 0
        child.kill('SIGKILL')
        return
      }
      chunks.push(chunk)
    })
    child.on('error', () => {
      chunks.length = 0
      finish(null)
    })
    child.on('close', () => {
      if (dropped || signal.aborted) {
        chunks.length = 0
        finish(null)
        return
      }
      const value = Buffer.concat(chunks).toString('utf8')
      chunks.length = 0
      finish(filled(value))
    })
  })
}

export type OsSecretReader = (name: string, signal: AbortSignal) => Promise<string | null> | string | null

let osReader: OsSecretReader = readOsSecret

const cache = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()

/** Подмена хранилища в тестах. null возвращает чтение через дочерний процесс. Кэш сбрасывается. */
export function useOsSecretReader(reader: OsSecretReader | null): void {
  osReader = reader ?? readOsSecret
  resetOsSecretCache()
}

/** Сброс ответа и незаконченного чтения. Дочерние процессы этим не создаются. */
export function resetOsSecretCache(): void {
  cache.clear()
  pending.clear()
}

async function readWithTimeout(name: string): Promise<string | null> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timed = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, OS_SECRET_TIMEOUT_MS)
  })
  let read: Promise<string | null>
  try {
    read = Promise.resolve(osReader(name, controller.signal)).then((raw) => {
      if (controller.signal.aborted) {
        return null
      }
      return filled(raw)
    }).catch(() => null)
  } catch {
    read = Promise.resolve(null)
  }
  try {
    return await Promise.race([read, timed])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

/**
 * Один ответ на имя за жизнь процесса.
 * Повтор хода не открывает хранилище: ни после успеха, ни после пустого ответа, ни после таймаута.
 */
export function readCachedOsSecret(name: string): Promise<string | null> {
  if (cache.has(name)) {
    return Promise.resolve(cache.get(name) ?? null)
  }
  const running = pending.get(name)
  if (running) {
    return running
  }
  const job = readWithTimeout(name).then((value) => {
    cache.set(name, value)
    return value
  })
  pending.set(name, job)
  void job.finally(() => {
    if (pending.get(name) === job) {
      pending.delete(name)
    }
  })
  return job
}
