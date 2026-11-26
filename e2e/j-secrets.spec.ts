/**
 * FILE: e2e/j-secrets.spec.ts
 * НАЗНАЧЕНИЕ: окно ключа и отказы http_request на живом пульте.
 * Значение после записи не видно и GET его не отдаёт.
 * Ссылка в URL или в теле без флага, редирект и частный IP — отказ, без второго запроса.
 */

import http from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { stringify } from 'yaml'
import { forgetSecrets } from '../apps/server/dist/redact.js'
import { resetOsSecretCache, useOsSecretReader, useOsSecretWriter } from '../apps/server/dist/llm/os-secret.js'
import { startServer } from '../apps/server/dist/server.js'
import { resetSecretRate, useSecretTransport } from '../apps/server/dist/secrets/request.js'

const VALUE = 'e2e-channel-canary-value'
const NAME = 'PARTNER'

test.use({ viewport: { width: 1440, height: 900 } })

test('значение не возвращается, ссылка в URL и теле, редирект и частный IP отвергаются', async ({ page }) => {
  const home = mkdtempSync(path.join(process.cwd(), 'data', 'e2e-secrets-'))
  const project = path.join(home, 'demo-project')
  mkdirSync(project, { recursive: true })
  const store = new Map<string, string>()
  const dials: string[] = []
  let lookupIp = '1.1.1.1'
  let dialStatus = 200
  useOsSecretReader((name: string) => store.get(name) ?? null)
  useOsSecretWriter(async (name: string, value: string, replace: boolean) => {
    const current = store.get(name)
    if (current && current.trim().length > 0 && !replace) {
      return 'exists'
    }
    store.set(name, value)
    return 'ok'
  })
  useSecretTransport({
    lookup: async () => [lookupIp],
    dial: async (input: { pinned: string }) => {
      dials.push(input.pinned)
      return { status: dialStatus, headers: 'location: https://example.com/next', body: VALUE }
    },
  })
  const bodies: string[] = []
  const mock = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const payload = Buffer.concat(chunks).toString('utf8')
      bodies.push(payload)
      const parsed = JSON.parse(payload) as { messages?: Array<{ role?: string; content?: string }> }
      const last = parsed.messages?.at(-1)
      const ask = last?.content ?? ''
      const tool = (args: unknown) => ({
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: 'call-1',
              type: 'function',
              function: { name: 'http_request', arguments: JSON.stringify(args) },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
      let response: unknown
      if (last?.role === 'tool' || last?.role === 'assistant') {
        response = { choices: [{ message: { content: 'готово' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
      } else if (ask.includes('АДРЕС')) {
        response = tool({ url: `https://example.com/{{secret:${NAME}}}`, method: 'GET' })
      } else if (ask.includes('ТЕЛО')) {
        response = tool({
          url: 'https://example.com/v1',
          method: 'POST',
          headers: { Authorization: `Bearer {{secret:${NAME}}}` },
          body: `x={{secret:${NAME}}}`,
        })
      } else if (ask.includes('РЕДИРЕКТ')) {
        response = tool({
          url: 'https://example.com/v1',
          method: 'GET',
          headers: { Authorization: `Bearer {{secret:${NAME}}}` },
        })
      } else {
        response = tool({
          url: 'https://example.com/latest',
          method: 'GET',
          headers: { Authorization: `Bearer {{secret:${NAME}}}` },
        })
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(response))
    })
  })
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', () => resolve()))
  const address = mock.address()
  const mockPort = address && typeof address === 'object' ? address.port : 0
  const config = {
    schema_version: 1,
    owner: { name: 'Ника', confirms_merge: true },
    data_dir: '.',
    delivery: 'clipboard',
    bots: [{
      id: 'nora',
      name: 'Нора',
      role: 'справка',
      instructions: 'Коротко.',
      provider: 'deepseek',
      model: 'deepseek-chat',
      base_url: `http://127.0.0.1:${mockPort}/v1`,
      api_key_env: 'DEEPSEEK_API_KEY',
    }],
    projects: [{
      id: 'demo-keys',
      title: 'Demo Keys',
      lead: 'nora',
      owner: 'owner',
      merge_executor: 'nora',
      source: { files: { path: 'demo-project' } },
      chats: [{
        id: 'build',
        title: 'Сборка',
        lead: 'nora',
        members: ['nora'],
        rules: { do: 'код', dont: 'чужое' },
        context: [],
        economy: { wake: 'mentioned_only', reply_limit: 'short' },
      }],
    }],
    economy: { defaults: { wake: 'mentioned_only', reply_limit: 'short', max_wakes_per_task: 3 }, stale_after_hours: 6 },
  }
  writeFileSync(path.join(home, 'config.yaml'), stringify(config))
  const configPath = path.relative(process.cwd(), path.join(home, 'config.yaml')).split(path.sep).join('/')
  process.env.DEEPSEEK_API_KEY = 'model-key-canary-value'
  const server = await startServer({ port: 0, configPath })
  const origin = `http://127.0.0.1:${server.port}`
  try {
    await page.goto(origin)
    await page.getByTestId('secrets-open').click()
    await page.getByTestId('secret-name').fill(NAME)
    await page.getByTestId('secret-description').fill('ключ партнёра')
    await page.getByTestId('secret-host').fill('example.com')
    await page.getByTestId('secret-add-host').click()
    await page.getByTestId('secret-bot-nora').check()
    await page.getByTestId('secret-value').fill(VALUE)
    await page.getByTestId('secret-save').click()
    await expect(page.getByTestId('secret-note')).toHaveText('задан')
    await expect(page.getByTestId('secret-value')).toHaveValue('')
    await expect(page.locator('body')).not.toContainText(VALUE)
    const listed = await page.evaluate(async () => {
      const res = await fetch('/api/secrets')
      return res.text()
    })
    expect(listed.includes(VALUE)).toBe(false)
    expect(listed).toContain('"set":true')
    expect(store.get(NAME)).toBe(VALUE)

    async function ask(text: string): Promise<string> {
      return page.evaluate(async (message) => {
        const launcher = await fetch('/api/launcher')
        const csrf = ((await launcher.json()) as { csrf?: string }).csrf ?? ''
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({ bot: 'nora', project: 'demo-keys', chat: 'build', text: message }),
        })
        return res.text()
      }, text)
    }

    dials.length = 0
    const urlReply = await ask('АДРЕС')
    expect(urlReply.includes(VALUE)).toBe(false)
    expect(dials).toEqual([])
    expect(bodies.some((item) => item.includes('секрет в url'))).toBe(true)

    const bodyReply = await ask('ТЕЛО')
    expect(bodyReply.includes(VALUE)).toBe(false)
    expect(bodies.some((item) => item.includes('секрет в теле'))).toBe(true)
    expect(dials).toEqual([])

    dialStatus = 302
    const redirectReply = await ask('РЕДИРЕКТ')
    expect(redirectReply.includes(VALUE)).toBe(false)
    expect(dials).toEqual(['1.1.1.1'])
    expect(bodies.some((item) => item.includes('редирект запрещён'))).toBe(true)

    dials.length = 0
    lookupIp = '169.254.169.254'
    dialStatus = 200
    const privateReply = await ask('ЧАСТНЫЙ')
    expect(privateReply.includes(VALUE)).toBe(false)
    expect(dials).toEqual([])
    expect(bodies.some((item) => item.includes('адрес не публичный'))).toBe(true)
    expect(bodies.some((item) => item.includes(VALUE))).toBe(false)
  } finally {
    await server.close()
    await new Promise<void>((resolve) => mock.close(() => resolve()))
    useOsSecretReader(null)
    useOsSecretWriter(null)
    useSecretTransport(null)
    resetOsSecretCache()
    resetSecretRate()
    forgetSecrets()
    delete process.env.DEEPSEEK_API_KEY
    rmSync(home, { recursive: true, force: true })
  }
})
