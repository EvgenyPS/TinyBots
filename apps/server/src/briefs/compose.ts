/**
 * FILE: apps/server/src/briefs/compose.ts
 * НАЗНАЧЕНИЕ: собрать ответ брифа из конфига и задачи, без чтения диска.
 * ВХОД: боты, главные чата и проекта, карточка. Переписка принимается и отбрасывается.
 * ВЫХОД: текст и адресат, либо отказ без текста — чтобы экран не показал пустой бриф как готовый.
 */

import type { Task } from '@tinybots/schema'
import { grokbotHref, manualChatHint } from './link.js'
import { leadRefusal, resolveLead, type LeadBot } from './lead.js'
import { buildBriefText, type BriefIgnored } from './text.js'

export type BriefReady = {
  ok: true
  text: string
  lines: number
  recipient: string
  lead_id: string
  lead_name: string
  via: 'chat' | 'project'
  href: string | null
  fallback: string | null
}

export type BriefBlocked = {
  ok: false
  error: 'paused' | 'missing'
  message: string
  hint: string
}

export function composeBrief(input: {
  bots: readonly LeadBot[]
  chatLeadId: string | null
  projectLeadId: string | null
  task: Task
  ignored?: BriefIgnored
}): BriefReady | BriefBlocked {
  const lead = resolveLead({
    bots: input.bots,
    chatLeadId: input.chatLeadId,
    projectLeadId: input.projectLeadId,
  })
  if (!lead.ok) {
    const refusal = leadRefusal(lead)
    return { ok: false, error: lead.reason, message: refusal.message, hint: refusal.hint }
  }
  const text = buildBriefText(input.task, input.ignored)
  const href = grokbotHref(lead.bot.grok_id)
  return {
    ok: true,
    text,
    lines: text.split('\n').length,
    recipient: `Уйдёт: ${lead.bot.name}`,
    lead_id: lead.bot.id,
    lead_name: lead.bot.name,
    via: lead.via,
    href,
    // Подсказка рядом со ссылкой и без неё: протокол мог не открыться.
    fallback: manualChatHint(lead.bot.name),
  }
}
