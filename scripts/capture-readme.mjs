/**
 * FILE: scripts/capture-readme.mjs
 * НАЗНАЧЕНИЕ: снять скриншоты README с демо. В CI не запускается.
 * GitHub — локальный мок. На картинках только вымышленные имена демо.
 */

import { spawn } from 'node:child_process'
import http from 'node:http'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const TOKEN = 'tb-readonly-sentinel'
const SHA = 'abc1234abc1234abc1234abc1234abc1234abc12'

const mock = http.createServer((req, res) => {
  const url = req.url ?? ''
  if (url.startsWith('/user')) {
    res.setHeader('X-OAuth-Scopes', 'read:org')
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

await new Promise((resolve) => {
  mock.listen(0, '127.0.0.1', () => resolve(undefined))
})
const address = mock.address()
const mockPort = address && typeof address === 'object' ? address.port : 0

const child = spawn(process.execPath, ['e2e/boot.mjs'], {
  env: {
    ...process.env,
    TINYBOTS_CONFIG: 'demo/sets/primary/config.yaml',
    TINYBOTS_NOW: '2026-11-19T10:00:00.000Z',
    GITHUB_TOKEN: TOKEN,
    GITHUB_API_BASE: `http://127.0.0.1:${mockPort}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const serverPort = await new Promise((resolve, reject) => {
  let out = ''
  const timer = setTimeout(() => reject(new Error('сервер не поднялся')), 15_000)
  child.stdout.on('data', (chunk) => {
    out += chunk.toString('utf8')
    const match = out.match(/READY (\d+)/)
    if (match) {
      clearTimeout(timer)
      resolve(Number(match[1]))
    }
  })
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
try {
  await page.goto(`http://127.0.0.1:${serverPort}`)
  const dir = path.resolve('docs/screenshots')
  mkdirSync(dir, { recursive: true })
  const shell = page.getByTestId('shell')
  await shell.waitFor()
  await shell.screenshot({ path: path.join(dir, 'dashboard.png') })
  await page.getByTestId('tab-files').click()
  await page.getByTestId('tree-docs/README.md').waitFor()
  await page.getByTestId('files-panel').screenshot({ path: path.join(dir, 'files.png') })
  await page.getByTestId('tab-docs').click()
  await page.getByTestId('doc-docs/README.md').click()
  await page.getByTestId('markdown').waitFor()
  await page.getByTestId('docs-panel').screenshot({ path: path.join(dir, 'docs.png') })
  await page.getByTestId('tab-git').click()
  await page.getByTestId('git-commits').waitFor()
  await page.getByTestId('git-panel').screenshot({ path: path.join(dir, 'git.png') })
} finally {
  await browser.close()
  child.kill('SIGTERM')
  mock.close()
}
console.log('скриншоты: docs/screenshots')
