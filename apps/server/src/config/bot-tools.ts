/**
 * FILE: apps/server/src/config/bot-tools.ts
 * НАЗНАЧЕНИЕ: записать доступ бота к папке проекта из пульта.
 * ВХОД: id бота и проекта, project_tools и два флага проекта.
 * ВЫХОД: обновлённый config.yaml. Схема та же, что у мастера: у Grok поля project_tools нет.
 * Запись атомарная. Ключ API в файл не попадает.
 */

import path from 'node:path'
import { applyModeSchema, configSchema, idSchema, isApiBot, projectToolsSchema, type LauncherConfig } from '@tinybots/schema'
import { stringify } from 'yaml'
import { z } from 'zod'
import { writeAtomic } from '../store/atomic.js'
import { loadConfigAt, locateConfig, parseConfigText, selectConfigRequest } from './load.js'
import type { LaunchOptions } from '../launcher/view.js'
import { dangerousRootReason } from '../tools/roots.js'
import { realpathSync } from 'node:fs'

const patchSchema = z.strictObject({
  bot_id: idSchema,
  project_id: idSchema,
  project_tools: projectToolsSchema.optional(),
  apply_mode: applyModeSchema.optional(),
  allow_bot_tools: z.boolean(),
  respect_gitignore: z.boolean(),
})

export type ToolsReply = { status: 200 | 403 | 422; body: Record<string, unknown> }

export async function saveBotTools(root: string, options: LaunchOptions | undefined, payload: unknown): Promise<ToolsReply> {
  const patch = patchSchema.safeParse(payload)
  if (!patch.success) {
    return { status: 422, body: { ok: false, error: 'invalid_config', reason: 'тело доступа не разобралось' } }
  }
  const request = selectConfigRequest(root, options?.configPath)
  const loaded = loadConfigAt(root, request)
  if (!loaded.ok) {
    return { status: 422, body: { ok: false, error: 'config', reason: loaded.reason } }
  }
  const located = locateConfig(root, request)
  if (!('absolute' in located)) {
    return { status: 422, body: { ok: false, error: 'config', reason: located.reason } }
  }
  const bot = loaded.config.bots.find((item) => item.id === patch.data.bot_id)
  const project = loaded.config.projects.find((item) => item.id === patch.data.project_id)
  if (!bot || !project) {
    return { status: 422, body: { ok: false, error: 'invalid_config', reason: 'бот или проект не найден' } }
  }
  if (!isApiBot(bot) && (patch.data.project_tools !== undefined || patch.data.apply_mode !== undefined)) {
    return { status: 422, body: { ok: false, error: 'invalid_config', reason: 'у бота Grok нет project_tools' } }
  }
  const next: LauncherConfig = {
    ...loaded.config,
    bots: loaded.config.bots.map((item) => {
      if (item.id !== bot.id || !isApiBot(item)) {
        return item
      }
      return {
        ...item,
        project_tools: patch.data.project_tools ?? item.project_tools,
        ...(patch.data.apply_mode ? { apply_mode: patch.data.apply_mode } : {}),
      }
    }),
    projects: loaded.config.projects.map((item) => {
      if (item.id !== project.id) {
        return item
      }
      return {
        ...item,
        allow_bot_tools: patch.data.allow_bot_tools,
        respect_gitignore: patch.data.respect_gitignore,
      }
    }),
  }
  const parsed = configSchema.safeParse(next)
  if (!parsed.success) {
    return { status: 422, body: { ok: false, error: 'invalid_config', reason: 'конфиг не прошёл схему' } }
  }
  if (patch.data.allow_bot_tools && patch.data.project_tools && patch.data.project_tools !== 'off') {
    const folder = project.source.files?.path
    if (folder) {
      try {
        const projectReal = realpathSync(path.isAbsolute(folder) ? folder : path.resolve(loaded.directory, folder))
        const dataReal = realpathSync(path.isAbsolute(parsed.data.data_dir) ? parsed.data.data_dir : path.resolve(loaded.directory, parsed.data.data_dir))
        const reason = dangerousRootReason(projectReal, realpathSync(root), dataReal)
        if (reason) {
          return { status: 422, body: { ok: false, error: 'invalid_config', reason } }
        }
      } catch {
        // папки ещё нет — мастер проверит путь отдельно
      }
    }
  }
  const yamlText = stringify(parsed.data, { lineWidth: 100 })
  const text = yamlText.endsWith('\n') ? yamlText : `${yamlText}\n`
  const roundtrip = parseConfigText(text, located.display)
  if (!roundtrip.ok) {
    return { status: 422, body: { ok: false, error: 'invalid_config', reason: roundtrip.reason } }
  }
  try {
    await writeAtomic(located.absolute, text)
  } catch {
    return { status: 422, body: { ok: false, error: 'invalid_config', reason: 'не удалось записать файл' } }
  }
  return { status: 200, body: { ok: true } }
}
