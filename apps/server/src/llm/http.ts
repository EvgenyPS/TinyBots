/**
 * FILE: apps/server/src/llm/http.ts
 * НАЗНАЧЕНИЕ: тела POST /api/chat и POST /api/brief/send и чтение истории.
 * ВХОД: JSON и query. Ключ наружу не копируется.
 * ВЫХОД: статус и тело для server.ts. Очередь записи — там же, счётчик — в turn.ts.
 */

import { isApiBot } from '@tinybots/schema'
import { loadConfigAt, resolveDataDir, selectConfigRequest } from '../config/load.js'
import type { LaunchOptions } from '../launcher/view.js'
import { readChat, usageLabel } from './store.js'
import { deliverBrief, deliverChat, type TurnDeps, type TurnResult } from './turn.js'

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const TEXT_LIMIT = 4_000

export type HttpReply = {
  status: 200 | 404 | 409 | 422 | 502
  body: Record<string, unknown>
}

function fromTurn(result: TurnResult): HttpReply {
  if (!result.ok) {
    return { status: result.status, body: { ok: false, error: result.error, message: result.message } }
  }
  const body: Record<string, unknown> = {
    ok: true,
    reply: result.reply,
    usage_label: result.usage_label,
    note: result.note,
    messages: result.messages,
  }
  if (result.text !== undefined) {
    body.text = result.text
  }
  if (result.recipient !== undefined) {
    body.recipient = result.recipient
  }
  if (result.channel !== undefined) {
    body.channel = result.channel
  }
  return { status: 200, body }
}

function field(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function readBotChat(root: string, options: LaunchOptions | undefined, botId: string): HttpReply {
  if (!SLUG.test(botId)) {
    return { status: 404, body: { ok: false, error: 'not_found', message: 'Бот не найден.' } }
  }
  const loaded = loadConfigAt(root, selectConfigRequest(root, options?.configPath))
  if (!loaded.ok) {
    return { status: 422, body: { ok: false, error: 'config', message: loaded.reason } }
  }
  const dataDir = resolveDataDir(root, loaded.directory, loaded.config.data_dir)
  if (!dataDir.ok) {
    return { status: 422, body: { ok: false, error: 'config', message: dataDir.reason } }
  }
  const bot = loaded.config.bots.find((item) => item.id === botId)
  if (!bot) {
    return { status: 404, body: { ok: false, error: 'not_found', message: 'Бот не найден.' } }
  }
  if (!isApiBot(bot)) {
    return { status: 422, body: { ok: false, error: 'grok', message: 'У этого бота чат открывается ссылкой grokbot.' } }
  }
  const history = readChat(dataDir.dir, bot.id)
  return {
    status: 200,
    body: {
      ok: true,
      broken: history.broken,
      messages: history.messages,
      usage_label: usageLabel(dataDir.dir, bot.api_key_env),
    },
  }
}

export async function postBotChat(
  root: string,
  options: LaunchOptions | undefined,
  payload: unknown,
  deps?: TurnDeps,
): Promise<HttpReply> {
  const row = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  const botId = field(row?.bot)
  const text = typeof row?.text === 'string' ? row.text : ''
  if (!SLUG.test(botId)) {
    return { status: 404, body: { ok: false, error: 'not_found', message: 'Бот не найден.' } }
  }
  if (text.trim().length === 0 || text.length > TEXT_LIMIT) {
    return { status: 422, body: { ok: false, error: 'text', message: 'Нужен текст сообщения.' } }
  }
  const projectId = field(row?.project)
  const chatId = field(row?.chat)
  return fromTurn(await deliverChat({
    root,
    options,
    botId,
    text,
    projectId: SLUG.test(projectId) ? projectId : undefined,
    chatId: SLUG.test(chatId) ? chatId : undefined,
    deps,
  }))
}

export async function postBriefSend(
  root: string,
  options: LaunchOptions | undefined,
  payload: unknown,
  deps?: TurnDeps,
): Promise<HttpReply> {
  const row = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  const projectId = field(row?.project)
  const chatId = field(row?.chat)
  const taskId = field(row?.task)
  if (!SLUG.test(projectId) || !SLUG.test(chatId) || !SLUG.test(taskId)) {
    return { status: 404, body: { ok: false, error: 'not_found', message: 'Задача не найдена.' } }
  }
  return fromTurn(await deliverBrief({
    root,
    options,
    projectId,
    chatId,
    taskId,
    deps,
  }))
}
