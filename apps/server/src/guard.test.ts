import { describe, expect, test } from 'vitest'
import { hostnameFromHostHeader, originAllowed, requestAllowed } from './guard.js'

describe('Host и Origin', () => {
  test('снимает порт и принимает loopback', () => {
    expect(hostnameFromHostHeader('127.0.0.1:8787')).toBe('127.0.0.1')
    expect(hostnameFromHostHeader('LocalHost')).toBe('localhost')
    expect(requestAllowed('127.0.0.1:8787', undefined)).toBe(true)
    expect(requestAllowed('localhost:8787', 'http://127.0.0.1:8787')).toBe(true)
  })

  test('чужой хост и origin отклоняются', () => {
    expect(requestAllowed('evil.example', undefined)).toBe(false)
    expect(requestAllowed('10.1.2.3:8787', undefined)).toBe(false)
    expect(requestAllowed(undefined, undefined)).toBe(false)
    expect(originAllowed('http://evil.example')).toBe(false)
    expect(originAllowed('null')).toBe(false)
    expect(requestAllowed('127.0.0.1:8787', 'https://evil.example')).toBe(false)
  })
})
