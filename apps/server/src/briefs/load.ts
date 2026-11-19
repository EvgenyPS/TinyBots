/**
 * FILE: apps/server/src/briefs/load.ts
 * НАЗНАЧЕНИЕ: найти задачу в data_dir и собрать бриф для GET /api/brief.
 * ВХОД: корень репозитория, путь конфига, id проекта, чата и задачи.
 * ВЫХОД: готовый бриф или отказ. В отказе нет поля text: молчаливый пустой бриф не отдаём.
 * Задача должна принадлежать этому проекту и чату. Чужой id не читается как путь.
 */

import { loadConfigAt, resolveDataDir, selectConfigRequest, type ConfigFailure } from '../config/load.js'
import type { LaunchOptions } from '../launcher/view.js'
import { readTasks } from '../store/read.js'
import { composeBrief, type BriefBlocked, type BriefReady } from './compose.js'
import type { LeadBot } from './lead.js'

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

export type BriefQuery = {
  project: string
  chat: string
  task: string
}

export type BriefSuccess = BriefReady & { delivery: 'clipboard' | 'queue' }

export type BriefRefusal = BriefBlocked | {
  ok: false
  error: 'not_found' | 'config'
  message: string
  hint: string
  file?: string
  line?: number
  reason?: string
}

function notFound(message: string): BriefRefusal {
  return { ok: false, error: 'not_found', message, hint: 'Выберите задачу' }
}

function botsOf(configBots: ReadonlyArray<{ id: string; name: string; paused?: boolean; grok_id?: string }>): LeadBot[] {
  return configBots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    paused: bot.paused === true,
    grok_id: bot.grok_id ?? null,
  }))
}

export function loadBrief(root: string, options: LaunchOptions | undefined, query: BriefQuery): BriefSuccess | BriefRefusal {
  if (!SLUG.test(query.project) || !SLUG.test(query.chat) || !SLUG.test(query.task)) {
    return notFound('Задача не найдена')
  }
  const request = selectConfigRequest(root, options?.configPath)
  const loaded = loadConfigAt(root, request)
  if (!loaded.ok) {
    return configRefusal(loaded)
  }
  const project = loaded.config.projects.find((item) => item.id === query.project)
  if (!project) {
    return notFound('Проект не найден')
  }
  const chat = project.chats.find((item) => item.id === query.chat)
  if (!chat) {
    return notFound('Чат не найден')
  }
  const dataDir = resolveDataDir(root, loaded.directory, loaded.config.data_dir)
  if (!dataDir.ok) {
    return { ok: false, error: 'config', message: dataDir.reason, hint: 'Проверьте конфиг', reason: dataDir.reason }
  }
  const task = readTasks(dataDir.dir).find((item) => item.id === query.task && item.project === project.id && item.chat === chat.id)
  if (!task) {
    return notFound('Задача не найдена')
  }
  const composed = composeBrief({
    bots: botsOf(loaded.config.bots),
    chatLeadId: chat.lead,
    projectLeadId: project.lead,
    task,
  })
  if (!composed.ok) {
    return composed
  }
  return { ...composed, delivery: loaded.config.delivery }
}

function configRefusal(failure: ConfigFailure): BriefRefusal {
  return {
    ok: false,
    error: 'config',
    message: failure.reason,
    hint: 'Проверьте конфиг',
    file: failure.file,
    line: failure.line,
    reason: failure.reason,
  }
}

export function briefStatus(body: BriefSuccess | BriefRefusal): 200 | 404 | 409 | 422 {
  if (body.ok) {
    return 200
  }
  if (body.error === 'not_found') {
    return 404
  }
  if (body.error === 'config') {
    return 422
  }
  return 409
}
