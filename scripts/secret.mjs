/**
 * FILE: scripts/secret.mjs
 * НАЗНАЧЕНИЕ: положить или проверить ключ своего бота в хранилище ОС.
 * ВХОД: `set <ИМЯ>` читает значение со stdin без эха. `check <ИМЯ>` ничего не пишет, кроме статуса.
 * ВЫХОД: для check статус без значения. Если ключ есть и в хранилище, и в .env,
 * пишем, что файл не используется. Замена существующей записи только с --replace.
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
  if (inStore && inEnv) {
    return 'есть в хранилище (в .env тоже — не используется)'
  }
  if (inStore) {
    return 'есть в хранилище'
  }
  if (inEnv) {
    return 'есть в .env'
  }
  return 'нет'
}

/**
 * Разбор argv после имени скрипта. Лишние позиционные аргументы не возвращаем:
 * там может оказаться само значение, его нельзя тащить в сообщение об ошибке.
 */
export function parseArgs(argv) {
  const command = argv[0]
  const rest = argv.slice(1)
  const replace = rest.includes('--replace')
  const positional = rest.filter((item) => item !== '--replace')
  return {
    command,
    name: positional[0],
    replace,
    extra: positional.length > 1,
  }
}

/** Текст отказа или null, если команду можно выполнять. Значение ключа в текст не входит. */
export function commandRefusal(parsed) {
  if (parsed.extra) {
    return 'лишний аргумент: значение читается только со stdin'
  }
  if (parsed.command !== 'set' && parsed.command !== 'check') {
    return 'нужна команда set или check и имя ключа'
  }
  if (parsed.command === 'check' && parsed.replace) {
    return 'у check нет --replace'
  }
  if (!validateName(parsed.name)) {
    return 'имя ключа не подходит'
  }
  return null
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
 * Стрелки и прочие CSI (`ESC [` … финальный байт) в значение не попадают.
 * pending — незакрытая Esc-последовательность с прошлого куска.
 */
export function feedHidden(buffer, chunk, pending = '') {
  const queue = [...pending, ...chunk]
  let next = buffer
  let index = 0
  while (index < queue.length) {
    const key = queue[index]
    if (key === '\u001b') {
      const rest = queue.slice(index)
      if (rest.length === 1) {
        return { buffer: next, done: false, aborted: false, pending: '\u001b' }
      }
      if (rest[1] !== '[') {
        index += 1
        continue
      }
      let end = 2
      while (end < rest.length) {
        const code = rest[end].charCodeAt(0)
        if (code >= 0x40 && code <= 0x7e) {
          index += end + 1
          end = -1
          break
        }
        end += 1
        if (end > 32) {
          index += end
          end = -1
          break
        }
      }
      if (end !== -1) {
        return { buffer: next, done: false, aborted: false, pending: rest.join('') }
      }
      continue
    }
    if (key === '\u0003') {
      return { buffer: next, done: true, aborted: true, pending: '' }
    }
    if (key === '\r' || key === '\n' || key === '\u0004') {
      return { buffer: next, done: true, aborted: false, pending: '' }
    }
    if (key === '\u007f' || key === '\b') {
      next = next.slice(0, -1)
    } else {
      next += key
    }
    index += 1
  }
  return { buffer: next, done: false, aborted: false, pending: '' }
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

/**
 * Записать значение. Уже лежащую запись не затираем без replace:
 * молчаливая замена стирала бы прежний ключ, а команды удаления нет.
 * Текст исключения и старое значение наружу не возвращаем.
 */
/** Есть ли непустое значение. Само значение наружу не отдаём. */
export function secretPresent(keyring, name) {
  try {
    const entry = new keyring.Entry(SERVICE, name, LINUX_OPTIONS)
    const value = entry.getPassword()
    return typeof value === 'string' && value.trim().length > 0
  } catch {
    return 'unavailable'
  }
}

/**
 * Н103: без --replace уже лежащая запись отвергается до чтения нового значения.
 * readValue вызывается только если запись можно менять.
 */
export async function performSet(keyring, name, replace, readValue) {
  if (!keyring) {
    return { ok: false, reason: 'unavailable' }
  }
  const present = secretPresent(keyring, name)
  if (present === 'unavailable') {
    return { ok: false, reason: 'unavailable' }
  }
  if (present && !replace) {
    return { ok: false, reason: 'exists' }
  }
  const value = await readValue()
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, reason: 'empty' }
  }
  return writeSecret(keyring, name, value, replace)
}

export function writeSecret(keyring, name, value, replace = false) {
  try {
    const entry = new keyring.Entry(SERVICE, name, LINUX_OPTIONS)
    let existing = null
    try {
      existing = entry.getPassword()
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
    if (typeof existing === 'string' && existing.trim().length > 0 && !replace) {
      return { ok: false, reason: 'exists' }
    }
    entry.setPassword(value)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'unavailable' }
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
    let pending = ''
    const onData = (chunk) => {
      const step = feedHidden(buffer, chunk, pending)
      buffer = step.buffer
      pending = step.pending
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
  const parsed = parseArgs(process.argv.slice(2))
  const refusal = commandRefusal(parsed)
  if (refusal) {
    fail(refusal)
    return
  }
  const { command, name } = parsed
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
  const keyring = await loadKeyring()
  const saved = await performSet(keyring, name, parsed.replace, readHidden)
  if (!saved.ok && saved.reason === 'empty') {
    fail('пустое значение')
    return
  }
  if (!saved.ok) {
    fail(saved.reason === 'exists'
      ? 'в хранилище уже есть запись, для замены добавьте --replace'
      : 'хранилище ОС недоступно')
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
