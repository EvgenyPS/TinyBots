/**
 * FILE: scripts/check-motion.test.ts
 * НАЗНАЧЕНИЕ: D7. Живой CSS пульта и заведомо плохой фрагмент.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { checkMotion } from './check-motion.mjs'

test('D7: App.css двигает только transform и opacity за 150–300 мс', () => {
  const css = readFileSync(path.join(process.cwd(), 'apps/web/src/App.css'), 'utf8')
  expect(checkMotion(css, 'App.css')).toEqual([])
  const bad = ':root { --dur: 200ms; } .a { transition: color var(--dur); }'
  expect(checkMotion(bad, 'bad.css').length).toBeGreaterThan(0)
  const slow = '.a { transition: transform 400ms; }'
  expect(checkMotion(slow, 'slow.css').length).toBeGreaterThan(0)
  const zero = '@media (prefers-reduced-motion: reduce) { * { transition-duration: 0s !important; } }'
  expect(checkMotion(zero, 'zero.css')).toEqual([])
})
