/**
 * FILE: apps/server/src/launcher/view.ts
 * НАЗНАЧЕНИЕ: собрать ответ пульта из конфига и файлов data_dir.
 * ВХОД: корень репозитория, путь конфига, мгновение «сейчас».
 * ВЫХОД: проекты, боты, чаты, задачи, записки и подпись синка.
 * Имена на экране берутся только отсюда. Демо-список bots.json этот модуль не читает.
 */

import type { LauncherConfig } from '@tinybots/schema'
import {
  loadConfigAt,
  resolveDataDir,
  selectConfigRequest,
  type ConfigFailure,
  type LoadedConfig,
} from '../config/load.js'
import { readLatestSync, readNotes, readTasks, type NoteRecord } from '../store/read.js'
import { formatHm } from '../time.js'

export type LauncherBot = {
  id: string
  name: string
  role: string
  paused: boolean
  lead: boolean
}

export type LauncherProject = {
  id: string
  title: string
  letter: string
  lead_id: string
  lead_name: string
  merge_executor: string
}

export type LauncherChat = {
  id: string
  project_id: string
  title: string
  lead_id: string
  lead_name: string
  members: Array<{ id: string; name: string }>
  rules: { do: string; dont: string }
  economy: { wake: string; reply_limit: string }
  context: string[]
}

export type LauncherTask = {
  id: string
  project_id: string
  chat_id: string
  chat_title: string
  assignee_id: string
  assignee_name: string
  goal: string
  status: string
  done_when: string
}

export type LauncherView = {
  ok: true
  file: string
  timezone: string
  stale_after_hours: number
  synced_at: string | null
  synced_label: string | null
  owner: { name: string; initials: string }
  delivery: 'clipboard' | 'queue'
  economy: {
    wake: string
    reply_limit: string
    max_wakes_per_task: number
    stale_after_hours: number
  }
  projects: LauncherProject[]
  bots: LauncherBot[]
  chats: LauncherChat[]
  tasks: LauncherTask[]
  notes: NoteRecord[]
}

function letterOf(title: string): string {
  const first = Array.from(title.trim())[0]
  if (!first) {
    return '?'
  }
  return first.toLocaleUpperCase('ru-RU')
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0)
  if (parts.length === 0) {
    return '?'
  }
  if (parts.length === 1) {
    return Array.from(parts[0]).slice(0, 2).join('').toLocaleUpperCase('ru-RU')
  }
  const a = Array.from(parts[0])[0] ?? ''
  const b = Array.from(parts[1])[0] ?? ''
  return `${a}${b}`.toLocaleUpperCase('ru-RU')
}

function nameMap(config: LauncherConfig): Map<string, string> {
  return new Map(config.bots.map((bot) => [bot.id, bot.name]))
}

function nameOf(names: Map<string, string>, id: string): string {
  return names.get(id) ?? id
}

function leadIds(config: LauncherConfig): Set<string> {
  const ids = new Set<string>()
  for (const project of config.projects) {
    ids.add(project.lead)
    for (const chat of project.chats) {
      ids.add(chat.lead)
    }
  }
  return ids
}

export function buildLauncher(root: string, loaded: LoadedConfig, now: Date): LauncherView | ConfigFailure {
  const { config } = loaded
  const dataDir = resolveDataDir(root, loaded.directory, config.data_dir)
  if (!dataDir.ok) {
    return { ok: false, file: loaded.file, line: 1, reason: dataDir.reason }
  }
  const zone = config.timezone?.trim() || 'UTC'
  const names = nameMap(config)
  const leads = leadIds(config)
  const chatTitles = new Map<string, string>()
  for (const project of config.projects) {
    for (const chat of project.chats) {
      chatTitles.set(`${project.id}/${chat.id}`, chat.title)
    }
  }
  const syncedAt = readLatestSync(dataDir.dir)
  const tasks = readTasks(dataDir.dir).map((task) => ({
    id: task.id,
    project_id: task.project,
    chat_id: task.chat,
    chat_title: chatTitles.get(`${task.project}/${task.chat}`) ?? task.chat,
    assignee_id: task.assignee,
    assignee_name: nameOf(names, task.assignee),
    goal: task.goal,
    status: task.status,
    done_when: task.done_when,
  }))
  return {
    ok: true,
    file: loaded.file,
    timezone: zone,
    stale_after_hours: config.economy.stale_after_hours,
    synced_at: syncedAt,
    synced_label: syncedAt ? formatHm(syncedAt, zone) : null,
    owner: { name: config.owner.name, initials: initialsOf(config.owner.name) },
    delivery: config.delivery,
    economy: {
      wake: config.economy.defaults.wake,
      reply_limit: config.economy.defaults.reply_limit,
      max_wakes_per_task: config.economy.defaults.max_wakes_per_task,
      stale_after_hours: config.economy.stale_after_hours,
    },
    projects: config.projects.map((project) => ({
      id: project.id,
      title: project.title,
      letter: letterOf(project.title),
      lead_id: project.lead,
      lead_name: nameOf(names, project.lead),
      merge_executor: project.merge_executor,
    })),
    bots: config.bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      role: bot.role,
      paused: bot.paused === true,
      lead: leads.has(bot.id),
    })),
    chats: config.projects.flatMap((project) =>
      project.chats.map((chat) => ({
        id: chat.id,
        project_id: project.id,
        title: chat.title,
        lead_id: chat.lead,
        lead_name: nameOf(names, chat.lead),
        members: chat.members.map((id) => ({ id, name: nameOf(names, id) })),
        rules: { do: chat.rules.do, dont: chat.rules.dont },
        economy: { wake: chat.economy.wake, reply_limit: chat.economy.reply_limit },
        context: [...chat.context],
      })),
    ),
    tasks,
    notes: readNotes(
      dataDir.dir,
      config.bots.map((bot) => bot.id),
      now,
      config.economy.stale_after_hours,
      zone,
    ),
  }
}

export type LaunchOptions = {
  configPath?: string
  now?: () => Date
}

export function loadLauncher(root: string, options?: LaunchOptions): LauncherView | ConfigFailure {
  const request = selectConfigRequest(root, options?.configPath)
  const loaded = loadConfigAt(root, request)
  if (!loaded.ok) {
    return loaded
  }
  return buildLauncher(root, loaded, options?.now?.() ?? new Date())
}
