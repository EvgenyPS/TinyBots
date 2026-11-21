/**
 * FILE: apps/server/src/config/bot-tools.test.ts
 * НАЗНАЧЕНИЕ: запись доступа из пульта. API-бот получает project_tools, Grok — нет.
 * Файл пишется целиком и снова проходит схему.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { stringify } from 'yaml'
import { afterEach, expect, test } from 'vitest'
import { repoRoot } from '../root.js'
import { loadConfigAt } from './load.js'
import { saveBotTools } from './bot-tools.js'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

function config(project: string, tools: 'off' | 'read' | 'propose') {
  return {
    schema_version: 1,
    owner: { name: 'Ника', confirms_merge: true },
    data_dir: '.',
    delivery: 'clipboard',
    bots: [
      {
        id: 'nora',
        name: 'Нора',
        role: 'справка',
        instructions: 'Коротко.',
        provider: 'deepseek',
        model: 'deepseek-chat',
        base_url: 'http://127.0.0.1:9/v1',
        api_key_env: 'DEEPSEEK_API_KEY',
        project_tools: tools,
      },
      { id: 'bitk', name: 'Бит', role: 'код' },
    ],
    projects: [{
      id: 'demo-keys',
      title: 'Demo',
      lead: 'nora',
      owner: 'owner',
      merge_executor: 'bitk',
      allow_bot_tools: false,
      respect_gitignore: true,
      source: { files: { path: project } },
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
}

test('API-бот: propose пишется, у Grok поле отвергается', async () => {
  await mkdir(path.join(repoRoot(), 'data'), { recursive: true })
  const dir = await mkdtemp(path.join(repoRoot(), 'data', 'vitest-tools-'))
  dirs.push(dir)
  const project = path.join(dir, 'proj')
  await mkdir(project)
  const file = path.join(dir, 'config.yaml')
  await writeFile(file, stringify(config(project, 'off')))
  const configPath = path.relative(repoRoot(), file).split(path.sep).join('/')
  const grok = await saveBotTools(repoRoot(), { configPath }, {
    bot_id: 'bitk',
    project_id: 'demo-keys',
    project_tools: 'propose',
    allow_bot_tools: true,
    respect_gitignore: true,
  })
  expect(grok.status).toBe(422)
  expect(await readFile(file, 'utf8')).toContain('project_tools: off')

  const saved = await saveBotTools(repoRoot(), { configPath }, {
    bot_id: 'nora',
    project_id: 'demo-keys',
    project_tools: 'propose',
    allow_bot_tools: true,
    respect_gitignore: false,
  })
  expect(saved).toEqual({ status: 200, body: { ok: true } })
  const text = await readFile(file, 'utf8')
  expect(text).not.toContain('sk-')
  const loaded = loadConfigAt(repoRoot(), configPath)
  expect(loaded.ok).toBe(true)
  if (!loaded.ok) {
    return
  }
  const nora = loaded.config.bots.find((bot) => bot.id === 'nora')
  const bitk = loaded.config.bots.find((bot) => bot.id === 'bitk')
  expect(nora && 'project_tools' in nora ? nora.project_tools : '').toBe('propose')
  expect(bitk && 'project_tools' in bitk).toBe(false)
  expect(loaded.config.projects[0]?.allow_bot_tools).toBe(true)
  expect(loaded.config.projects[0]?.respect_gitignore).toBe(false)
})
