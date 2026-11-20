/**
 * FILE: apps/server/src/merge/authorize.ts
 * НАЗНАЧЕНИЕ: брифы «мержи» и «откати». Это разрешение исполнителю, не сам мерж.
 * ВХОД: статус запроса, владелец и решение. GitHub отсюда не вызывается.
 * ВЫХОД: одна строка брифа либо отказ. Отказ не пишет файлов.
 * Мерж — только delivered + approved + by == owner. Откат — mode revert, только из merged.
 */

export type BriefDecision = {
  action: string
  by: string
  head_sha?: string
  accept_risk?: boolean
}

export type BriefResult = { ok: true; text: string } | { ok: false; reason: string }

export function buildMergeBrief(input: {
  state: string
  owner: string
  id: string
  pr_url: string
  head_sha: string
  checks: 'green' | 'red'
  decision: BriefDecision
}): BriefResult {
  if (input.state !== 'delivered') {
    return { ok: false, reason: 'мерж только из delivered' }
  }
  if (input.decision.action !== 'approved') {
    return { ok: false, reason: 'нужно решение approved' }
  }
  if (input.decision.by !== input.owner) {
    return { ok: false, reason: 'решение не от владельца' }
  }
  if (input.decision.head_sha !== undefined && input.decision.head_sha !== input.head_sha) {
    return { ok: false, reason: 'head_sha решения не совпал' }
  }
  if (input.checks === 'red' && input.decision.accept_risk !== true) {
    return { ok: false, reason: 'красный CI без отметки риска' }
  }
  return { ok: true, text: `мержи ${input.id} ${input.pr_url}` }
}

export function buildRevertBrief(input: {
  state: string
  owner: string
  id: string
  pr_url: string
  mode: string
  decision: BriefDecision
}): BriefResult {
  if (input.mode !== 'revert') {
    return { ok: false, reason: 'нужен mode revert' }
  }
  if (input.state !== 'merged') {
    return { ok: false, reason: 'откат только из merged' }
  }
  if (input.decision.action !== 'revert') {
    return { ok: false, reason: 'нужно решение revert' }
  }
  if (input.decision.by !== input.owner) {
    return { ok: false, reason: 'решение не от владельца' }
  }
  return { ok: true, text: `откати ${input.id} ${input.pr_url}` }
}
