/**
 * FILE: apps/server/src/llm/client.ts
 * НАЗНАЧЕНИЕ: один вызов OpenAI-совместимого chat/completions.
 * ВХОД: base_url, ключ, модель, system и user. fetch и резолвер подменяются в тесте.
 * ВЫХОД: текст и usage, либо короткая ошибка без ключа, промпта и тела ответа.
 * stream всегда false. 401 не повторяем. 429 — не больше трёх повторов, Retry-After не дольше 60 с.
 * Тело больше 1 МиБ — ошибка, процесс не падает. Редирект не следуем.
 */

import { logSafe, rememberSecret } from '../redact.js'
import { completionsUrl, ensureBaseUrl, type Resolver } from './ssrf.js'

export const LLM_TIMEOUT_MS = 60_000
export const LLM_BODY_LIMIT = 1024 * 1024
export const LLM_MAX_ATTEMPTS = 4
const RETRY_CAP_MS = 60_000

export type TokenUsage = { prompt: number; completion: number; total: number }

export type LlmSuccess = { ok: true; text: string; usage: TokenUsage | null }

export type LlmFailure = {
  ok: false
  error: 'ssrf' | 'unauthorized' | 'rate_limit' | 'timeout' | 'too_large' | 'redirect' | 'network' | 'bad_response'
  message: string
}

export type LlmResult = LlmSuccess | LlmFailure

const TEXT = {
  ssrf: 'Адрес модели не разрешён.',
  unauthorized: 'Ключ не принят.',
  rate_limit: 'Провайдер просит подождать.',
  timeout: 'Провайдер не ответил за 60 с.',
  too_large: 'Ответ больше 1 МиБ.',
  redirect: 'Редирект запрещён.',
  network: 'Провайдер не ответил.',
  bad_response: 'Ответ модели не разобран.',
} as const

function fail(error: LlmFailure['error']): LlmFailure {
  return { ok: false, error, message: TEXT[error] }
}

export function retryDelayMs(header: string | null, now = Date.now()): number {
  if (header === null) {
    return 1000
  }
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, RETRY_CAP_MS)
  }
  const when = Date.parse(trimmed)
  if (Number.isNaN(when)) {
    return 1000
  }
  return Math.min(Math.max(0, when - now), RETRY_CAP_MS)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function readUsage(body: unknown): TokenUsage | null {
  const usage = asRecord(asRecord(body)?.usage)
  if (!usage) {
    return null
  }
  const prompt = usage.prompt_tokens
  const completion = usage.completion_tokens
  if (typeof prompt !== 'number' || typeof completion !== 'number' || !Number.isFinite(prompt) || !Number.isFinite(completion)) {
    return null
  }
  if (prompt < 0 || completion < 0) {
    return null
  }
  const total = typeof usage.total_tokens === 'number' && usage.total_tokens >= 0
    ? usage.total_tokens
    : prompt + completion
  return { prompt, completion, total }
}

function readContent(body: unknown): string | null {
  const choices = asRecord(body)?.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return null
  }
  const message = asRecord(asRecord(choices[0])?.message)
  const content = message?.content
  return typeof content === 'string' ? content : null
}

async function readLimited(res: Response): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = res.headers.get('content-length')
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > LLM_BODY_LIMIT) {
    return { ok: false }
  }
  if (!res.body) {
    const text = await res.text()
    if (Buffer.byteLength(text) > LLM_BODY_LIMIT) {
      return { ok: false }
    }
    return { ok: true, text }
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const step = await reader.read()
    if (step.done) {
      break
    }
    total += step.value.byteLength
    if (total > LLM_BODY_LIMIT) {
      await reader.cancel().catch(() => undefined)
      return { ok: false }
    }
    chunks.push(step.value)
  }
  return { ok: true, text: Buffer.concat(chunks).toString('utf8') }
}

function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('name' in error)) {
    return false
  }
  const name = (error as { name?: unknown }).name
  return name === 'TimeoutError' || name === 'AbortError'
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function completeChat(input: {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  user: string
  fetchImpl?: typeof fetch
  lookup?: Resolver
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}): Promise<LlmResult> {
  rememberSecret(input.apiKey)
  const allowed = await ensureBaseUrl(input.baseUrl, input.lookup)
  if (!allowed.ok) {
    logSafe('llm: адрес отклонён')
    return fail('ssrf')
  }
  const endpoint = completionsUrl(input.baseUrl)
  const sameHost = await ensureBaseUrl(endpoint, input.lookup)
  if (!sameHost.ok) {
    logSafe('llm: адрес отклонён')
    return fail('ssrf')
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const sleep = input.sleep ?? defaultSleep
  const timeoutMs = input.timeoutMs ?? LLM_TIMEOUT_MS
  const body = JSON.stringify({
    model: input.model,
    stream: false,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ],
  })
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt += 1) {
    let response: Response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
      })
    } catch (error) {
      if (isTimeout(error)) {
        logSafe('llm: таймаут')
        return fail('timeout')
      }
      logSafe('llm: сеть')
      return fail('network')
    }
    if (response.status >= 300 && response.status < 400) {
      logSafe('llm: редирект')
      return fail('redirect')
    }
    if (response.status === 401) {
      logSafe('llm: 401')
      return fail('unauthorized')
    }
    if (response.status === 429) {
      logSafe('llm: 429')
      if (attempt === LLM_MAX_ATTEMPTS) {
        return fail('rate_limit')
      }
      await sleep(retryDelayMs(response.headers.get('retry-after')))
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      logSafe(`llm: статус ${response.status}`)
      return fail('network')
    }
    const limited = await readLimited(response)
    if (!limited.ok) {
      logSafe('llm: тело больше лимита')
      return fail('too_large')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(limited.text) as unknown
    } catch {
      logSafe('llm: ответ не json')
      return fail('bad_response')
    }
    const text = readContent(parsed)
    if (text === null) {
      logSafe('llm: нет текста ответа')
      return fail('bad_response')
    }
    return { ok: true, text, usage: readUsage(parsed) }
  }
  return fail('rate_limit')
}
