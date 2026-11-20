/**
 * FILE: e2e/d6-motion.spec.ts
 * НАЗНАЧЕНИЕ: D6. При prefers-reduced-motion: reduce нет анимаций и transition дольше 0.
 */

import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'

test('reduced motion гасит анимации и переходы', async ({ page }) => {
  const server = await boot('demo/sets/primary/config.yaml')
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(origin(server.port))
    await expect(page.getByTestId('orbit')).toBeVisible()
    await page.getByTestId('tab-files').click()
    const offenders = await page.evaluate(() => {
      const found: string[] = []
      for (const el of document.querySelectorAll('*')) {
        const style = getComputedStyle(el)
        const anim = style.animationDuration.split(',').some((part) => {
          const ms = part.trim().endsWith('ms') ? parseFloat(part) : parseFloat(part) * 1000
          return ms > 0 && style.animationName !== 'none'
        })
        const transition = style.transitionDuration.split(',').some((part) => {
          const ms = part.trim().endsWith('ms') ? parseFloat(part) : parseFloat(part) * 1000
          return ms > 0 && style.transitionProperty !== 'none'
        })
        if (anim || transition) {
          const id = el.getAttribute('data-testid') ?? el.tagName
          found.push(`${id} ${style.animationName} ${style.transitionDuration}`)
        }
        if (found.length >= 6) {
          break
        }
      }
      return found
    })
    expect(offenders).toEqual([])
  } finally {
    await server.stop()
  }
})
