/**
 * FILE: apps/server/src/briefs/link.test.ts
 * НАЗНАЧЕНИЕ: формат grok_id. Битый id не становится ссылкой.
 * Если проверку формата убрать или ослабить до «любая непустая строка», этот тест падает.
 */

import { expect, test } from 'vitest'
import { grokbotHref, manualChatHint } from './link.js'

test('годный id даёт ссылку на чат', () => {
  expect(grokbotHref('demo-bit')).toBe('grokbot://app/v1/agent?id=demo-bit')
  expect(grokbotHref(' Demo.Bit_1 ')).toBe('grokbot://app/v1/agent?id=Demo.Bit_1')
})

test('пустой и невалидный id не дают ссылку', () => {
  expect(grokbotHref(undefined)).toBeNull()
  expect(grokbotHref(null)).toBeNull()
  expect(grokbotHref('')).toBeNull()
  expect(grokbotHref('   ')).toBeNull()
  expect(grokbotHref('demo bit')).toBeNull()
  expect(grokbotHref('demo/bit')).toBeNull()
  expect(grokbotHref('demo?x=1')).toBeNull()
  expect(grokbotHref('.hidden')).toBeNull()
  expect(grokbotHref('бит')).toBeNull()
  expect(grokbotHref('a'.repeat(82))).toBeNull()
})

test('подсказка называет бота и при живой ссылке', () => {
  expect(manualChatHint('Бит')).toBe('Если чат не открылся, откройте Бит вручную.')
})
