/**
 * FILE: apps/server/src/tools/loop.ts
 * НАЗНАЧЕНИЕ: ход «модель → инструменты → модель» внутри одного withLlmLock.
 * ВХОД: system и user, как в PR A, плюс список инструментов. Вывод инструмента — роль tool.
 * ВЫХОД: итоговый текст, суммарный usage и id предложения, если оно создано.
 * Лимиты хода: 16 вызовов, 6 запросов к модели, 256 КиБ вывода, 10 с на вызов, 180 с на ход.
 * Ретраи 429 внутри completeChat в шестёрку не входят и срок хода не продлевают.
 * Записку разбирает только вызывающий, и только из итогового текста.
 */

import { completeChat, type ChatTurnMessage, type TokenUsage, type ToolCall } from '../llm/client.js'
import { redact } from '../redact.js'
import { runTool, toolDefinitions, type ToolRunContext } from './call.js'
import {
  MODEL_REQUEST_LIMIT,
  TOOL_CALL_LIMIT,
  TOOL_OUTPUT_LIMIT,
  TOOL_TIMEOUT_MS,
  TURN_DEADLINE_MS,
} from './limits.js'
import { maskToolText, TOOL_DATA_MARK } from './mask.js'
import type { Resolver } from '../llm/ssrf.js'

export type LoopResult = {
  ok: true
  text: string
  usage: TokenUsage | null
  proposalId: string | null
} | {
  ok: false
  error: string
  message: string
  usage: TokenUsage | null
}

function addUsage(sum: TokenUsage | null, extra: TokenUsage | null): TokenUsage | null {
  if (!extra) {
    return sum
  }
  if (!sum) {
    return { ...extra }
  }
  return {
    prompt: sum.prompt + extra.prompt,
    completion: sum.completion + extra.completion,
    total: sum.total + extra.total,
  }
}

/**
 * Ровно 10 с ещё успех: таймер отказа ставится после таймера самой работы.
 * 10 с и 1 мс — уже отказ. Число TOOL_TIMEOUT_MS не меняется.
 */
export async function withTimeout<T>(
  job: (signal: AbortSignal) => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    throw new Error('tool_timeout')
  }
  const child = new AbortController()
  const onParent = (): void => {
    child.abort()
  }
  signal.addEventListener('abort', onParent, { once: true })
  // Сначала работа: её таймер на ровно 10 с срабатывает раньше таймера отказа.
  const work = job(child.signal)
  let settled = false
  try {
    return await new Promise<T>((resolve, reject) => {
      void sleep(TOOL_TIMEOUT_MS).then(() => {
        if (!settled) {
          settled = true
          child.abort()
          reject(new Error('tool_timeout'))
        }
      })
      work.then(
        (value) => {
          if (!settled) {
            settled = true
            resolve(value)
          }
        },
        (error: unknown) => {
          if (!settled) {
            settled = true
            reject(error)
          }
        },
      )
    })
  } finally {
    signal.removeEventListener('abort', onParent)
  }
}

export async function runToolLoop(input: {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  user: string
  ctx?: ToolRunContext
  offerPropose: boolean
  /** Узкий http_request. Без карточек ключа список инструментов прежний. */
  channel?: { definition: unknown; run: (args: string, signal: AbortSignal) => Promise<string> }
  fetchImpl?: typeof fetch
  lookup?: Resolver
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}): Promise<LoopResult> {
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => {
    setTimeout(resolve, ms)
  }))
  const deadline = new AbortController()
  const killer = setTimeout(() => deadline.abort(), TURN_DEADLINE_MS)
  const messages: ChatTurnMessage[] = [
    { role: 'system', content: input.system },
    { role: 'user', content: input.user },
  ]
  const tools = [
    ...(input.ctx ? toolDefinitions(input.ctx.level, input.offerPropose) : []),
    ...(input.channel ? [input.channel.definition] : []),
  ]
  let usage: TokenUsage | null = null
  let requests = 0
  let calls = 0
  let output = 0
  let proposalId: string | null = null
  try {
    while (requests < MODEL_REQUEST_LIMIT) {
      if (deadline.signal.aborted) {
        return { ok: false, error: 'deadline', message: 'Ход длиннее 180 с и остановлен.', usage }
      }
      requests += 1
      const spoken = await completeChat({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: input.model,
        system: input.system,
        user: input.user,
        messages,
        tools,
        fetchImpl: input.fetchImpl,
        lookup: input.lookup,
        sleep,
        timeoutMs: input.timeoutMs,
        signal: deadline.signal,
      })
      if (!spoken.ok) {
        if (deadline.signal.aborted) {
          return { ok: false, error: 'deadline', message: 'Ход длиннее 180 с и остановлен.', usage }
        }
        return { ok: false, error: spoken.error, message: spoken.message, usage }
      }
      usage = addUsage(usage, spoken.usage)
      if (spoken.toolCalls.length === 0) {
        return { ok: true, text: spoken.text, usage, proposalId }
      }
      messages.push({
        role: 'assistant',
        content: spoken.text,
        tool_calls: spoken.toolCalls,
      })
      for (const call of spoken.toolCalls) {
        if (calls >= TOOL_CALL_LIMIT || output >= TOOL_OUTPUT_LIMIT) {
          return finishLimit(input, messages, tools, usage, requests, calls >= TOOL_CALL_LIMIT ? 'больше 16 вызовов' : 'вывод больше 256 КиБ', deadline.signal, sleep)
        }
        calls += 1
        let raw: string
        try {
          const channel = input.channel
          if (channel && call.name === 'http_request') {
            raw = await withTimeout((signal) => channel.run(call.arguments, signal), sleep, deadline.signal)
          } else if (input.ctx) {
            raw = await withTimeout((signal) => runTool(input.ctx as ToolRunContext, call.name, call.arguments, undefined, signal), sleep, deadline.signal)
          } else {
            raw = JSON.stringify({ ok: false, error: 'неизвестный инструмент' })
          }
        } catch {
          raw = JSON.stringify({ ok: false, error: 'инструмент дольше 10 с' })
        }
        const shown = `${TOOL_DATA_MARK}\n${maskToolText(redact(raw))}`
        output += Buffer.byteLength(shown)
        if (output > TOOL_OUTPUT_LIMIT) {
          return finishLimit(input, messages, tools, usage, requests, 'вывод больше 256 КиБ', deadline.signal, sleep)
        }
        const made = raw.includes('"id":"') ? /"id":"([a-z0-9-]{1,64})"/.exec(raw) : null
        if (made?.[1] && raw.includes('"ok":true') && call.name === 'propose_patch') {
          proposalId = made[1]
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: shown })
      }
    }
    return { ok: false, error: 'limit', message: 'Ход остановлен: больше 6 запросов к модели.', usage }
  } finally {
    clearTimeout(killer)
  }
}

async function finishLimit(
  input: {
    baseUrl: string
    apiKey: string
    model: string
    system: string
    user: string
    fetchImpl?: typeof fetch
    lookup?: Resolver
    timeoutMs?: number
  },
  messages: ChatTurnMessage[],
  tools: unknown[],
  usage: TokenUsage | null,
  requests: number,
  reason: string,
  signal: AbortSignal,
  sleep: (ms: number) => Promise<void>,
): Promise<LoopResult> {
  if (requests >= MODEL_REQUEST_LIMIT) {
    return { ok: false, error: 'limit', message: `Ход остановлен: ${reason}.`, usage }
  }
  const note = `Дальше инструменты недоступны: ${reason}. Ответь коротко текстом.`
  messages.push({ role: 'user', content: note })
  const spoken = await completeChat({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    model: input.model,
    system: input.system,
    user: input.user,
    messages,
    tools,
    fetchImpl: input.fetchImpl,
    lookup: input.lookup,
    sleep,
    timeoutMs: input.timeoutMs,
    signal,
  })
  if (!spoken.ok) {
    return { ok: false, error: 'limit', message: `Ход остановлен: ${reason}.`, usage }
  }
  return {
    ok: true,
    text: spoken.text || `Ход остановлен: ${reason}.`,
    usage: addUsage(usage, spoken.usage),
    proposalId: null,
  }
}

export type { ToolCall }
