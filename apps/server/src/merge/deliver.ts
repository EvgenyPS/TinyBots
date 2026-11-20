/**
 * FILE: apps/server/src/merge/deliver.ts
 * НАЗНАЧЕНИЕ: доставить outbox в запрос. Пока синхронизации не было, статус на месте.
 * ВХОД: data_dir, конфиг и момент времени. Решение и отзыв уже лежат в outbox.
 * ВЫХОД: обновлённые запросы. Исполнитель стартует только из delivered и только с брифом.
 * GitHub здесь — мок. Режим files перед заменой пишет backups/<mr-id>/.
 * Повторная синхронизация то же решение второй раз не применяет.
 * Ошибка одного запроса не останавливает остальные в этом вызове.
 */

import path from 'node:path'
import type { Feedback, LauncherConfig, MergeRequest, OwnerDecision } from '@tinybots/schema'
import { buildMergeBrief, buildRevertBrief } from './authorize.js'
import { readDecisions, readFeedbackFiles, readMerges, writeMergeFile, type StoredMerge } from './disk.js'
import { acceptProjectFiles, restoreProjectFiles } from './files-apply.js'
import { mockGithubMerge, mockGithubRevert } from './github-mock.js'
import { logSafe } from '../redact.js'
import { applyTransition } from './transition.js'

/** Текст для владельца: без путей и без чужих дампов. */
function publicFault(error: unknown): string {
  if (error instanceof Error) {
    const line = error.message.split(/\r?\n/)[0]?.trim() ?? ''
    if (line.length > 0 && line.length <= 300 && !line.includes('/') && !line.includes('\\')) {
      return line
    }
  }
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) {
      return `сбой отката (${code})`
    }
  }
  return 'сбой отката'
}

function faultAction(action: string): 'merge' | 'revert' {
  return action === 'revert' ? 'revert' : 'merge'
}

export type DeliverInput = {
  dataDir: string
  config: LauncherConfig
  configDirectory: string
  now: Date
}

export type DeliverReport = { applied: Array<{ id: string; state: string }> }

type Act =
  | { kind: 'decision'; at: string; decision: OwnerDecision }
  | { kind: 'feedback'; at: string; feedback: Feedback }

function ownerOf(mr: MergeRequest, projectOwner: string): string {
  return mr.owner && mr.owner.length > 0 ? mr.owner : projectOwner
}

/** Успешный переход снимает старый fault, иначе панель продолжает показывать прошлый сбой. */
function clearFault(mr: MergeRequest): MergeRequest {
  if (!mr.fault) {
    return mr
  }
  const next: MergeRequest = { ...mr }
  delete next.fault
  return next
}

function decisionMatches(id: string, mr: MergeRequest, decision: OwnerDecision): boolean {
  if (decision.mr_id) {
    return decision.mr_id === id
  }
  return decision.project === mr.project && decision.pr_url === mr.pr_url
}

function latestAct(id: string, mr: MergeRequest, decisions: readonly OwnerDecision[], feedbacks: readonly Feedback[]): Act | null {
  const acts: Act[] = []
  for (const decision of decisions) {
    if (decisionMatches(id, mr, decision)) {
      acts.push({ kind: 'decision', at: decision.at, decision })
    }
  }
  for (const feedback of feedbacks) {
    if (feedback.intent === 'changes_requested' && feedback.mr_id === id) {
      acts.push({ kind: 'feedback', at: feedback.at, feedback })
    }
  }
  acts.sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0))
  return acts.at(-1) ?? null
}

function changesAlreadyApplied(mr: MergeRequest, feedback: Feedback): boolean {
  return (mr.iterations ?? []).some((item) =>
    item.decision?.action === 'changes_requested'
    && item.decision.feedback === feedback.feedback
    && item.decision.at === feedback.at)
}

function withChanges(mr: MergeRequest, feedback: Feedback, lead: string): MergeRequest {
  const iterations = (mr.iterations ?? []).map((item) => ({ ...item }))
  if (iterations.length === 0) {
    iterations.push({
      n: 1,
      created_at: mr.updated_at,
      done: [],
      broken: [],
      postponed: [],
      risks: [],
      other: mr.summary,
      addressed_feedback: null,
      decision: null,
    })
  }
  const open = iterations[iterations.length - 1]
  if (!open) {
    return mr
  }
  iterations[iterations.length - 1] = {
    ...open,
    decision: {
      by: feedback.by,
      at: feedback.at,
      action: 'changes_requested',
      feedback: feedback.feedback,
      sent_to_chats: [...feedback.sent_to_chats],
    },
  }
  const nextN = iterations.reduce((max, item) => Math.max(max, item.n), 0) + 1
  iterations.push({
    n: nextN,
    created_at: feedback.at,
    done: [],
    broken: [],
    postponed: [],
    risks: [],
    other: '',
    addressed_feedback: {
      quote: feedback.feedback,
      fixed: ['исправлено по отзыву'],
      remaining: ['осталось проверить'],
    },
    decision: null,
  })
  let current = applyTransition(
    { ...mr, iterations },
    { to: 'changes_requested', by: feedback.by, at: feedback.at, why: feedback.feedback },
  )
  current = applyTransition(current, {
    to: 'awaiting_owner',
    by: lead,
    at: feedback.at,
    why: 'итерация готова',
  })
  return current
}

function sourceDir(configDirectory: string, project: LauncherConfig['projects'][number]): string | null {
  const raw = project.source.files?.path
  if (!raw) {
    return null
  }
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(configDirectory, raw)
}

async function runMerge(
  mr: MergeRequest,
  id: string,
  decision: OwnerDecision,
  project: LauncherConfig['projects'][number],
  configDirectory: string,
  at: string,
): Promise<MergeRequest> {
  const owner = ownerOf(mr, project.owner)
  let current = applyTransition(mr, { to: 'approved', by: owner, at, why: 'решение владельца' })
  current = applyTransition(current, { to: 'delivered', by: project.lead, at, why: 'решение доставлено на бокс' })
  const brief = buildMergeBrief({
    state: current.state,
    owner,
    id,
    pr_url: current.pr_url,
    head_sha: current.head_sha,
    checks: current.checks,
    decision,
  })
  if (!brief.ok) {
    return mr
  }
  current = applyTransition(current, { to: 'merging', by: project.merge_executor, at, why: brief.text })
  const mode = current.mode ?? 'git'
  if (mode === 'files') {
    const dir = sourceDir(configDirectory, project)
    const files = (current.files ?? []).map((item) => item.path)
    if (!dir || files.length === 0) {
      current = applyTransition(current, { to: 'merge_failed', by: project.merge_executor, at, why: 'нет файлов для переноса' })
      return applyTransition(current, { to: 'awaiting_owner', by: project.lead, at, why: 'нет файлов для переноса' })
    }
    try {
      await acceptProjectFiles({ projectDir: dir, mrId: id, files })
    } catch (error) {
      const why = publicFault(error)
      current = applyTransition(current, { to: 'merge_failed', by: project.merge_executor, at, why })
      return applyTransition(current, { to: 'awaiting_owner', by: project.lead, at, why })
    }
    current = applyTransition(current, { to: 'merged', by: project.merge_executor, at, why: 'файлы приняты' })
    return { ...current, merge: { commit: null, executed_by: project.merge_executor, at } }
  }
  const merged = mockGithubMerge(current.pr_url)
  if (!merged.ok) {
    current = applyTransition(current, { to: 'merge_failed', by: project.merge_executor, at, why: merged.error })
    return applyTransition(current, { to: 'awaiting_owner', by: project.lead, at, why: merged.error })
  }
  current = applyTransition(current, { to: 'merged', by: project.merge_executor, at, why: 'мок GitHub смержил' })
  return { ...current, merge: { commit: merged.commit, executed_by: project.merge_executor, at } }
}

async function runRevert(
  mr: MergeRequest,
  id: string,
  decision: OwnerDecision,
  project: LauncherConfig['projects'][number],
  configDirectory: string,
  at: string,
): Promise<MergeRequest> {
  const owner = ownerOf(mr, project.owner)
  const brief = buildRevertBrief({
    state: mr.state,
    owner,
    id,
    pr_url: mr.pr_url,
    mode: 'revert',
    decision,
  })
  if (!brief.ok) {
    return mr
  }
  const mode = mr.mode ?? 'git'
  if (mode === 'files') {
    const dir = sourceDir(configDirectory, project)
    const files = (mr.files ?? []).map((item) => item.path)
    if (!dir || files.length === 0) {
      return mr
    }
    await restoreProjectFiles({ projectDir: dir, mrId: id, files })
    const current = applyTransition(mr, { to: 'reverted', by: owner, at, why: brief.text })
    return { ...current, revert: { pr: null, requested_by: owner, approved_by: owner } }
  }
  const reverted = mockGithubRevert(mr.pr_url)
  const current = applyTransition(mr, { to: 'reverted', by: owner, at, why: brief.text })
  return { ...current, revert: { pr: reverted.pr, requested_by: owner, approved_by: owner } }
}

async function applyOne(stored: StoredMerge, input: DeliverInput, decisions: readonly OwnerDecision[], feedbacks: readonly Feedback[]): Promise<MergeRequest | null> {
  const project = input.config.projects.find((item) => item.id === stored.mr.project)
  if (!project) {
    return null
  }
  const owner = ownerOf(stored.mr, project.owner)
  const mr = stored.mr
  // Тот же объект — перехода не было, fault не трогаем. Новый объект — переход прошёл.
  const done = (next: MergeRequest): MergeRequest => (next === mr ? next : clearFault(next))
  if (mr.state === 'approved') {
    const approved = decisions.find((item) => decisionMatches(stored.id, mr, item) && item.action === 'approved')
    if (approved && approved.head_sha !== mr.head_sha) {
      return done(applyTransition(mr, {
        to: 'awaiting_owner',
        by: project.lead,
        at: input.now.toISOString(),
        why: 'head_sha изменился',
        cause: 'head_sha_changed',
      }))
    }
  }
  const act = latestAct(stored.id, mr, decisions, feedbacks)
  if (!act) {
    return null
  }
  if (act.kind === 'feedback') {
    if (mr.state !== 'awaiting_owner' || act.feedback.by !== owner || changesAlreadyApplied(mr, act.feedback)) {
      return null
    }
    return done(withChanges(mr, act.feedback, project.lead))
  }
  const decision = act.decision
  if (decision.by !== owner || decision.head_sha !== mr.head_sha) {
    return null
  }
  // Тот же сбой уже записан владельцу. Повторный синк не пробует откат молча.
  if (mr.fault && mr.fault.at === decision.at && mr.fault.action === faultAction(decision.action)) {
    return null
  }
  if (decision.action === 'approved' && mr.state === 'awaiting_owner') {
    if (mr.checks === 'red' && decision.accept_risk !== true) {
      return null
    }
    return done(await runMerge(mr, stored.id, decision, project, input.configDirectory, decision.at))
  }
  if (decision.action === 'rejected' && mr.state === 'awaiting_owner') {
    return done(applyTransition(mr, { to: 'rejected', by: owner, at: decision.at, why: 'решение владельца: отклонить' }))
  }
  if (decision.action === 'revert' && mr.state === 'merged') {
    return done(await runRevert(mr, stored.id, decision, project, input.configDirectory, decision.at))
  }
  return null
}

export async function deliverOutbox(input: DeliverInput): Promise<DeliverReport> {
  const decisions = readDecisions(input.dataDir)
  const feedbacks = readFeedbackFiles(input.dataDir)
  const applied: Array<{ id: string; state: string }> = []
  for (const stored of readMerges(input.dataDir)) {
    try {
      const next = await applyOne(stored, input, decisions, feedbacks)
      // null и тот же объект — решать было нечего. Новый объект пишем, даже если статус
      // снова awaiting_owner: так на диск попадает итерация после «на доработку».
      if (!next || next === stored.mr) {
        continue
      }
      await writeMergeFile(stored.file, next)
      applied.push({ id: stored.id, state: next.state })
    } catch (error) {
      // Сбой этого запроса не рвёт весь синк, но причину пишем в запрос и в журнал.
      // Пустой catch здесь раньше глотал сбой отката, и следующий синк пробовал снова.
      const why = publicFault(error)
      const project = input.config.projects.find((item) => item.id === stored.mr.project)
      const owner = project ? ownerOf(stored.mr, project.owner) : 'owner'
      const act = latestAct(stored.id, stored.mr, decisions, feedbacks)
      const action = act?.kind === 'decision' ? faultAction(act.decision.action) : 'revert'
      const at = act?.kind === 'decision' ? act.decision.at : input.now.toISOString()
      if (stored.mr.fault && stored.mr.fault.action === action && stored.mr.fault.at === at) {
        continue
      }
      const stamped = input.now.toISOString()
      const next = {
        ...stored.mr,
        updated_at: stamped,
        fault: { action, at, why },
        history: [...stored.mr.history, { state: stored.mr.state, at: stamped, by: owner, why }],
      }
      try {
        await writeMergeFile(stored.file, next)
      } catch (writeError) {
        logSafe(`не удалось записать сбой отката: ${publicFault(writeError)}`)
      }
    }
  }
  return { applied }
}
