/**
 * FILE: apps/server/src/briefs/link.ts
 * НАЗНАЧЕНИЕ: ссылка на чат главного в приложении Grok Bot.
 * ВХОД: grok_id из конфига.
 * ВЫХОД: grokbot://app/v1/agent?id=<id> либо null, если id пустой или с пробелами.
 * Пустой и битый id не становятся ссылкой. Подсказка с именем бота есть всегда:
 * ссылка из браузера может не открыться, и тогда чат ищут вручную.
 */

const GROK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/

export function grokbotHref(grokId: string | null | undefined): string | null {
  const id = grokId?.trim() ?? ''
  if (!GROK_ID.test(id)) {
    return null
  }
  return `grokbot://app/v1/agent?id=${id}`
}

export function manualChatHint(name: string): string {
  return `Если чат не открылся, откройте ${name} вручную.`
}
