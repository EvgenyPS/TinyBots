/**
 * FILE: apps/server/src/briefs/lead.ts
 * НАЗНАЧЕНИЕ: выбрать, кому уйдёт бриф.
 * ВХОД: боты конфига и id главного в чате и в проекте. Id может не найтись среди ботов.
 * ВЫХОД: один бот либо отказ. Порядок: главный чата, и только если его нет в списке — главный проекта.
 * Пауза не проваливается молча к следующему: бота на паузе не будим и бриф не собираем.
 */

export type LeadBot = {
  id: string
  name: string
  paused: boolean
  grok_id?: string | null
  /** Нет поля — бот Grok, как в конфигах до своих ключей. */
  transport?: 'grok' | 'api'
}

export type ResolvedLead =
  | { ok: true; bot: LeadBot; via: 'chat' | 'project' }
  | { ok: false; reason: 'paused' | 'missing'; who: string | null; via: 'chat' | 'project' | null }

export const CHOOSE_LEAD = 'Выберите главного'

function blankToNull(id: string | null | undefined): string | null {
  const trimmed = id?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function findBot(bots: readonly LeadBot[], id: string | null): LeadBot | undefined {
  if (!id) {
    return undefined
  }
  return bots.find((bot) => bot.id === id)
}

export function resolveLead(input: {
  bots: readonly LeadBot[]
  chatLeadId: string | null
  projectLeadId: string | null
}): ResolvedLead {
  const chatId = blankToNull(input.chatLeadId)
  const projectId = blankToNull(input.projectLeadId)
  const chatBot = findBot(input.bots, chatId)
  if (chatBot) {
    if (chatBot.paused) {
      return { ok: false, reason: 'paused', who: chatBot.name, via: 'chat' }
    }
    return { ok: true, bot: chatBot, via: 'chat' }
  }
  const projectBot = findBot(input.bots, projectId)
  if (projectBot) {
    if (projectBot.paused) {
      return { ok: false, reason: 'paused', who: projectBot.name, via: 'project' }
    }
    return { ok: true, bot: projectBot, via: 'project' }
  }
  return { ok: false, reason: 'missing', who: null, via: chatId || projectId ? 'project' : null }
}

export function leadRefusal(result: Extract<ResolvedLead, { ok: false }>): { message: string; hint: string } {
  if (result.reason === 'paused' && result.who) {
    return {
      message: `Главный ${result.who} на паузе. Бриф не собран.`,
      hint: CHOOSE_LEAD,
    }
  }
  return {
    message: 'Главный не задан. Бриф не собран.',
    hint: CHOOSE_LEAD,
  }
}
