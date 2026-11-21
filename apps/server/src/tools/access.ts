/**
 * FILE: apps/server/src/tools/access.ts
 * НАЗНАЧЕНИЕ: решить, есть ли у хода инструменты.
 * ВХОД: конфиг, бот, проект и чат. Оба ключа нужны: project_tools и allow_bot_tools.
 * ВЫХОД: контекст инструментов или null. null — ход как в PR A, поля tools в запросе нет.
 * Бот должен быть lead проекта или участником чата, и у проекта есть папка.
 */

import { realpath } from 'node:fs/promises'
import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { isApiBot, type ApiBot, type LauncherConfig } from '@tinybots/schema'
import { dangerousRootReason } from './roots.js'
import { ensureGit, GIT_MISSING } from './git.js'
import { loadGitignore, type SandboxContext } from './sandbox.js'
import type { ToolRunContext } from './call.js'

export type ToolGate =
  | { ok: true; ctx: ToolRunContext; offerPropose: boolean }
  | { ok: false; message: string }
  | null

async function realOrNull(file: string): Promise<string | null> {
  try {
    return await realpath(file)
  } catch {
    return null
  }
}

export async function openTools(input: {
  root: string
  config: LauncherConfig
  bot: ApiBot
  projectId?: string
  chatId?: string
  taskId?: string
  dataDir: string
  configDir: string
  now: Date
}): Promise<ToolGate> {
  if (input.bot.project_tools === 'off' || !input.projectId) {
    return null
  }
  const project = input.config.projects.find((item) => item.id === input.projectId)
  if (!project || project.allow_bot_tools !== true) {
    return null
  }
  const chats = input.chatId ? project.chats.filter((item) => item.id === input.chatId) : project.chats
  const member = project.lead === input.bot.id || chats.some((item) => item.members.includes(input.bot.id))
  if (!member || (input.chatId !== undefined && chats.length === 0 && project.lead !== input.bot.id)) {
    return null
  }
  const folder = project.source.files?.path
  if (!folder) {
    return null
  }
  let projectReal: string
  try {
    projectReal = await realpath(path.isAbsolute(folder) ? folder : path.resolve(input.configDir, folder))
  } catch {
    return { ok: false, message: 'Папка проекта не открылась.' }
  }
  const dataReal = await realOrNull(input.dataDir)
  const launcherReal = await realOrNull(input.root)
  if (!dataReal || !launcherReal) {
    return { ok: false, message: 'Каталог данных не открылся.' }
  }
  const danger = dangerousRootReason(projectReal, launcherReal, dataReal)
  if (danger) {
    return { ok: false, message: danger }
  }
  const sandbox: SandboxContext = {
    rootReal: projectReal,
    dataReal,
    launcherConfigReal: await realOrNull(path.join(input.root, 'config.yaml')),
    respectGitignore: project.respect_gitignore !== false,
    gitignore: await loadGitignore(projectReal, project.respect_gitignore !== false),
  }
  let gitNotice: string | null = null
  let offerPropose = input.bot.project_tools === 'propose'
  if (offerPropose) {
    let gitDir = false
    try {
      const st = await lstat(path.join(projectReal, '.git'))
      gitDir = st.isDirectory() && !st.isSymbolicLink()
    } catch {
      gitDir = false
    }
    if (gitDir) {
      const found = await ensureGit({ projectReals: [projectReal], dataReal })
      if (!found.ok) {
        offerPropose = false
        gitNotice = GIT_MISSING
      }
    }
  }
  return {
    ok: true,
    offerPropose,
    ctx: {
      sandbox,
      level: input.bot.project_tools,
      projectId: project.id,
      botId: input.bot.id,
      taskId: input.taskId,
      dataDir: input.dataDir,
      dataReal,
      launcherCwd: input.root,
      configReal: sandbox.launcherConfigReal,
      respectGitignore: project.respect_gitignore !== false,
      projectReal,
      now: input.now,
      gitNotice,
    },
  }
}

export function botIsApi(bot: unknown): bot is ApiBot {
  return Boolean(bot && typeof bot === 'object' && isApiBot(bot as ApiBot))
}
