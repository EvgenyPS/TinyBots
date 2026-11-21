/**
 * FILE: apps/server/src/llm/prompt.ts
 * НАЗНАЧЕНИЕ: системный контекст своего бота.
 * ВХОД: роль, инструкции, текст rules.base и reply_limit.
 * ВЫХОД: один system-текст. Чужой чат и тела файлов сюда не передаются: у функции нет таких аргументов.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

export function rulesBaseText(root: string): string {
  return readFileSync(path.join(root, 'skill', 'team-token-economy.md'), 'utf8')
}

export function replyLimitLine(limit: 'short' | 'long'): string {
  if (limit === 'short') {
    return 'Лимит ответа: не больше 6 строк.'
  }
  return 'Лимит ответа: развёрнутый, без копий чужих чатов и файлов.'
}

export function systemPrompt(input: {
  role: string
  instructions: string
  rulesBase: string
  replyLimit: 'short' | 'long'
}): string {
  return [
    `Роль: ${input.role}`,
    `Инструкции: ${input.instructions}`,
    'Базовые правила включены всегда, выключателя нет.',
    input.rulesBase,
    replyLimitLine(input.replyLimit),
  ].join('\n')
}

/** Просьба о записке лежит в реплике пользователя, не в чужих файлах. */
export function briefUserText(brief: string): string {
  return [
    brief,
    'Ответь одной запиской JSON: schema_version, updated_at, task_id, state, links, verified, not_done, question_to_owner.',
    'Поле status не добавляй. Записка не переводит задачу и не запускает мерж.',
  ].join('\n')
}
