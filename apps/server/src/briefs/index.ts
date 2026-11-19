/**
 * FILE: apps/server/src/briefs/index.ts
 * НАЗНАЧЕНИЕ: сборка брифа, адресат, ссылка grokbot и лимит очереди.
 * ВХОД: задача и конфиг чата. История чата в текст не входит.
 * ВЫХОД: не больше 8 строк и ссылка на чат главного, либо отказ, если главный на паузе или не задан.
 */

export { composeBrief, type BriefBlocked, type BriefReady } from './compose.js'
export { grokbotHref, manualChatHint } from './link.js'
export { CHOOSE_LEAD, leadRefusal, resolveLead, type LeadBot, type ResolvedLead } from './lead.js'
export { briefStatus, loadBrief, type BriefQuery, type BriefRefusal, type BriefSuccess } from './load.js'
export { calendarDay, decideQueueLaunch, type QueueLaunch, type QueueSource } from './queue.js'
export { BRIEF_LINE_LIMIT, buildBriefText, type BriefIgnored } from './text.js'
