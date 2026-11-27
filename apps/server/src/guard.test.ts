import { describe, expect, test } from 'vitest'
import { hostnameFromHostHeader, isDesktopHostHeader, originAllowed, portFromHostHeader, requestAllowed, TAURI_ORIGIN } from './guard.js'

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

  test('Origin окна Tauri ровно один, без звёздочки и без порта', () => {
    expect(TAURI_ORIGIN).toBe('http://tauri.localhost')
    expect(originAllowed(TAURI_ORIGIN, PORT)).toBe(true)
    expect(requestAllowed('127.0.0.1:8787', TAURI_ORIGIN, PORT)).toBe(true)
    expect(requestAllowed('localhost:8787', TAURI_ORIGIN, PORT)).toBe(true)
    expect(originAllowed('*', PORT)).toBe(false)
    expect(originAllowed('http://*', PORT)).toBe(false)
    expect(originAllowed('https://tauri.localhost', PORT)).toBe(false)
    expect(originAllowed('http://tauri.localhost:8787', PORT)).toBe(false)
    expect(originAllowed('http://tauri.localhost.evil', PORT)).toBe(false)
    expect(originAllowed('http://evil.tauri.localhost', PORT)).toBe(false)
    expect(originAllowed(`${TAURI_ORIGIN}/`, PORT)).toBe(false)
  })

  test('десктопный Host — только две строки', () => {
    expect(isDesktopHostHeader('127.0.0.1:8787')).toBe(true)
    expect(isDesktopHostHeader('localhost:8787')).toBe(true)
    expect(isDesktopHostHeader('LocalHost:8787')).toBe(true)
    expect(isDesktopHostHeader('127.0.0.1:8788')).toBe(false)
    expect(isDesktopHostHeader('127.0.0.1:08787')).toBe(false)
    expect(isDesktopHostHeader('127.0.0.1')).toBe(false)
    expect(isDesktopHostHeader('[::1]:8787')).toBe(false)
    expect(isDesktopHostHeader('0.0.0.0:8787')).toBe(false)
    expect(isDesktopHostHeader(undefined)).toBe(false)
  })
})
