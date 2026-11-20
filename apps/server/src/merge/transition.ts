/**
 * FILE: apps/server/src/merge/transition.ts
 * НАЗНАЧЕНИЕ: один шаг автомата §4.5 и запись в журнал.
 * ВХОД: запрос и куда переходим, кто, когда и почему. Смена head_sha — отдельная причина.
 * ВЫХОД: новый запрос. Чужой переход не записывается: функция бросает ошибку, файл не трогаем.
 * Журнал — history[{state, at, by, why}]. Пустые «кто» и «почему» тоже отказ.
 */

import { canTransition, mergeRequestSchema, type MergeRequest, type MergeState } from '@tinybots/schema'

export class MergeTransitionError extends Error {
  readonly from: string
  readonly to: string

  constructor(from: string, to: string) {
    super(`переход ${from} → ${to} запрещён`)
    this.name = 'MergeTransitionError'
    this.from = from
    this.to = to
  }
}

export function applyTransition(
  mr: MergeRequest,
  input: { to: MergeState; by: string; at: string; why: string; cause?: 'head_sha_changed' },
): MergeRequest {
  const by = input.by.trim()
  const why = input.why.trim()
  if (by.length === 0 || why.length === 0 || !canTransition(mr.state, input.to, input.cause)) {
    throw new MergeTransitionError(mr.state, input.to)
  }
  const parsed = mergeRequestSchema.safeParse({
    ...mr,
    state: input.to,
    updated_at: input.at,
    history: [...mr.history, { state: input.to, at: input.at, by, why }],
  })
  if (!parsed.success) {
    throw new MergeTransitionError(mr.state, input.to)
  }
  return parsed.data
}
