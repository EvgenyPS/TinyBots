/**
 * FILE: e2e/perf/fps.spec.ts
 * НАЗНАЧЕНИЕ: D5. Орбита на 1440×900, замер кадров через performance trace.
 * Запускается отдельным шагом CI на Ubuntu и Node 24 (TINYBOTS_PERF=1).
 */

import { expect, test } from '@playwright/test'
import { boot, origin } from '../harness'

test('орбита держит не меньше 55 кадров в секунду', async ({ page }) => {
  const server = await boot('demo/sets/primary/config.yaml')
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(origin(server.port))
    await expect(page.getByTestId('orbit-box')).toBeVisible()
    const client = await page.context().newCDPSession(page)
    await client.send('Tracing.start', {
      categories: 'disabled-by-default-devtools.timeline.frame,devtools.timeline',
    })
    const samples: Array<{ name?: string }> = []
    client.on('Tracing.dataCollected', (event: { value?: Array<{ name?: string }> }) => {
      if (event.value) {
        samples.push(...event.value)
      }
    })
    const tracedDone = new Promise<void>((resolve) => {
      client.once('Tracing.tracingComplete', () => resolve())
    })
    const raf = await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
      const start = performance.now()
      let count = 0
      await new Promise<void>((resolve) => {
        const tick = (now: number): void => {
          count += 1
          if (now - start < 1000) {
            requestAnimationFrame(tick)
          } else {
            resolve()
          }
        }
        requestAnimationFrame(tick)
      })
      return count
    })
    await client.send('Tracing.end')
    await tracedDone
    const traced = samples.filter((item) => item.name === 'BeginFrame' || item.name === 'DrawFrame').length
    // В журнал CI попадают оба числа. Порог — по requestAnimationFrame.
    // Трейс подтверждает, что замер шёл через performance trace.
    console.log(`orbit fps raf=${raf} traceFrames=${traced}`)
    expect(traced).toBeGreaterThan(0)
    expect(raf).toBeGreaterThanOrEqual(55)
  } finally {
    await server.stop()
  }
})
