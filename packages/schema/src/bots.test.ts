/**
 * FILE: packages/schema/src/bots.test.ts
 * НАЗНАЧЕНИЕ: H1 и H4 для имени ключа. Свои поля не протекают в бота Grok.
 */

import { expect, test } from 'vitest'
import { apiBotSchema, configSchema, grokBotSchema } from './index.js'

const apiBot = {
  id: 'nora',
  name: 'Нора',
  role: 'справка',
  instructions: 'Отвечай по карточке.',
  provider: 'deepseek',
  model: 'deepseek-chat',
  base_url: 'https://api.deepseek.com',
  api_key_env: 'DEEPSEEK_API_KEY',
}

test('DEEPSEEK_API_KEY проходит, чужие имена переменных нет', () => {
  expect(apiBotSchema.safeParse(apiBot).success).toBe(true)
  expect(apiBotSchema.safeParse({ ...apiBot, api_key_env: 'QWEN_API_KEY' }).success).toBe(true)
  for (const name of ['GITHUB_TOKEN', 'PATH', 'GITHUB_API_BASE', 'PORT', 'API_KEY', 'deepseek_api_key']) {
    expect(apiBotSchema.safeParse({ ...apiBot, api_key_env: name }).success, name).toBe(false)
  }
})

test('у бота Grok нет полей модели, у своего бота нет grok_id и значения ключа', () => {
  expect(grokBotSchema.safeParse({ id: 'lead1', name: 'Ава', role: 'тимлид', grok_id: 'demo-ava' }).success).toBe(true)
  expect(grokBotSchema.safeParse({
    id: 'lead1',
    name: 'Ава',
    role: 'тимлид',
    model: 'grok',
  }).success).toBe(false)
  expect(apiBotSchema.safeParse({ ...apiBot, grok_id: 'demo-nora' }).success).toBe(false)
  expect(apiBotSchema.safeParse({ ...apiBot, api_key: 'demo-deepseek-key' }).success).toBe(false)
  expect(configSchema.safeParse({
    schema_version: 1,
    owner: { name: 'Ника', confirms_merge: true },
    data_dir: 'data',
    delivery: 'clipboard',
    bots: [apiBot],
    projects: [],
    economy: {
      defaults: { wake: 'mentioned_only', reply_limit: 'short', max_wakes_per_task: 3 },
      stale_after_hours: 6,
    },
    rules: { base: false },
  }).success).toBe(false)
})
