import { describe, expect, test } from 'vitest'
import { hostnameFromHostHeader, originAllowed, portFromHostHeader, requestAllowed } from './guard.js'

const PORT = 8787

describe('Host и Origin', () => {
  test('снимает порт и принимает loopback только на порт сервера', () => {
    expect(hostnameFromHostHeader('127.0.0.1:8787')).toBe('127.0.0.1')
    expect(hostnameFromHostHeader('LocalHost')).toBe('localhost')
    expect(portFromHostHeader('127.0.0.1:8787')).toBe(8787)
    expect(portFromHostHeader('127.0.0.1')).toBeNull()
    expect(requestAllowed('127.0.0.1:8787', undefined, PORT)).toBe(true)
    expect(requestAllowed('localhost:8787', 'http://127.0.0.1:8787', PORT)).toBe(true)
    expect(requestAllowed('localhost:8787', 'http://localhost:8787', PORT)).toBe(true)
  })

  test('чужой порт — отказ, даже если имя loopback', () => {
    expect(requestAllowed('127.0.0.1:8788', undefined, PORT)).toBe(false)
    expect(requestAllowed('127.0.0.1:9', undefined, PORT)).toBe(false)
    expect(requestAllowed('127.0.0.1', undefined, PORT)).toBe(false)
    expect(requestAllowed('localhost:8787', 'http://127.0.0.1:9', PORT)).toBe(false)
    expect(requestAllowed('127.0.0.1:9', 'http://127.0.0.1:8787', PORT)).toBe(false)
    expect(originAllowed('http://127.0.0.1:9', PORT)).toBe(false)
    expect(originAllowed('http://127.0.0.1', PORT)).toBe(false)
    expect(originAllowed('https://localhost', PORT)).toBe(false)
  })

  test('чужой хост и origin отклоняются', () => {
    expect(requestAllowed('evil.example', undefined, PORT)).toBe(false)
    expect(requestAllowed('10.1.2.3:8787', undefined, PORT)).toBe(false)
    expect(requestAllowed(undefined, undefined, PORT)).toBe(false)
    expect(requestAllowed('127.0.0.1:8787', undefined, 0)).toBe(false)
    expect(originAllowed('http://evil.example', PORT)).toBe(false)
    expect(originAllowed('null', PORT)).toBe(false)
    expect(requestAllowed('127.0.0.1:8787', 'https://evil.example', PORT)).toBe(false)
  })
})
