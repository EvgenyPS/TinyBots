/**
 * FILE: e2e/d1-git.spec.ts
 * НАЗНАЧЕНИЕ: D1, G3 и G4. GitHub — локальный мок, токена нет в бандле, ответе и логах.
 */

import http from 'node:http'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { boot, origin } from './harness'

const TOKEN = 'tb-readonly-sentinel'
const SHA = 'abc1234abc1234abc1234abc1234abc1234abc12'

function githubMock(scopes: string): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const url = req.url ?? ''
    if (url.startsWith('/user')) {
      res.setHeader('X-OAuth-Scopes', scopes)
      res.end(JSON.stringify({ login: 'demo-reader' }))
      return
    }
    if (url.includes('/commits?')) {
      res.end(JSON.stringify([{
        sha: SHA,
        commit: { message: 'Превью пресетов', author: { name: 'Бит', date: '2026-11-19T09:15:00Z' } },
      }]))
      return
    }
    if (url.endsWith(`/commits/${SHA}`)) {
      res.end(JSON.stringify({
        sha: SHA,
        stats: { additions: 18, deletions: 6 },
        files: [{ filename: 'src/app.txt', additions: 18, deletions: 6 }],
      }))
      return
    }
    if (url.endsWith('/status')) {
      res.end(JSON.stringify({ statuses: [{ context: 'build', state: 'success' }] }))
      return
    }
    if (url.includes('/pulls?')) {
      res.end(JSON.stringify([{ number: 3, title: 'Превью', state: 'open', html_url: 'https://example.invalid/demo/pull/3' }]))
      return
    }
    res.statusCode = 404
    res.end('{}')
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address && typeof address === 'object' ? address.port : 0
      resolve({
        port,
        close: () => new Promise((done) => {
          server.close(() => done())
        }),
      })
    })
  })
}

function bundleHasToken(): boolean {
  const dir = path.join(process.cwd(), 'apps/web/dist')
  const files: string[] = []
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder, { withFileTypes: true })) {
      const child = path.join(folder, name.name)
      if (name.isDirectory()) {
        walk(child)
      } else if (name.isFile()) {
        files.push(child)
      }
    }
  }
  walk(dir)
  return files.some((file) => readFileSync(file).includes(Buffer.from(TOKEN)))
}

test('D1: коммиты, diffstat, PR и CI приходят без токена', async ({ page }) => {
  const mock = await githubMock('read:org')
  const server = await boot('demo/sets/primary/config.yaml', undefined, {
    GITHUB_TOKEN: TOKEN,
    GITHUB_API_BASE: `http://127.0.0.1:${mock.port}`,
  })
  try {
    expect(bundleHasToken()).toBe(false)
    const base = origin(server.port)
    const api = await page.request.get(`${base}/api/git?project=demo-game`)
    const raw = await api.text()
    expect(raw.includes(TOKEN)).toBe(false)
    const body = JSON.parse(raw) as { started: boolean; commits: Array<{ message: string }>; diffstat: { additions: number }; pulls: Array<{ number: number }>; ci: Array<{ name: string }> }
    expect(body.started).toBe(true)
    expect(body.commits[0]?.message).toBe('Превью пресетов')
    expect(body.diffstat.additions).toBe(18)
    expect(body.pulls[0]?.number).toBe(3)
    expect(body.ci[0]?.name).toBe('build')
    await page.goto(base)
    await page.getByTestId('tab-git').click()
    await expect(page.getByTestId('git-commits')).toContainText('Превью пресетов')
    await expect(page.getByTestId('git-diffstat')).toContainText('+18')
    await expect(page.getByTestId('git-pulls')).toContainText('PR #3')
    await expect(page.getByTestId('git-ci')).toContainText('build')
    await expect(page.locator('body')).not.toContainText(TOKEN)
    expect(server.logs().includes(TOKEN)).toBe(false)
  } finally {
    await server.stop()
    await mock.close()
  }
})

test('G3: токен с записью показывает предупреждение и не стартует Git', async ({ page }) => {
  const mock = await githubMock('repo')
  const server = await boot('demo/sets/primary/config.yaml', undefined, {
    GITHUB_TOKEN: TOKEN,
    GITHUB_API_BASE: `http://127.0.0.1:${mock.port}`,
  })
  try {
    await page.goto(origin(server.port))
    await page.getByTestId('tab-git').click()
    await expect(page.getByTestId('git-tab-warning')).toContainText('Токен GitHub с правами записи')
    await expect(page.getByTestId('git-commits')).toHaveCount(0)
    expect(server.logs().includes(TOKEN)).toBe(false)
  } finally {
    await server.stop()
    await mock.close()
  }
})
