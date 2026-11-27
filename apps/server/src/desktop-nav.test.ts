/**
 * FILE: apps/server/src/desktop-nav.test.ts
 * НАЗНАЧЕНИЕ: токен из скрипта окна не создаётся на чужом origin.
 * Шаблон берётся из apps/desktop/nav: это тот же текст, который выполняет окно.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const navSource = readFileSync(
  fileURLToPath(new URL('../../../apps/desktop/nav/src/lib.rs', import.meta.url)),
  'utf8',
)
const windowSource = readFileSync(
  fileURLToPath(new URL('../../../apps/desktop/src-tauri/src/lib.rs', import.meta.url)),
  'utf8',
)

function sessionScript(token: string): string {
  const start = navSource.indexOf('fn session_script')
  const rawStart = navSource.indexOf('r#"', start)
  const rawEnd = navSource.indexOf('"#', rawStart + 3)
  const raw = navSource.slice(rawStart + 3, rawEnd)
  return raw
    .replaceAll('{APP_ORIGIN}', 'http://tauri.localhost')
    .replaceAll('{token}', token)
    .replaceAll('{{', '{')
    .replaceAll('}}', '}')
}

describe('токен окна', () => {
  test('на чужом origin свойство не создаётся, на своём — создаётся', () => {
    const token = 'ab'.repeat(32)
    const script = sessionScript(token)
    expect(script.startsWith('if(location.origin==="http://tauri.localhost"){')).toBe(true)
    expect(script.includes('Object.defineProperty')).toBe(true)
    const cases: Array<[string, boolean]> = [
      ['http://tauri.localhost', true],
      ['https://github.com', false],
      ['http://tauri.localhost.evil.com', false],
      ['https://tauri.localhost', false],
      ['http://tauri.localhost:8787', false],
      ['http://127.0.0.1:8787', false],
    ]
    for (const [origin, should] of cases) {
      const holder: { window: Record<string, unknown> } = { window: {} }
      const location = { origin }
      const run = new Function('window', 'location', script)
      run(holder.window, location)
      const has = Object.prototype.hasOwnProperty.call(holder.window, '__TINYBOTS_SESSION__')
      expect(has, origin).toBe(should)
      if (should) {
        expect(holder.window.__TINYBOTS_SESSION__).toBe(token)
      } else {
        expect(JSON.stringify(holder.window).includes(token)).toBe(false)
      }
    }
  })

  test('главное окно само не уходит по внешней ссылке', () => {
    expect(windowSource.includes('.on_navigation(|url| tinybots_nav::allow_navigation(url, open_external))')).toBe(
      true,
    )
    expect(windowSource.includes('tauri_plugin_opener::open_url')).toBe(true)
    expect(windowSource.includes('NewWindowResponse::Deny')).toBe(true)
    const capability = readFileSync(
      fileURLToPath(new URL('../../../apps/desktop/src-tauri/capabilities/default.json', import.meta.url)),
      'utf8',
    )
    expect(capability.includes('opener')).toBe(false)
    expect(capability.includes('http://**')).toBe(false)
  })

  test('без строки готовности токен на порт не уходит', () => {
    const spawn = readFileSync(
      fileURLToPath(new URL('../../../apps/desktop/src-tauri/src/spawn.rs', import.meta.url)),
      'utf8',
    )
    expect(windowSource.includes('read_status(Some')).toBe(false)
    expect(windowSource.includes('X-Tinybots-Session')).toBe(false)
    expect(windowSource.includes('готовность: stdout')).toBe(true)
    expect(windowSource.includes('готовность: health')).toBe(false)
    expect(spawn.includes('pub fn read_status()')).toBe(true)
    expect(spawn.includes('request_before_ready_line')).toBe(true)
    const token = 'ab'.repeat(32)
    expect(spawn.includes(token)).toBe(false)
  })
})
