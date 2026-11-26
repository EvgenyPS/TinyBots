/**
 * FILE: scripts/secret.mjs
 * НАЗНАЧЕНИЕ: положить или проверить ключ своего бота в хранилище ОС.
 * ВХОД: `set <ИМЯ>` читает значение со stdin без эха. `check <ИМЯ>` ничего не пишет, кроме статуса.
 * ВЫХОД: для check одна из фраз «есть в хранилище», «есть в .env», «нет».
 * Удаления нет: бот и эта команда не должны уметь безвозвратно стереть ключ.
 * Сервис `tinybots`, учётная запись — имя ключа. На Linux только Secret Service.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/** Тот же шаблон, что API_KEY_ENV_PATTERN в пакете схем: A–Z, цифры и _. */
export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]*_API_KEY$/

export const secretNameSchema = z.string().regex(SECRET_NAME_PATTERN, 'имя переменной *_API_KEY')

export const SERVICE = 'tinybots'

export const LINUX_OPTIONS = { linux: { store: 'secret-service' } }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function validateName(name) {
  return secretNameSchema.safeParse(name).success
}

/** Одна строка статуса. Значение сюда не подставляется. */
export function presenceLine(inStore, inEnv) {
  if (inStore) {
    return 'есть в хранилище'
  }
  if (inEnv) {
    return 'есть в .env'
  }
  return 'нет'
}

/**
 * Значение из текста .env. Печатать его нельзя.
 * Правила те же, что у loadDotEnv: уже заданная переменная окружения важнее файла.
 */
export function dotenvValue(text, name) {
  if (!validateName(name)) {
    return undefined
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }
    const eq = line.indexOf('=')
    if (eq <= 0) {
      continue
    }
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key !== name) {
      continue
    }
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    return value
  }
  return undefined
}

export function envHasValue(env, dotenvText, name) {
  const current = env[name]
  if (current !== undefined) {
    return typeof current === 'string' && current.trim().length > 0
  }
  const fromFile = dotenvValue(dotenvText, name)
  return typeof fromFile === 'string' && fromFile.trim().length > 0
}

/** Снять один хвостовой перевод строки, который добавляет echo и Enter. */
export function normalizeSecretInput(raw) {
  return raw.replace(/(?:\r\n|\n|\r)$/, '')
}

/**
 * Шаг скрытого ввода. Символ в буфер кладётся, наружу не отдаётся.
 * Enter и Ctrl-D заканчивают ввод, Ctrl-C прерывает, Backspace стирает.
 */
export function feedHidden(buffer, chunk) {
  let next = buffer
  for (const key of chunk) {
    if (key === '\u0003') {
      return { buffer: next, done: true, aborted: true }
    }
    if (key === '\r' || key === '\n' || key === '\u0004') {
      return { buffer: next, done: true, aborted: false }
    }
    if (key === '\u007f' || key === '\b') {
      next = next.slice(0, -1)
      continue
    }
    next += key
  }
  return { buffer: next, done: false, aborted: false }
}

export function inspectPresence(keyring, name, env, dotenvText) {
  let inStore = false
  if (keyring) {
    try {
      const entry = new keyring.Entry(SERVICE, name, LINUX_OPTIONS)
      const value = entry.getPassword()
      inStore = typeof value === 'string' && value.trim().length > 0
    } catch {
      inStore = false
    }
  }
  return presenceLine(inStore, envHasValue(env, dotenvText, name))
}

/** Записать значение. Текст исключения наружу не возвращаем. */
export function writeSecret(keyring, name, value) {
  try {
    const entry = new keyring.Entry(SERVICE, name, LINUX_OPTIONS)
    entry.setPassword(value)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export async function loadKeyring() {
  try {
    return await import('@napi-rs/keyring')
  } catch {
    return null
  }
}

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function readHidden() {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    if (!stdin.isTTY) {
      const chunks = []
      stdin.setEncoding('utf8')
      stdin.on('data', (chunk) => {
        chunks.push(chunk)
      })
      stdin.on('end', () => {
        resolve(normalizeSecretInput(chunks.join('')))
      })
      stdin.on('error', reject)
      return
    }
    process.stdout.write('Значение ключа (ввод скрыт): ')
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let buffer = ''
    const onData = (chunk) => {
      const step = feedHidden(buffer, chunk)
      buffer = step.buffer
      if (!step.done) {
        return
      }
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      process.stdout.write('\n')
      if (step.aborted) {
        process.exit(130)
      }
      resolve(buffer)
    }
    stdin.on('data', onData)
  })
}

async function main() {
  const command = process.argv[2]
  const name = process.argv[3]
  if (process.argv.length > 4) {
    fail('лишний аргумент: значение читается только со stdin')
    return
  }
  if (command !== 'set' && command !== 'check') {
    fail('нужна команда set или check и имя ключа')
    return
  }
  if (!validateName(name)) {
    fail('имя ключа не подходит')
    return
  }
  if (command === 'check') {
    const keyring = await loadKeyring()
    let dotenvText = ''
    const envFile = path.join(root, '.env')
    if (existsSync(envFile)) {
      dotenvText = readFileSync(envFile, 'utf8')
    }
    console.log(inspectPresence(keyring, name, process.env, dotenvText))
    return
  }
  const value = await readHidden()
  if (value.trim().length === 0) {
    fail('пустое значение')
    return
  }
  const keyring = await loadKeyring()
  if (!keyring) {
    fail('хранилище ОС недоступно')
    return
  }
  const saved = writeSecret(keyring, name, value)
  if (!saved.ok) {
    fail('хранилище ОС недоступно')
    return
  }
  console.log('записано в хранилище')
}

function invokedDirectly() {
  if (!process.argv[1]) {
    return false
  }
  const argvPath = path.resolve(process.argv[1])
  const selfPath = fileURLToPath(import.meta.url)
  if (process.platform === 'win32') {
    return argvPath.toLowerCase() === selfPath.toLowerCase()
  }
  return argvPath === selfPath
}

const invoked = invokedDirectly()
if (invoked) {
  main().catch(() => {
    fail('хранилище ОС недоступно')
  })
}
