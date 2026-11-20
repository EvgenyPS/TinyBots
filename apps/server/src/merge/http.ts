/**
 * FILE: apps/server/src/merge/http.ts
 * НАЗНАЧЕНИЕ: HTTP-решения владельца и синхронизация outbox.
 * ВХОД: корень, опции запуска и тело POST. Кто решает, берём из конфига, не из тела.
 * ВЫХОД: статус и json без абсолютных путей.
 * Решение только кладётся в outbox. Статус запроса меняет postSync, не postDecision.
 */

import path from 'node:path'
import { SCHEMA_VERSION, idSchema, decisionSchema, feedbackSchema } from '@tinybots/schema'
import { z } from 'zod'
import { loadConfigAt, resolveDataDir, selectConfigRequest } from '../config/load.js'
import type { LaunchOptions } from '../launcher/view.js'
import { readMerges, writeOutbox } from './disk.js'
import { deliverOutbox } from './deliver.js'

const bodySchema = z.strictObject({
  id: idSchema,
  action: z.enum(['approved', 'rejected', 'changes_requested', 'revert']),
  feedback: z.string().optional(),
  sent_to_chats: z.array(idSchema).optional(),
  accept_risk: z.boolean().optional(),
})

export type MergeReply = { status: 200 | 403 | 404 | 409 | 422; body: Record<string, unknown> }

let clockStep = 0

function atFrom(now: Date): string {
  clockStep += 1
  return new Date(now.getTime() + clockStep).toISOString()
}

function relativeTo(dataDir: string, file: string): string {
  return path.relative(dataDir, file).split(path.sep).join('/')
}

export async function postDecision(root: string, options: LaunchOptions | undefined, payload: unknown): Promise<MergeReply> {
  const parsedBody = bodySchema.safeParse(payload)
  if (!parsedBody.success) {
    return { status: 422, body: { ok: false, error: 'invalid_decision', reason: 'тело решения не разобралось' } }
  }
  const loaded = loadConfigAt(root, selectConfigRequest(root, options?.configPath))
  if (!loaded.ok) {
    return { status: 422, body: { ok: false, error: 'invalid_decision', reason: loaded.reason } }
  }
  if (!loaded.config.owner.confirms_merge) {
    return { status: 403, body: { ok: false, error: 'owner_required' } }
  }
  const dataDir = resolveDataDir(root, loaded.directory, loaded.config.data_dir)
  if (!dataDir.ok) {
    return { status: 422, body: { ok: false, error: 'invalid_decision', reason: dataDir.reason } }
  }
  const stored = readMerges(dataDir.dir).find((item) => item.id === parsedBody.data.id)
  if (!stored) {
    return { status: 404, body: { ok: false, error: 'merge_missing' } }
  }
  const project = loaded.config.projects.find((item) => item.id === stored.mr.project)
  if (!project) {
    return { status: 404, body: { ok: false, error: 'merge_missing' } }
  }
  const owner = stored.mr.owner && stored.mr.owner.length > 0 ? stored.mr.owner : project.owner
  const action = parsedBody.data.action
  const waiting = stored.mr.state === 'awaiting_owner'
  if ((action === 'approved' || action === 'rejected' || action === 'changes_requested') && !waiting) {
    return { status: 409, body: { ok: false, error: 'wrong_state' } }
  }
  if (action === 'revert' && stored.mr.state !== 'merged') {
    return { status: 409, body: { ok: false, error: 'wrong_state' } }
  }
  const feedback = (parsedBody.data.feedback ?? '').trim()
  if ((action === 'rejected' || action === 'changes_requested') && feedback.length === 0) {
    return { status: 422, body: { ok: false, error: 'comment_required', reason: 'нужен комментарий' } }
  }
  if (action === 'approved' && stored.mr.checks === 'red' && parsedBody.data.accept_risk !== true) {
    return { status: 422, body: { ok: false, error: 'risk_required', reason: 'красный CI: нужна отметка риска' } }
  }
  const knownChats = new Set(project.chats.map((chat) => chat.id))
  const requested = parsedBody.data.sent_to_chats
  const sent = (requested ?? stored.mr.affected_chats ?? []).filter((id) => knownChats.has(id))
  const at = atFrom(options?.now?.() ?? new Date())
  const before = stored.mr.state
  try {
    if (action === 'changes_requested') {
      const taskId = stored.mr.task_id ?? stored.mr.tasks[0]
      if (!taskId) {
        return { status: 422, body: { ok: false, error: 'invalid_decision', reason: 'нет задачи' } }
      }
      const feedbackId = `fb-${stored.id}`
      const body = feedbackSchema.parse({
        schema_version: SCHEMA_VERSION,
        updated_at: at,
        id: feedbackId,
        project: stored.mr.project,
        task_id: taskId,
        by: owner,
        at,
        feedback,
        sent_to_chats: sent,
        mr_id: stored.id,
        intent: 'changes_requested',
      })
      const file = await writeOutbox(dataDir.dir, 'feedback', feedbackId, body)
      const after = readMerges(dataDir.dir).find((item) => item.id === stored.id)
      return {
        status: 200,
        body: { ok: true, file: relativeTo(dataDir.dir, file), state: after?.mr.state ?? before, sent_to_chats: sent },
      }
    }
    const decision = decisionSchema.parse({
      schema_version: SCHEMA_VERSION,
      updated_at: at,
      action,
      head_sha: stored.mr.head_sha,
      by: owner,
      at,
      project: stored.mr.project,
      pr_url: stored.mr.pr_url,
      mr_id: stored.id,
      ...(parsedBody.data.accept_risk === true ? { accept_risk: true } : {}),
    })
    const file = await writeOutbox(dataDir.dir, 'decisions', stored.id, decision)
    const after = readMerges(dataDir.dir).find((item) => item.id === stored.id)
    return {
      status: 200,
      body: { ok: true, file: relativeTo(dataDir.dir, file), state: after?.mr.state ?? before },
    }
  } catch {
    return { status: 422, body: { ok: false, error: 'invalid_decision', reason: 'решение не записалось' } }
  }
}

export async function postSync(root: string, options: LaunchOptions | undefined): Promise<MergeReply> {
  const loaded = loadConfigAt(root, selectConfigRequest(root, options?.configPath))
  if (!loaded.ok) {
    return { status: 422, body: { ok: false, error: 'invalid_sync', reason: loaded.reason } }
  }
  const dataDir = resolveDataDir(root, loaded.directory, loaded.config.data_dir)
  if (!dataDir.ok) {
    return { status: 422, body: { ok: false, error: 'invalid_sync', reason: dataDir.reason } }
  }
  try {
    const report = await deliverOutbox({
      dataDir: dataDir.dir,
      config: loaded.config,
      configDirectory: loaded.directory,
      now: options?.now?.() ?? new Date(),
    })
    return { status: 200, body: { ok: true, applied: report.applied } }
  } catch {
    return { status: 422, body: { ok: false, error: 'invalid_sync', reason: 'не удалось доставить решение' } }
  }
}
