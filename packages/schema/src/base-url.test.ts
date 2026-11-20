/**
 * FILE: packages/schema/src/base-url.test.ts
 * НАЗНАЧЕНИЕ: H6, таблица адресов до DNS. Числовые формы не становятся исключением loopback.
 */

import { expect, test } from 'vitest'
import { addressKind, inspectBaseUrl } from './index.js'

const allowed = [
  'https://api.deepseek.com',
  'https://api.deepseek.com/v1',
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'https://1.1.1.1/v1',
  'http://127.0.0.1:9/v1',
  'http://localhost:9/v1',
  'http://LOCALHOST/v1',
]

const blocked = [
  'http://[::1]/v1',
  'https://[::1]/v1',
  'http://2130706433/',
  'http://0x7f.1/',
  'http://0x7f.0.0.1/',
  'http://017700000001/',
  'http://0177.0.0.1/',
  'http://127.1/',
  'http://0.0.0.0/',
  'https://0.0.0.0/',
  'http://169.254.169.254/',
  'https://169.254.169.254/latest',
  'https://10.0.0.1/',
  'https://192.168.0.1/',
  'https://172.16.0.1/',
  'https://[fc00::1]/',
  'https://[fe80::1]/',
  'https://[::ffff:10.0.0.1]/',
  'https://user:pass@example.com/v1',
  'http://example.com/v1',
  'https://127.0.0.1/v1',
  'file:///etc/passwd',
  'ftp://127.0.0.1/',
  'http://a:b@127.0.0.1/',
]

test('разрешены https и явный loopback http', () => {
  for (const url of allowed) {
    expect(inspectBaseUrl(url).ok, url).toBe(true)
  }
  const local = inspectBaseUrl('http://127.0.0.1:9/v1')
  expect(local.ok && local.loopback).toBe(true)
  const named = inspectBaseUrl('https://api.deepseek.com')
  expect(named.ok && named.loopback).toBe(false)
})

test('запрещённые формы адреса не проходят', () => {
  for (const url of blocked) {
    expect(inspectBaseUrl(url).ok, url).toBe(false)
  }
})

test('вид адреса: loopback, частный, публичный, v4 внутри v6', () => {
  expect(addressKind('127.0.0.1')).toBe('loopback')
  expect(addressKind('::1')).toBe('loopback')
  expect(addressKind('10.1.2.3')).toBe('blocked')
  expect(addressKind('169.254.169.254')).toBe('blocked')
  expect(addressKind('0.0.0.0')).toBe('blocked')
  expect(addressKind('8.8.8.8')).toBe('public')
  expect(addressKind('::ffff:a00:1')).toBe('blocked')
  expect(addressKind('fc00::1')).toBe('blocked')
  expect(addressKind('fe80::1')).toBe('blocked')
})
