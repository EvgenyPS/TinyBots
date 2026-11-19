/**
 * FILE: apps/server/src/briefs/text.ts
 * НАЗНАЧЕНИЕ: текст брифа из карточки задачи.
 * ВХОД: задача контракта. История чата и имена других ботов сюда можно передать, но они не печатаются:
 * бриф будит одного главного и не пересказывает переписку.
 * ВЫХОД: не больше 8 строк. Поля: что, зачем, файлы, критерий готовности, лимит ответа.
 * Переводы строк внутри поля схлопываются, иначе лимит легко пробить одним абзацем.
 */

import type { Task } from '@tinybots/schema'

export const BRIEF_LINE_LIMIT = 8

export type BriefIgnored = {
  chatLog?: string
  bystanders?: readonly string[]
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function filesOf(task: Task): string {
  if (task.inputs.length === 0) {
    return 'нет'
  }
  return task.inputs
    .map((input) => {
      if (input.kind === 'path') {
        return input.value
      }
      if (input.kind === 'sha') {
        return `sha ${input.value}`
      }
      return `pr ${input.value}`
    })
    .join(', ')
}

function limitOf(limit: Task['reply_limit']): string {
  return limit === 'short' ? 'короткий' : 'полный'
}

export function buildBriefText(task: Task, ignored?: BriefIgnored): string {
  // Параметр есть, чтобы тест мог подсунуть переписку и убедиться, что она не попала в текст.
  void ignored
  const lines = [
    `Что: ${oneLine(task.goal)}`,
    `Зачем: ${oneLine(task.output)}`,
    `Файлы: ${oneLine(filesOf(task))}`,
    `Критерий готовности: ${oneLine(task.done_when)}`,
    `Лимит ответа: ${limitOf(task.reply_limit)}`,
    `Вне объёма: ${oneLine(task.out_of_scope)}`,
    `Срок: ${oneLine(task.due)}`,
  ]
  if (lines.length > BRIEF_LINE_LIMIT) {
    throw new Error('бриф длиннее 8 строк')
  }
  return lines.join('\n')
}
