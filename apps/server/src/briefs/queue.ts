/**
 * FILE: apps/server/src/briefs/queue.ts
 * НАЗНАЧЕНИЕ: решить, можно ли запустить доставку через очередь.
 * ВХОД: способ из конфига, время прошлого запуска, «сейчас», зона конфига, источник (расписание или кнопка).
 * ВЫХОД: разрешение или отказ. clipboard — очередь выключена. queue — не чаще одного календарного дня в зоне конфига.
 * Кнопка и расписание делят один слот: «или по кнопке» значит, что дневной запуск можно сделать рукой вместо cron,
 * а не второй раз в те же сутки. Запись файла очереди этим модулем не делается.
 */

export type QueueSource = 'schedule' | 'button'

export type QueueLaunch =
  | { ok: true }
  | { ok: false; reason: 'disabled' | 'already_today' }

export function calendarDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) {
    throw new Error('не разобрали календарный день')
  }
  return `${year}-${month}-${day}`
}

function sameDay(lastLaunchAt: string | null, now: Date, timeZone: string): boolean {
  if (!lastLaunchAt) {
    return false
  }
  const then = new Date(lastLaunchAt)
  if (Number.isNaN(then.getTime())) {
    return false
  }
  return calendarDay(then, timeZone) === calendarDay(now, timeZone)
}

export function decideQueueLaunch(input: {
  delivery: 'clipboard' | 'queue'
  lastLaunchAt: string | null
  now: Date
  timeZone: string
  source: QueueSource
}): QueueLaunch {
  // Источник не даёт второй запуск: и кнопка, и расписание проходят одну и ту же проверку.
  void input.source
  if (input.delivery !== 'queue') {
    return { ok: false, reason: 'disabled' }
  }
  if (sameDay(input.lastLaunchAt, input.now, input.timeZone)) {
    return { ok: false, reason: 'already_today' }
  }
  return { ok: true }
}
