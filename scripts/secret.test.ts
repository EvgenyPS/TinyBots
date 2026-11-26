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
  dotenvValue,
  envHasValue,
  feedHidden,
  inspectPresence,
  normalizeSecretInput,
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
  expect(presenceLine(true, true)).toBe('есть в хранилище')
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
  expect(line).toBe('есть в хранилище')
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

test('set кладёт значение и не возвращает его, ошибка хранилища молчит', () => {
  let saved = ''
  const ok = writeSecret({
    Entry: class {
      setPassword(value: string): void {
        saved = value
      }
    },
  }, NAME, VALUE)
  expect(ok).toEqual({ ok: true })
  expect(saved).toBe(VALUE)
  expect(JSON.stringify(ok).includes(VALUE)).toBe(false)

  const failed = writeSecret({
    Entry: class {
      setPassword(): void {
        throw new Error(`отказ ${VALUE}`)
      }
    },
  }, NAME, VALUE)
  expect(failed).toEqual({ ok: false })
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
})

test('в команде нет удаления ключа', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'secret.mjs')
  const source = readFileSync(file, 'utf8')
  expect(source.includes('deletePassword')).toBe(false)
  expect(source.includes('deleteCredential')).toBe(false)
  expect(source.includes('secret:delete')).toBe(false)
})
