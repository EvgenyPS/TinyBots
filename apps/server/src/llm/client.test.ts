/**
 * FILE: apps/server/src/llm/client.test.ts
 * НАЗНАЧЕНИЕ: H6 и H7. Мок fetch, без сети к провайдеру.
 * 401 один раз, 429 не больше четырёх попыток, Retry-After не дольше 60 с.
 * Таймаут, тело больше 1 МиБ, stream false, редирект не идёт на цель.
 * В stdout нет ключа, промпта и ответа.
 */

import http from 'node:http'
import { expect, test } from 'vitest'
import { LLM_TIMEOUT_MS, completeChat, retryDelayMs } from './client.js'

const KEY = 'demo-deepseek-key'
const PROMPT = 'КАНАР-ПРОМПТ'
const REPLY = 'КАНАР-ОТВЕТ'
const BASE = 'http://127.0.0.1:9/v1'

function localLookup(): Promise<string[]> {
  return Promise.resolve(['127.0.0.1'])
}

function capture(): { text: () => string; stop: () => void } {
  const chunks: string[] = []
  const out = process.stdout.write
  const err = process.stderr.write
  const sink = ((chunk: string | Uint8Array) => {
    chunks.push(Buffer.from(chunk).toString('utf8'))
    return true
  }) as typeof process.stdout.write
  process.stdout.write = sink
  process.stderr.write = sink
  return {
    text: () => chunks.join(''),
    stop: () => {
      process.stdout.write = out
      process.stderr.write = err
    },
  }
}

test('таймаут по умолчанию 60 с, Retry-After режется до 60 с', () => {
  expect(LLM_TIMEOUT_MS).toBe(60_000)
  expect(retryDelayMs('120')).toBe(60_000)
  expect(retryDelayMs('2')).toBe(2_000)
})

test('401 не повторяется, ключ не попадает в ошибку', async () => {
  let calls = 0
  const result = await completeChat({
    baseUrl: BASE,
    apiKey: KEY,
    model: 'deepseek-chat',
    system: PROMPT,
    user: PROMPT,
    lookup: localLookup,
    fetchImpl: (async () => {
      calls += 1
      return new Response(`секрет ${KEY}`, { status: 401 })
    }) as typeof fetch,
  })
  expect(calls).toBe(1)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.error).toBe('unauthorized')
    expect(result.message.includes(KEY)).toBe(false)
    expect(result.message.includes(PROMPT)).toBe(false)
  }
})

test('429 делает не больше трёх повторов и режет Retry-After', async () => {
  let calls = 0
  const slept: number[] = []
  const result = await completeChat({
    baseUrl: BASE,
    apiKey: KEY,
    model: 'deepseek-chat',
    system: 'роль',
    user: 'текст',
    lookup: localLookup,
    sleep: async (ms) => {
      slept.push(ms)
    },
    fetchImpl: (async () => {
      calls += 1
      return new Response('{}', { status: 429, headers: { 'Retry-After': '120' } })
    }) as typeof fetch,
  })
  expect(calls).toBe(4)
  expect(slept).toEqual([60_000, 60_000, 60_000])
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.message.includes(KEY)).toBe(false)
  }
})

test('таймаут, обрыв и тело больше 1 МиБ не роняют процесс', async () => {
  const hung = await completeChat({
    baseUrl: BASE,
    apiKey: KEY,
    model: 'deepseek-chat',
    system: 'роль',
    user: 'текст',
    lookup: localLookup,
    timeoutMs: 30,
    fetchImpl: ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'TimeoutError'
        reject(error)
      })
    })) as typeof fetch,
  })
  expect(hung.ok).toBe(false)
  if (!hung.ok) {
    expect(hung.error).toBe('timeout')
  }
  const broken = await completeChat({
    baseUrl: BASE,
    apiKey: KEY,
    model: 'deepseek-chat',
    system: 'роль',
    user: 'текст',
    lookup: localLookup,
    fetchImpl: (async () => {
      throw new Error(`обрыв ${KEY}`)
    }) as typeof fetch,
  })
  expect(broken.ok).toBe(false)
  if (!broken.ok) {
    expect(broken.error).toBe('network')
    expect(broken.message.includes(KEY)).toBe(false)
  }
  const huge = await completeChat({
    baseUrl: BASE,
    apiKey: KEY,
    model: 'deepseek-chat',
    system: 'роль',
    user: 'текст',
    lookup: localLookup,
    fetchImpl: (async () => new Response(Buffer.alloc(1024 * 1024 + 1, 1))) as typeof fetch,
  })
  expect(huge.ok).toBe(false)
  if (!huge.ok) {
    expect(huge.error).toBe('too_large')
    expect(huge.message.includes(KEY)).toBe(false)
  }
})

test('запрос без потока, журнал без промпта и ответа, частный DNS не вызывает fetch', async () => {
  let seenStream: unknown
  const logs = capture()
  try {
    const result = await completeChat({
      baseUrl: BASE,
      apiKey: KEY,
      model: 'deepseek-chat',
      system: PROMPT,
      user: PROMPT,
      lookup: localLookup,
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        seenStream = JSON.parse(String(init?.body)).stream
        return new Response(JSON.stringify({
          choices: [{ message: { content: REPLY } }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }), { status: 200 })
      }) as typeof fetch,
    })
    expect(seenStream).toBe(false)
    expect(result.ok).toBe(true)
    const text = logs.text()
    expect(text.includes(KEY)).toBe(false)
    expect(text.includes(PROMPT)).toBe(false)
    expect(text.includes(REPLY)).toBe(false)
  } finally {
    logs.stop()
  }
  let called = false
  const blocked = await completeChat({
    baseUrl: 'https://model.example/v1',
    apiKey: KEY,
    model: 'deepseek-chat',
    system: 'роль',
    user: 'текст',
    lookup: async () => ['10.1.2.3'],
    fetchImpl: (async () => {
      called = true
      return new Response('{}', { status: 200 })
    }) as typeof fetch,
  })
  expect(called).toBe(false)
  expect(blocked.ok).toBe(false)
})

test('фейковый резолвер в translated IPv4 и NAT64 local не вызывает fetch', async () => {
  for (const address of ['::ffff:0:a9fe:a9fe', '64:ff9b:1::1']) {
    let called = false
    const result = await completeChat({
      baseUrl: 'https://model.example/v1',
      apiKey: KEY,
      model: 'deepseek-chat',
      system: 'роль',
      user: 'текст',
      lookup: async () => [address],
      fetchImpl: (async () => {
        called = true
        return new Response('{}', { status: 200 })
      }) as typeof fetch,
    })
    expect(called, address).toBe(false)
    expect(result.ok, address).toBe(false)
  }
})

test('заголовки без тела и обрыв после заголовков не роняют процесс и не пишут стек', async () => {
  async function listen(mode: 'hang' | 'drop'): Promise<{ port: number; close: () => Promise<void> }> {
    const sockets = new Set<import('node:net').Socket>()
    const server = http.createServer((req, res) => {
      req.resume()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write('{')
      if (mode === 'drop') {
        res.destroy()
      }
    })
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('error', () => undefined)
      socket.on('close', () => {
        sockets.delete(socket)
      })
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    const port = address && typeof address === 'object' ? address.port : 0
    return {
      port,
      close: () => new Promise((resolve) => {
        for (const socket of sockets) {
          socket.destroy()
        }
        server.close(() => resolve())
      }),
    }
  }

  const hung = await listen('hang')
  const hungLogs = capture()
  try {
    const result = await completeChat({
      baseUrl: `http://127.0.0.1:${hung.port}/v1`,
      apiKey: KEY,
      model: 'deepseek-chat',
      system: PROMPT,
      user: PROMPT,
      lookup: localLookup,
      timeoutMs: 400,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('timeout')
      expect(result.message.includes(KEY)).toBe(false)
    }
    const text = hungLogs.text()
    expect(text.includes('undici')).toBe(false)
    expect(text.includes('\n    at ')).toBe(false)
    expect(text.includes(KEY)).toBe(false)
    expect(text.includes(PROMPT)).toBe(false)
  } finally {
    hungLogs.stop()
    await hung.close()
  }

  const dropped = await listen('drop')
  const dropLogs = capture()
  try {
    const result = await completeChat({
      baseUrl: `http://127.0.0.1:${dropped.port}/v1`,
      apiKey: KEY,
      model: 'deepseek-chat',
      system: PROMPT,
      user: PROMPT,
      lookup: localLookup,
      timeoutMs: 2_000,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('network')
      expect(result.message.includes(KEY)).toBe(false)
    }
    const text = dropLogs.text()
    expect(text.includes('undici')).toBe(false)
    expect(text.includes('\n    at ')).toBe(false)
    expect(text.includes(KEY)).toBe(false)
    expect(text.includes(PROMPT)).toBe(false)
  } finally {
    dropLogs.stop()
    await dropped.close()
  }
})

test('3xx — ошибка, цель редиректа не вызывалась', async () => {
  let secretHits = 0
  const server = http.createServer((req, res) => {
    if (req.url === '/secret') {
      secretHits += 1
      res.end('no')
      return
    }
    res.writeHead(302, { Location: '/secret' })
    res.end()
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = address && typeof address === 'object' ? address.port : 0
  try {
    const result = await completeChat({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: KEY,
      model: 'deepseek-chat',
      system: 'роль',
      user: 'текст',
      lookup: localLookup,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('redirect')
    }
    expect(secretHits).toBe(0)
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }
})
