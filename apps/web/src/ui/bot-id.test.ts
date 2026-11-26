/**
 * FILE: apps/web/src/ui/bot-id.test.ts
 * НАЗНАЧЕНИЕ: id бота в мастере с суффиксом -bot и старый конфиг без суффикса.
 * Схему не меняем: и nora, и revik-bot проходят тот же idSchema.
 */

import { configSchema, idSchema } from '@tinybots/schema'
import { expect, test } from 'vitest'
import { INSTRUCTION_TEMPLATES, chooseInstructionTemplate } from './instruction-templates.js'
import { autoBotId, emptyBot, emptyForm, finalizeBots, finishManualBotId, slugify, validate, type BotForm } from './setup-model.js'

function bot(patch: Partial<BotForm>): BotForm {
  return { ...emptyBot(), name: 'Ава', role: 'роль', ...patch }
}

test('шаблоны: подстановка, вопрос перед затиранием, «Своя» бережёт ручной текст', () => {
  expect(INSTRUCTION_TEMPLATES.map((item) => item.title)).toEqual([
    'Помощник',
    'Разработчик',
    'Ревьюер кода',
    'Тестировщик',
    'Автор текстов',
    'Аналитик',
    'Своя',
  ])
  const helper = INSTRUCTION_TEMPLATES[0]
  expect(helper).toBeTruthy()
  if (!helper) return
  const applied = chooseInstructionTemplate({ nextId: 'helper', currentText: '', touched: false })
  expect(applied).toEqual({ kind: 'apply', templateId: 'helper', text: helper.text })
  expect(helper.text.split('\n').length).toBeGreaterThanOrEqual(3)
  expect(helper.text.split('\n').length).toBeLessThanOrEqual(6)

  const ask = chooseInstructionTemplate({ nextId: 'developer', currentText: 'свой абзац', touched: true })
  expect(ask).toEqual({ kind: 'ask', templateId: 'developer' })

  const keep = chooseInstructionTemplate({ nextId: 'custom', currentText: 'свой абзац', touched: true })
  expect(keep).toEqual({ kind: 'keep', templateId: 'custom' })

  const clear = chooseInstructionTemplate({ nextId: 'custom', currentText: helper.text, touched: false })
  expect(clear).toEqual({ kind: 'apply', templateId: 'custom', text: '' })
})

test('Ревик становится revik-bot, пустое имя — bot1-bot и bot2-bot', () => {
  expect(autoBotId('Ревик', 0, new Set())).toBe('revik-bot')
  expect(autoBotId('', 0, new Set())).toBe('bot1-bot')
  expect(autoBotId('', 1, new Set())).toBe('bot2-bot')
  expect(autoBotId('Ревик', 1, new Set(['revik-bot']))).toBe('revik2-bot')
})

test('ручной nora получает суффикс один раз, длинная основа обрезается', () => {
  expect(finishManualBotId('nora')).toBe('nora-bot')
  expect(finishManualBotId('nora-bot')).toBe('nora-bot')
  expect(finishManualBotId('NORA')).toBe('nora-bot')
  const long = finishManualBotId('n'.repeat(80))
  expect(long.endsWith('-bot')).toBe(true)
  expect(long.length).toBeLessThanOrEqual(64)
  expect(idSchema.safeParse(long).success).toBe(true)
})

test('два одинаковых ручных id дают ошибку, автогенерация расходится номером', () => {
  const manual = finalizeBots([
    bot({ name: 'Нора', id: 'nora', idTouched: true }),
    bot({ name: 'Мира', id: 'nora', idTouched: true }),
  ])
  expect(manual.map((item) => item.id)).toEqual(['nora-bot', 'nora-bot'])
  expect(validate('bots', { ...emptyForm(), bots: manual })).toBe('Id ботов должны различаться')

  const auto = finalizeBots([
    bot({ name: 'Ревик', idTouched: false }),
    bot({ name: 'Ревик', idTouched: false }),
  ])
  expect(auto.map((item) => item.id)).toEqual(['revik-bot', 'revik2-bot'])
  expect(validate('bots', { ...emptyForm(), bots: auto })).toBeNull()
})

test('id проекта и чата без суффикса, старый конфиг с nora проходит схему', () => {
  expect(slugify('Ревик', 'project')).toBe('revik')
  expect(slugify('Сборка', 'chat')).toBe('sborka')
  expect(idSchema.safeParse('nora').success).toBe(true)
  expect(idSchema.safeParse('revik-bot').success).toBe(true)
  const parsed = configSchema.safeParse({
    schema_version: 1,
    owner: { name: 'Ника', confirms_merge: true },
    data_dir: 'data',
    delivery: 'clipboard',
    bots: [{ id: 'nora', name: 'Нора', role: 'справка' }],
    projects: [],
    economy: {
      defaults: { wake: 'mentioned_only', reply_limit: 'short', max_wakes_per_task: 3 },
      stale_after_hours: 6,
    },
  })
  expect(parsed.success).toBe(true)
})
