/**
 * FILE: apps/server/src/time.ts
 * НАЗНАЧЕНИЕ: часы пульта. Зона берётся из конфига, «устарело» — из stale_after_hours.
 * ВХОД: ISO-время с зоной и мгновение «сейчас» (в тестах его подменяют).
 * ВЫХОД: подпись ЧЧ:ММ и признак, что записка старше порога.
 * Порог строгий: ровно N часов — ещё свежая, старше — серая.
 */

export function isStale(updatedAt: string, now: Date, staleAfterHours: number): boolean {
  const then = Date.parse(updatedAt)
  if (!Number.isFinite(then)) {
    return true
  }
  return now.getTime() - then > staleAfterHours * 3_600_000
}

function zoneOrUtc(timeZone: string): string {
  const trimmed = timeZone.trim()
  return trimmed.length > 0 ? trimmed : 'UTC'
}

/**
 * ЧЧ:ММ в заданной зоне. Неизвестная зона не роняет сервер: пробуем UTC.
 * en-GB даёт стабильные цифры, без «ч» и узких пробелов локали ru.
 */
export function formatHm(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return formatInZone(date, zoneOrUtc(timeZone))
}

function formatInZone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    let hour = parts.find((part) => part.type === 'hour')?.value ?? '00'
    const minute = parts.find((part) => part.type === 'minute')?.value ?? '00'
    if (hour === '24') {
      hour = '00'
    }
    return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  } catch {
    if (timeZone !== 'UTC') {
      return formatInZone(date, 'UTC')
    }
    return '—'
  }
}
