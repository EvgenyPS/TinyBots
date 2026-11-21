/**
 * FILE: packages/schema/src/tools-schema.test.ts
 * НАЗНАЧЕНИЕ: I1 на схеме. Поле project_tools только у своего бота, по умолчанию off.
 * ВХОД: объекты конфига. ВЫХОД: разбор zod. У бота Grok лишнее поле отвергается.
 */

import { describe, expect, test } from 'vitest'
import { apiBotSchema, configSchema, grokBotSchema, PROPOSAL_STATES, canProposalTransition } from './index.js'

const api = {
  id: 'nora',
  name: 'Нора',
  role: 'справка',
  instructions: 'Коротко.',
  provider: 'deepseek',
  model: 'deepseek-chat',
  api_key_env: 'DEEPSEEK_API_KEY',
}

test('I1 без project_tools получается off, grok поле отвергает', () => {
  const parsed = apiBotSchema.parse(api)
  expect(parsed.project_tools).toBe('off')
  expect(apiBotSchema.parse({ ...api, project_tools: 'propose' }).project_tools).toBe('propose')
  expect(grokBotSchema.safeParse({ id: 'bitk', name: 'Бит', role: 'код', project_tools: 'read' }).success).toBe(false)
})

test('I1 ключи проекта по умолчанию выключены и gitignore включён', () => {
  const config = configSchema.parse({
    schema_version: 1,
    owner: { name: 'Ника', confirms_merge: true },
    data_dir: 'data',
    delivery: 'clipboard',
    bots: [api, { id: 'bitk', name: 'Бит', role: 'код' }],
    projects: [{
      id: 'demo-keys',
      title: 'Demo',
      lead: 'nora',
      owner: 'owner',
      merge_executor: 'bitk',
      source: { files: { path: 'demo-project' } },
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
  })
  expect(config.projects[0]?.allow_bot_tools).toBe(false)
  expect(config.projects[0]?.respect_gitignore).toBe(true)
})

describe('I14 переходы предложения', () => {
  const allowed: Array<[string, string]> = [
    ['proposed', 'applying'],
    ['proposed', 'rejected'],
    ['proposed', 'conflict'],
    ['applying', 'applied'],
    ['applying', 'conflict'],
    ['applied', 'reverting'],
    ['applied', 'revert_conflict'],
    ['reverting', 'reverted'],
    ['reverting', 'revert_conflict'],
    ['reverting', 'applied'],
  ]
  test('разрешены только перечисленные пары', () => {
    for (const from of PROPOSAL_STATES) {
      for (const to of PROPOSAL_STATES) {
        const yes = allowed.some((pair) => pair[0] === from && pair[1] === to)
        expect(canProposalTransition(from, to), `${from}->${to}`).toBe(yes)
      }
    }
  })
})
