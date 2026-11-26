/**
 * FILE: scripts/secret.test.ts
 * НАЗНАЧЕНИЕ: команды secret:set и secret:check.
 * Статус без значения. Имя — тот же zod-шаблон, что у ключа бота.
 * Записи удаления в скрипте нет.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { API_KEY_ENV_PATTERN } from '@tinybots/schema'
import {
  SECRET_NAME_PATTERN,
  SERVICE,
  commandRefusal,
  dotenvValue,
  envHasValue,
  feedHidden,
  inspectPresence,
  normalizeSecretInput,
  parseArgs,
  performSet,
  presenceLine,
  secretNameSchema,
  validateName,
  writeSecret,
} from './secret.mjs'

const NAME = 'DEEPSEEK_API_KEY'
const VALUE = 'cli-canary-value'

test('шаблон имени совпадает со схемой и режет чужие переменные', () => {
  expect(SECRET_NAME_PATTERN.source).toBe(API_KEY_ENV_PATTERN.source)
  expect(secretNameSchema.safeParse(NAME).success).toBe(true)
  expect(validateName('QWEN_API_KEY')).toBe(true)
  expect(validateName('A1_API_KEY')).toBe(true)
  for (const bad of ['GITHUB_TOKEN', 'PATH', 'qwen_api_key', 'QWEN-API-KEY', '1_API_KEY']) {
    expect(validateName(bad), bad).toBe(false)
  }
})

test('check пишет только статус и не тащит значение', () => {
  expect(presenceLine(true, true)).toBe('есть в хранилище (в .env тоже — не используется)')
  expect(presenceLine(true, false)).toBe('есть в хранилище')
  expect(presenceLine(false, true)).toBe('есть в .env')
  expect(presenceLine(false, false)).toBe('нет')

  const line = inspectPresence({
    Entry: class {
      constructor(service: string, account: string, options?: { linux?: { store?: string } }) {
        expect(service).toBe(SERVICE)
        expect(account).toBe(NAME)
        expect(options).toEqual({ linux: { store: 'secret-service' } })
      }
      getPassword(): string {
        return VALUE
      }
    },
  }, NAME, { [NAME]: 'from-env-canary' }, '')
  expect(line).toBe('есть в хранилище (в .env тоже — не используется)')
  expect(line.includes(VALUE)).toBe(false)

  const fallen = inspectPresence({
    Entry: class {
      constructor() {
        throw new Error(`нет связки ${VALUE}`)
      }
    },
  }, NAME, {}, `${NAME}=${VALUE}\n`)
  expect(fallen).toBe('есть в .env')
  expect(fallen.includes(VALUE)).toBe(false)

  const missing = inspectPresence(null, NAME, { [NAME]: '   ' }, `${NAME}=${VALUE}\n`)
  expect(missing).toBe('нет')
})

test('пустая переменная окружения не подменяется файлом, как loadDotEnv', () => {
  expect(dotenvValue(`${NAME}="quoted-canary"\n`, NAME)).toBe('quoted-canary')
  expect(envHasValue({}, `${NAME}=quoted-canary\n`, NAME)).toBe(true)
  expect(envHasValue({ [NAME]: '' }, `${NAME}=quoted-canary\n`, NAME)).toBe(false)
  expect(envHasValue({ [NAME]: 'already' }, `${NAME}=other\n`, NAME)).toBe(true)
})

test('set кладёт значение и не возвращает его, без --replace существующее не затирает', () => {
  let saved = ''
  const ok = writeSecret({
    Entry: class {
      getPassword(): string | null {
        return null
      }
      setPassword(value: string): void {
        saved = value
      }
    },
  }, NAME, VALUE)
  expect(ok).toEqual({ ok: true })
  expect(saved).toBe(VALUE)
  expect(JSON.stringify(ok).includes(VALUE)).toBe(false)

  const old = 'old-canary-value'
  let replaced = false
  const kept = writeSecret({
    Entry: class {
      getPassword(): string {
        return old
      }
      setPassword(): void {
        replaced = true
      }
    },
  }, NAME, VALUE)
  expect(kept).toEqual({ ok: false, reason: 'exists' })
  expect(replaced).toBe(false)
  expect(JSON.stringify(kept).includes(old)).toBe(false)
  expect(JSON.stringify(kept).includes(VALUE)).toBe(false)

  const again = writeSecret({
    Entry: class {
      getPassword(): string {
        return old
      }
      setPassword(value: string): void {
        saved = value
      }
    },
  }, NAME, VALUE, true)
  expect(again).toEqual({ ok: true })
  expect(saved).toBe(VALUE)
  expect(JSON.stringify(again).includes(old)).toBe(false)

  const failed = writeSecret({
    Entry: class {
      getPassword(): string | null {
        return null
      }
      setPassword(): void {
        throw new Error(`отказ ${VALUE}`)
      }
    },
  }, NAME, VALUE)
  expect(failed).toEqual({ ok: false, reason: 'unavailable' })
  expect(JSON.stringify(failed).includes(VALUE)).toBe(false)
})

test('скрытый ввод не собирает ответ из нажатых символов наружу', () => {
  expect(normalizeSecretInput(`${VALUE}\n`)).toBe(VALUE)
  expect(normalizeSecretInput(`${VALUE}\r\n`)).toBe(VALUE)
  let buffer = ''
  const echoed: string[] = []
  for (const key of `${VALUE}\n`) {
    const step = feedHidden(buffer, key)
    buffer = step.buffer
    if (!step.done) {
      echoed.push('')
    }
    if (step.done) {
      expect(step.aborted).toBe(false)
    }
  }
  expect(buffer).toBe(VALUE)
  expect(echoed.join('').includes(VALUE)).toBe(false)

  const wiped = feedHidden('ab', '\u007f')
  expect(wiped.buffer).toBe('a')
  const abort = feedHidden(VALUE, '\u0003')
  expect(abort.aborted).toBe(true)
  expect(abort.buffer).toBe(VALUE)

  const arrows = feedHidden('', `\u001b[A${VALUE}\u001b[3~\n`)
  expect(arrows.done).toBe(true)
  expect(arrows.buffer).toBe(VALUE)
  const split = feedHidden('x', '\u001b')
  expect(split.buffer).toBe('x')
  expect(split.pending).toBe('\u001b')
  const after = feedHidden(split.buffer, '[Dy', split.pending)
  expect(after.buffer).toBe('xy')
  expect(after.pending).toBe('')
})

test('лишний аргумент и --replace не попадают в текст вместе со значением', () => {
  const parsed = parseArgs(['set', NAME, VALUE])
  expect(parsed.extra).toBe(true)
  expect(JSON.stringify(parsed).includes(VALUE)).toBe(false)
  const refusal = commandRefusal(parsed)
  expect(refusal).toBe('лишний аргумент: значение читается только со stdin')
  expect(refusal?.includes(VALUE)).toBe(false)
  expect(parseArgs(['set', NAME, '--replace'])).toMatchObject({ name: NAME, replace: true, extra: false })
  expect(commandRefusal(parseArgs(['check', NAME, '--replace']))).toBe('у check нет --replace')
  expect(commandRefusal(parseArgs(['set', NAME]))).toBeNull()
})

test('Н103: без --replace значение не спрашивается, если запись уже есть', async () => {
  let reads = 0
  const saved = await performSet({
    Entry: class {
      getPassword(): string {
        return 'old-canary-value'
      }
      setPassword(): void {
        throw new Error('write')
      }
    },
  }, NAME, false, async () => {
    reads += 1
    return VALUE
  })
  expect(saved).toEqual({ ok: false, reason: 'exists' })
  expect(reads).toBe(0)
  expect(JSON.stringify(saved).includes('old-canary-value')).toBe(false)

  let asked = 0
  const fresh = await performSet({
    Entry: class {
      getPassword(): null {
        return null
      }
      setPassword(value: string): void {
        expect(value).toBe(VALUE)
      }
    },
  }, NAME, false, async () => {
    asked += 1
    return VALUE
  })
  expect(fresh).toEqual({ ok: true })
  expect(asked).toBe(1)
})

test('Н106: значение короче 8 символов не пишется', async () => {
  let writes = 0
  const saved = await performSet({
    Entry: class {
      getPassword(): null {
        return null
      }
      setPassword(): void {
        writes += 1
      }
    },
  }, NAME, false, async () => 'short12')
  expect(saved).toEqual({ ok: false, reason: 'short' })
  expect(writes).toBe(0)
  const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'secret.mjs'), 'utf8')
  expect(source.includes('значение короче 8 символов')).toBe(true)
})

test('в команде нет удаления ключа', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'secret.mjs')
  const source = readFileSync(file, 'utf8')
  expect(source.includes('deletePassword')).toBe(false)
  expect(source.includes('deleteCredential')).toBe(false)
  expect(source.includes('secret:delete')).toBe(false)
})
