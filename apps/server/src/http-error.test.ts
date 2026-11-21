/**
 * FILE: apps/server/src/http-error.test.ts
 * НАЗНАЧЕНИЕ: необработанная ошибка не отдаёт стек и путь.
 */

import { expect, test } from 'vitest'
import { createApp } from './server.js'

test('onError отвечает internal без стека и пути', async () => {
  const app = createApp({ boundPort: { current: 8765 }, testThrow: 'leak /tmp/secret' })
  const res = await app.request('http://127.0.0.1:8765/api/boom', {
    headers: { host: '127.0.0.1:8765' },
  })
  const text = await res.text()
  expect(res.status).toBe(500)
  expect(text).toContain('internal')
  expect(text).not.toContain('/tmp/secret')
  expect(text.toLowerCase()).not.toContain('stack')
})
