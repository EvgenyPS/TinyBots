/**
 * FILE: apps/server/src/briefs/text.test.ts
 * НАЗНАЧЕНИЕ: B8. Длина брифа, обязательные поля и отсутствие истории чата.
 */

import type { Task } from '@tinybots/schema'
import { expect, test } from 'vitest'
import { BRIEF_LINE_LIMIT, buildBriefText } from './text.js'

function task(over: Partial<Task> = {}): Task {
  return {
    schema_version: 1,
    updated_at: '2026-11-19T09:15:00Z',
    id: 'task-01',
    project: 'demo-game',
    chat: 'build',
    assignee: 'dev1',
    goal: 'Превью в доке',
    inputs: [{ kind: 'path', value: 'src/app.txt' }, { kind: 'sha', value: 'abc1234' }, { kind: 'pr', value: 'example/demo-game#3' }],
    output: 'файл в демо-проекте',
    done_when: 'превью видно в доке',
    out_of_scope: 'оформление и посты',
    reply_limit: 'short',
    due: '2026-11-20',
    status: 'working',
    ...over,
  }
}

const CHAT_LOG = 'история чата: секретное сообщение 42'
const BYSTANDERS = ['Ава', 'Тэст', 'Рев']

test('бриф не длиннее 8 строк и содержит поля, без переписки и чужих имён', () => {
  const text = buildBriefText(task(), { chatLog: CHAT_LOG, bystanders: BYSTANDERS })
  const lines = text.split('\n')
  expect(lines.length).toBeLessThanOrEqual(BRIEF_LINE_LIMIT)
  expect(lines.every((line) => line.trim().length > 0)).toBe(true)
  expect(text).toContain('Что: Превью в доке')
  expect(text).toContain('Зачем: файл в демо-проекте')
  expect(text).toContain('Файлы: src/app.txt, sha abc1234, pr example/demo-game#3')
  expect(text).toContain('Критерий готовности: превью видно в доке')
  expect(text).toContain('Лимит ответа: короткий')
  expect(text).not.toContain(CHAT_LOG)
  expect(text).not.toContain('секретное сообщение')
  for (const name of BYSTANDERS) {
    expect(text.includes(name), name).toBe(false)
  }
})

test('переводы строк внутри полей не раздувают бриф', () => {
  const text = buildBriefText(task({
    goal: 'строка\nвторая\nтретья',
    output: 'зачем\r\nещё строка',
  }), { chatLog: 'сообщение из чата, которое нельзя вставлять' })
  expect(text.split('\n').length).toBeLessThanOrEqual(BRIEF_LINE_LIMIT)
  expect(text).toContain('Что: строка вторая третья')
  expect(text).toContain('Зачем: зачем ещё строка')
  expect(text).not.toContain('сообщение из чата')
})

test('полный лимит ответа подписан отдельно от короткого', () => {
  expect(buildBriefText(task({ reply_limit: 'long' }))).toContain('Лимит ответа: полный')
})
