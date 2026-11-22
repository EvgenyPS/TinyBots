/**
 * FILE: apps/server/src/llm/turn.ts
 * НАЗНАЧЕНИЕ: один ход своего бота — чат в пульте или бриф по задаче.
 * ВХОД: конфиг, id бота или задача. Ключ читается из окружения по api_key_env.
 * ВЫХОД: текст ответа. Записка пишется только из брифа и только если она проходит statusSchema.
 * Задача из записки не становится done, мерж не стартует, lead и assignee не меняются.
 * Пробуждение — отправка брифа. Счётчик на диске, четвёртый ход при лимите 3 до модели не доходит.
 */

import { isApiBot, type ApiBot, type ChatMessage, type LauncherConfig } from '@tinybots/schema'
import { composeBrief } from '../briefs/compose.js'
import type { LeadBot } from '../briefs/lead.js'
import { loadConfigAt, resolveDataDir, selectConfigRequest, type ConfigFailure } from '../config/load.js'
import type { LaunchOptions } from '../launcher/view.js'
import { completeChat, type LlmResult } from './client.js'
import { openTools } from '../tools/access.js'
import { runToolLoop } from '../tools/loop.js'
import { redact } from '../redact.js'
import { briefUserText, rulesBaseText, systemPrompt } from './prompt.js'
import { readApiKey } from './secret.js'
import type { Resolver } from './ssrf.js'
import { ensureBaseUrl } from './ssrf.js'
import {
  addUsage,
  blockTask,
  parseNote,
  readChat,
  readTask,
  readWakeCount,
  usageLabel,
  withLlmLock,
  writeChat,
  writeNote,
  writeWakeCount,
} from './store.js'

export type TurnDeps = {
  fetchImpl?: typeof fetch
  lookup?: Resolver
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

export type TurnOk = {
  ok: true
  reply: string
  usage_label: string
  note: 'saved' | 'rejected' | 'none'
  messages: ChatMessage[]
  text?: string
  recipient?: string
  channel?: 'api'
}

export type TurnFail = {
  ok: false
  error: string
  message: string
  status: 404 | 409 | 422 | 502
}

export type TurnResult = TurnOk | TurnFail

function botsOf(config: LauncherConfig): LeadBot[] {
  return config.bots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    paused: bot.paused === true,
    grok_id: 'grok_id' in bot ? bot.grok_id ?? null : null,
    transport: isApiBot(bot) ? 'api' : 'grok',
  }))
}

function fail(error: string, message: string, status: TurnFail['status']): TurnFail {
  return { ok: false, error, message, status }
}

function upstream(result: Extract<LlmResult, { ok: false }>): TurnFail {
  return fail(result.error, result.message, 502)
}

type Ready = {
  config: LauncherConfig
  dataDir: string
  configDir: string
  now: Date
}

function openConfig(root: string, options: LaunchOptions | undefined, deps: TurnDeps): Ready | TurnFail | ConfigFailure {
  const loaded = loadConfigAt(root, selectConfigRequest(root, options?.configPath))
  if (!loaded.ok) {
    return loaded
  }
  const dataDir = resolveDataDir(root, loaded.directory, loaded.config.data_dir)
  if (!dataDir.ok) {
    return fail('config', dataDir.reason, 422)
  }
  return {
    config: loaded.config,
    dataDir: dataDir.dir,
    configDir: loaded.directory,
    now: deps.now?.() ?? options?.now?.() ?? new Date(),
  }
}

function asReady(opened: Ready | TurnFail | ConfigFailure): Ready | TurnFail {
  if ('status' in opened) {
    return opened
  }
  if (!('config' in opened)) {
    return fail('config', opened.reason, 422)
  }
  return opened
}

function replyOf(config: LauncherConfig, projectId: string | undefined, chatId: string | undefined): 'short' | 'long' {
  if (projectId && chatId) {
    const project = config.projects.find((item) => item.id === projectId)
    const chat = project?.chats.find((item) => item.id === chatId)
    if (chat) {
      return chat.economy.reply_limit
    }
  }
  return config.economy.defaults.reply_limit
}

type Spoken = LlmResult & { proposalId?: string | null }

async function speak(
  root: string,
  bot: ApiBot,
  user: string,
  replyLimit: 'short' | 'long',
  deps: TurnDeps,
  scope?: {
    config: LauncherConfig
    dataDir: string
    configDir: string
    now: Date
    projectId?: string
    chatId?: string
    taskId?: string
  },
): Promise<Spoken | TurnFail> {
  if (bot.paused === true) {
    return fail('paused', `Бот ${bot.name} на паузе.`, 409)
  }
  const key = readApiKey(bot.api_key_env, deps.env)
  if (!key.ok) {
    return fail('no_key', 'Ключа в окружении нет.', 422)
  }
  const allowed = await ensureBaseUrl(bot.base_url, deps.lookup)
  if (!allowed.ok) {
    return fail('ssrf', 'Адрес модели не разрешён.', 422)
  }
  let rules = ''
  try {
    rules = rulesBaseText(root)
  } catch {
    return fail('rules', 'Базовые правила не прочитались.', 422)
  }
  const system = systemPrompt({
    role: bot.role,
    instructions: bot.instructions,
    rulesBase: rules,
    replyLimit,
  })
  const gate = scope
    ? await openTools({
      root,
      config: scope.config,
      bot,
      projectId: scope.projectId,
      chatId: scope.chatId,
      taskId: scope.taskId,
      dataDir: scope.dataDir,
      configDir: scope.configDir,
      now: scope.now,
    })
    : null
  if (gate && gate.ok === false) {
    return fail('tools', gate.message, 422)
  }
  if (!gate) {
    return completeChat({
      baseUrl: bot.base_url,
      apiKey: key.value,
      model: bot.model,
      system,
      user,
      fetchImpl: deps.fetchImpl,
      lookup: deps.lookup,
      sleep: deps.sleep,
      timeoutMs: deps.timeoutMs,
    })
  }
  const loop = await runToolLoop({
    baseUrl: bot.base_url,
    apiKey: key.value,
    model: bot.model,
    system,
    user,
    ctx: gate.ctx,
    offerPropose: gate.offerPropose,
    fetchImpl: deps.fetchImpl,
    lookup: deps.lookup,
    sleep: deps.sleep,
    timeoutMs: deps.timeoutMs,
  })
  if (!loop.ok) {
    if (loop.error === 'deadline' || loop.error === 'limit') {
      return { ok: true, text: loop.message, usage: loop.usage, toolCalls: [], proposalId: null }
    }
    return { ok: false, error: loop.error === 'unauthorized' || loop.error === 'rate_limit' || loop.error === 'timeout' || loop.error === 'too_large' || loop.error === 'ssrf' || loop.error === 'redirect' || loop.error === 'network' || loop.error === 'bad_response' ? loop.error : 'network', message: loop.message, proposalId: null }
  }
  const text = loop.proposalId && !loop.text.includes(loop.proposalId)
    ? `${loop.text}\nпредложение ${loop.proposalId}`
    : loop.text
  return { ok: true, text, usage: loop.usage, toolCalls: [], proposalId: loop.proposalId }
}

export async function deliverChat(input: {
  root: string
  options?: LaunchOptions
  botId: string
  text: string
  projectId?: string
  chatId?: string
  deps?: TurnDeps
}): Promise<TurnResult> {
  const deps = input.deps ?? {}
  return withLlmLock(async () => {
    const ready = asReady(openConfig(input.root, input.options, deps))
    if (!('config' in ready)) {
      return ready
    }
    const bot = ready.config.bots.find((item) => item.id === input.botId)
    if (!bot) {
      return fail('not_found', 'Бот не найден.', 404)
    }
    if (!isApiBot(bot)) {
      return fail('grok', 'У этого бота чат открывается ссылкой grokbot.', 422)
    }
    const spoken = await speak(
      input.root,
      bot,
      input.text,
      replyOf(ready.config, input.projectId, input.chatId),
      deps,
      {
        config: ready.config,
        dataDir: ready.dataDir,
        configDir: ready.configDir,
        now: ready.now,
        projectId: input.projectId,
        chatId: input.chatId,
      },
    )
    if (!('ok' in spoken) || spoken.ok === false) {
      return 'status' in spoken ? spoken : upstream(spoken)
    }
    const reply = redact(spoken.text)
    const at = ready.now.toISOString()
    const previous = readChat(ready.dataDir, bot.id)
    const messages = [
      ...previous.messages,
      { role: 'user' as const, text: input.text, at },
      { role: 'assistant' as const, text: reply, at },
    ]
    await writeChat(ready.dataDir, bot.id, messages, ready.now)
    await addUsage(ready.dataDir, bot.api_key_env, spoken.usage, ready.now)
    return {
      ok: true,
      reply,
      usage_label: usageLabel(ready.dataDir, bot.api_key_env) ?? 'нет данных',
      note: 'none',
      messages: readChat(ready.dataDir, bot.id).messages,
    }
  })
}

export async function deliverBrief(input: {
  root: string
  options?: LaunchOptions
  projectId: string
  chatId: string
  taskId: string
  deps?: TurnDeps
}): Promise<TurnResult> {
  const deps = input.deps ?? {}
  return withLlmLock(async () => {
    const ready = asReady(openConfig(input.root, input.options, deps))
    if (!('config' in ready)) {
      return ready
    }
    const project = ready.config.projects.find((item) => item.id === input.projectId)
    const chat = project?.chats.find((item) => item.id === input.chatId)
    const task = readTask(ready.dataDir, input.taskId)
    if (!project || !chat || !task || task.project !== project.id || task.chat !== chat.id) {
      return fail('not_found', 'Задача не найдена.', 404)
    }
    const composed = composeBrief({
      bots: botsOf(ready.config),
      chatLeadId: chat.lead,
      projectLeadId: project.lead,
      task,
    })
    if (!composed.ok) {
      return fail(composed.error, composed.message, 409)
    }
    if (composed.channel !== 'api') {
      return fail('grok', 'Этот главный открывается ссылкой grokbot.', 422)
    }
    const bot = ready.config.bots.find((item) => item.id === composed.lead_id)
    if (!bot || !isApiBot(bot)) {
      return fail('grok', 'Этот главный открывается ссылкой grokbot.', 422)
    }
    if (bot.paused === true) {
      return fail('paused', `Бот ${bot.name} на паузе.`, 409)
    }
    const limit = ready.config.economy.defaults.max_wakes_per_task
    const count = readWakeCount(ready.dataDir, task.id)
    if (count === null) {
      return fail('wakes', 'Счётчик пробуждений не читается.', 422)
    }
    if (count >= limit) {
      await blockTask(ready.dataDir, task.id, ready.now)
      return fail('wake_limit', 'Лимит пробуждений. Задача в блоке.', 409)
    }
    const key = readApiKey(bot.api_key_env, deps.env)
    if (!key.ok) {
      return fail('no_key', 'Ключа в окружении нет.', 422)
    }
    const allowed = await ensureBaseUrl(bot.base_url, deps.lookup)
    if (!allowed.ok) {
      return fail('ssrf', 'Адрес модели не разрешён.', 422)
    }
    try {
      rulesBaseText(input.root)
    } catch {
      return fail('rules', 'Базовые правила не прочитались.', 422)
    }
    await writeWakeCount(ready.dataDir, task.id, count + 1, ready.now)
    const spoken = await speak(
      input.root,
      bot,
      briefUserText(composed.text),
      task.reply_limit,
      deps,
      {
        config: ready.config,
        dataDir: ready.dataDir,
        configDir: ready.configDir,
        now: ready.now,
        projectId: project.id,
        chatId: chat.id,
        taskId: task.id,
      },
    )
    if (!spoken.ok) {
      return 'status' in spoken ? spoken : upstream(spoken)
    }
    const reply = redact(spoken.text)
    const at = ready.now.toISOString()
    const previous = readChat(ready.dataDir, bot.id)
    await writeChat(ready.dataDir, bot.id, [
      ...previous.messages,
      { role: 'user', text: composed.text, at },
      { role: 'assistant', text: reply, at },
    ], ready.now)
    await addUsage(ready.dataDir, bot.api_key_env, spoken.usage, ready.now)
    const note = parseNote(reply)
    const saved = note ? await writeNote(ready.dataDir, bot.id, note) : false
    return {
      ok: true,
      reply,
      text: composed.text,
      recipient: composed.recipient,
      channel: 'api',
      usage_label: usageLabel(ready.dataDir, bot.api_key_env) ?? 'нет данных',
      note: saved ? 'saved' : 'rejected',
      messages: readChat(ready.dataDir, bot.id).messages,
    }
  })
}
