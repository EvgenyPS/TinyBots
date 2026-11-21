/**
 * FILE: apps/server/src/proposals/http.ts
 * НАЗНАЧЕНИЕ: маршруты предложений. Чтение — GET, запись — apply, reject, revert.
 * ВХОД: тело {id, patch_sha256}. Кто подтверждает, берём из конфига, не из тела.
 * ВЫХОД: статус без абсолютных путей. apply и revert без confirms_merge — 403.
 * Неверный хеш — 409, файлы и json не меняются.
 */

import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { idSchema } from '@tinybots/schema'
import { loadConfigAt, resolveDataDir, selectConfigRequest } from '../config/load.js'
import type { LaunchOptions } from '../launcher/view.js'
import { applyProposal, proposalsOf, rejectProposal, revertProposal } from './engine.js'
import { OWNER_TEXT, storageWarning } from './store.js'

const bodySchema = z.strictObject({
  id: idSchema,
  patch_sha256: z.string().regex(/^[0-9a-f]{64}$/),
})

export type ProposalReply = { status: 200 | 403 | 404 | 409 | 422; body: Record<string, unknown> }

function projectReal(root: string, folder: string): string | null {
  try {
    return realpathSync(path.isAbsolute(folder) ? folder : path.resolve(root, folder))
  } catch {
    return null
  }
}

async function act(
  root: string,
  options: LaunchOptions | undefined,
  payload: unknown,
  kind: 'apply' | 'reject' | 'revert',
): Promise<ProposalReply> {
  const parsed = bodySchema.safeParse(payload)
  if (!parsed.success) {
    return { status: 422, body: { ok: false, error: 'invalid', message: 'тело не разобралось' } }
  }
  const loaded = loadConfigAt(root, selectConfigRequest(root, options?.configPath))
  if (!loaded.ok) {
    return { status: 422, body: { ok: false, error: 'config', message: loaded.reason } }
  }
  if ((kind === 'apply' || kind === 'revert') && !loaded.config.owner.confirms_merge) {
    return { status: 403, body: { ok: false, error: 'owner_required' } }
  }
  const dataDir = resolveDataDir(root, loaded.directory, loaded.config.data_dir)
  if (!dataDir.ok) {
    return { status: 422, body: { ok: false, error: 'config', message: dataDir.reason } }
  }
  const item = loaded.config.projects
    .flatMap((project) => proposalsOf(dataDir.dir, project.id))
    .find((row) => row.id === parsed.data.id)
  if (!item) {
    return { status: 404, body: { ok: false, error: 'missing' } }
  }
  const project = loaded.config.projects.find((row) => row.id === item.project)
  const folder = project?.source.files?.path
  const real = folder ? projectReal(loaded.directory, folder) : null
  if (!real) {
    return { status: 422, body: { ok: false, error: 'config', message: 'папка проекта не открылась' } }
  }
  const now = options?.now?.() ?? new Date()
  const by = loaded.config.owner.name
  const common = {
    dataDir: dataDir.dir,
    id: parsed.data.id,
    patchSha: parsed.data.patch_sha256,
    now,
    by,
  }
  const result = kind === 'reject'
    ? await rejectProposal(common)
    : kind === 'apply'
      ? await applyProposal({ ...common, projectReal: real, launcherCwd: root })
      : await revertProposal({ ...common, projectReal: real, launcherCwd: root })
  if (!result.ok) {
    if (result.error === 'patch_sha256' || result.error === 'invalid_state' || result.error === 'missing') {
      const status = result.error === 'missing' ? 404 : 409
      return { status, body: { ok: false, error: result.error, message: OWNER_TEXT[result.error] ?? result.error } }
    }
    return {
      status: 409,
      body: { ok: false, error: result.error, message: OWNER_TEXT[result.error] ?? 'предложение не применилось' },
    }
  }
  return { status: 200, body: { ok: true, id: item.id } }
}

export function postProposalApply(root: string, options: LaunchOptions | undefined, payload: unknown): Promise<ProposalReply> {
  return act(root, options, payload, 'apply')
}

export function postProposalReject(root: string, options: LaunchOptions | undefined, payload: unknown): Promise<ProposalReply> {
  return act(root, options, payload, 'reject')
}

export function postProposalRevert(root: string, options: LaunchOptions | undefined, payload: unknown): Promise<ProposalReply> {
  return act(root, options, payload, 'revert')
}

function readDiff(dataDir: string, id: string): string {
  try {
    return readFileSync(path.join(dataDir, 'proposals', id, 'patch.diff'), 'utf8')
  } catch {
    return ''
  }
}

export async function getProposals(root: string, options: LaunchOptions | undefined, project: string): Promise<ProposalReply> {
  const loaded = loadConfigAt(root, selectConfigRequest(root, options?.configPath))
  if (!loaded.ok) {
    return { status: 422, body: { ok: false, error: 'config', message: loaded.reason } }
  }
  const dataDir = resolveDataDir(root, loaded.directory, loaded.config.data_dir)
  if (!dataDir.ok) {
    return { status: 422, body: { ok: false, error: 'config', message: dataDir.reason } }
  }
  const items = proposalsOf(dataDir.dir, project).map((item) => ({
    id: item.id,
    project_id: item.project,
    bot_id: item.bot,
    task_id: item.task_id ?? null,
    summary: item.summary,
    state: item.state,
    why: item.history[item.history.length - 1]?.why ?? '',
    patch_sha256: item.patch_sha256,
    mode: item.mode,
    branch: item.git?.branch ?? null,
    files: item.files.map((file) => ({ path: file.path, is_new: file.base_sha256 === null })),
    diff: readDiff(dataDir.dir, item.id),
  }))
  return { status: 200, body: { ok: true, proposals: items, storage_warning: await storageWarning(dataDir.dir) } }
}
