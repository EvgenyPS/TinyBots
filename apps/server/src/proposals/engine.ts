/**
 * FILE: apps/server/src/proposals/engine.ts
 * НАЗНАЧЕНИЕ: создать, применить, отклонить и откатить предложение.
 * ВХОД: папка проекта и data_dir. Проект меняется только в apply и revert.
 * ВЫХОД: состояние и короткая ошибка без абсолютных путей.
 * До «Применить» пишем только proposals/. Git на создании — rev-parse и symbolic-ref.
 */

import { lstat, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { canProposalTransition, type Proposal } from '@tinybots/schema'
import { ApplyKilled, acceptProjectFiles, restoreProjectFiles, sha256Of } from '../merge/files-apply.js'
import { redact } from '../redact.js'
import { readNoFollow } from '../store/nofollow.js'
import { writeAtomic } from '../store/atomic.js'
import { applyUnifiedDiff, parseUnifiedDiff } from '../tools/diff.js'
import {
  ensureGit,
  GIT_MISSING,
  inspectGitRepo,
  makeGit,
  type GitContext,
  type GitHooks,
} from '../tools/git.js'
import { loadGitignore, readSandboxedFile, resolveToolPath, type SandboxContext, type SandboxHooks } from '../tools/sandbox.js'
import { applyGitProposal, revertGitProposal, type GitKill } from './git-apply.js'
import {
  listProposals,
  newProposalId,
  openCount,
  proposalDir,
  proposalFile,
  readProposal,
  roomFor,
  sha256Buffer,
  sweepClosed,
  sweepIncomplete,
  withProposalQueue,
  writeProposal,
} from './store.js'

export type EngineHooks = SandboxHooks & GitHooks & GitKill & {
  afterCopy?: (index: number) => void
  beforeWrite?: (rel: string) => void
  /** После файлов во временной папке и до rename. Тест обрывает сигнал здесь. */
  beforePublish?: () => Promise<void> | void
}

function atIso(now: Date): string {
  return now.toISOString()
}

function live(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('tool_timeout')
  }
}

/** Каталог на Windows иногда ещё держит индексатор: EPERM/EBUSY повторяем, как у файла. */
async function publishDir(from: string, to: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : ''
      if ((code !== 'EPERM' && code !== 'EBUSY') || attempt === 4) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
}

async function keepRevertConflict(dataDir: string, item: Proposal, at: string, by: string): Promise<void> {
  if (item.state === 'revert_conflict') {
    return
  }
  await writeProposal(dataDir, move(item, 'revert_conflict', at, by, 'revert_conflict'))
}

function move(item: Proposal, state: Proposal['state'], at: string, by: string, why: string): Proposal {
  if (!canProposalTransition(item.state, state)) {
    throw new Error('invalid_state')
  }
  return { ...item, state, history: [...item.history, { state, at, by, why }] }
}

async function sandboxOf(projectReal: string, dataReal: string, configReal: string | null, respect: boolean): Promise<SandboxContext> {
  return {
    rootReal: projectReal,
    dataReal,
    launcherConfigReal: configReal,
    respectGitignore: respect,
    gitignore: await loadGitignore(projectReal, respect),
  }
}

export async function createProposal(input: {
  projectReal: string
  dataDir: string
  dataReal: string
  launcherCwd: string
  configReal: string | null
  respectGitignore: boolean
  projectId: string
  botId: string
  taskId?: string
  summary: string
  diff: string
  now: Date
  hooks?: EngineHooks
  /** git или files. Без поля — git, если в папке обычный каталог .git. */
  applyMode?: 'git' | 'files'
  signal?: AbortSignal
}): Promise<{ ok: true; id: string; mode: 'files' | 'git' } | { ok: false; error: string }> {
  live(input.signal)
  if (input.summary.trim().length === 0) {
    return { ok: false, error: 'нужна сводка' }
  }
  // Ссылка и значение не должны осесть в предложении. Отказ до записи файла.
  if (redact(input.summary) !== input.summary || redact(input.diff) !== input.diff) {
    return { ok: false, error: 'секрет в предложении' }
  }
  const ctx = await sandboxOf(input.projectReal, input.dataReal, input.configReal, input.respectGitignore)
  const parsed = parseUnifiedDiff(input.diff)
  if (!parsed.ok) {
    return { ok: false, error: parsed.reason }
  }
  const currentBytes = new Map<string, Buffer>()
  for (const file of parsed.files) {
    live(input.signal)
    if (file.isNew) {
      const created = await resolveToolPath(ctx, file.path, 'new')
      if (!created.ok) {
        return { ok: false, error: 'путь не принят' }
      }
      currentBytes.set(file.path, Buffer.alloc(0))
      continue
    }
    const read = await readSandboxedFile(ctx, file.path, input.hooks, input.signal)
    if (!read.ok) {
      return { ok: false, error: 'путь не принят' }
    }
    currentBytes.set(file.path, read.bytes)
  }
  const applied = applyUnifiedDiff(input.diff, (rel) => currentBytes.get(rel) ?? null)
  if (!applied.ok) {
    return { ok: false, error: applied.reason }
  }
  const files: Proposal['files'] = []
  const bodies = new Map<string, Buffer>()
  for (const file of applied.files) {
    const before = currentBytes.get(file.path) ?? Buffer.alloc(0)
    files.push({
      path: file.path,
      base_sha256: file.isNew ? null : sha256Buffer(before),
      post_sha256: sha256Buffer(file.after),
    })
    bodies.set(file.path, file.after)
  }
  let gitStat: Awaited<ReturnType<typeof lstat>> | null = null
  try {
    gitStat = await lstat(path.join(input.projectReal, '.git'))
  } catch {
    gitStat = null
  }
  let mode: 'files' | 'git' = 'files'
  let git: Proposal['git']
  const wantGit = input.applyMode === 'git' || (input.applyMode !== 'files' && Boolean(gitStat))
  if (input.applyMode === 'git' && (!gitStat || gitStat.isSymbolicLink() || !gitStat.isDirectory())) {
    return { ok: false, error: 'в папке нет git, ветка недоступна' }
  }
  if (wantGit && gitStat && !gitStat.isSymbolicLink() && gitStat.isDirectory()) {
    const found = await ensureGit({
      projectReals: [input.projectReal],
      dataReal: input.dataReal,
      execFile: input.hooks?.execFile,
    })
    if (!found.ok) {
      return { ok: false, error: GIT_MISSING }
    }
    const gitCtx: GitContext = {
      bin: found.bin,
      cwd: input.launcherCwd,
      rootReal: input.projectReal,
      dataDir: input.dataDir,
      hooks: input.hooks,
      signal: input.signal,
    }
    const inspected = await inspectGitRepo(gitCtx)
    if (!inspected.ok) {
      return { ok: false, error: inspected.reason }
    }
    mode = 'git'
    git = {
      object_format: inspected.format,
      head_ref: inspected.headRef,
      head_commit: inspected.headCommit,
      branch: 'tinybots/proposal-pending',
      tree: null,
      commit: null,
    }
  } else if (gitStat && (gitStat.isSymbolicLink() || !gitStat.isDirectory())) {
    return { ok: false, error: 'вложенный репозиторий не поддерживается' }
  }
  live(input.signal)
  await sweepClosed(input.dataDir, input.projectId, input.now)
  live(input.signal)
  const adding = Buffer.byteLength(input.diff) + [...bodies.values()].reduce((sum, item) => sum + item.length, 0)
  const room = await roomFor(input.dataDir, input.projectId, adding)
  if (room) {
    return { ok: false, error: room }
  }
  if (openCount(input.dataDir, input.projectId) >= 20) {
    return { ok: false, error: 'уже 20 открытых предложений' }
  }
  const id = newProposalId()
  if (git) {
    git = { ...git, branch: `tinybots/proposal-${id}` }
  }
  const dir = proposalDir(input.dataDir, id)
  // Сначала временная папка. Таймаут между файлами не оставляет proposals/<id> без json:
  // rename в боевое имя — только когда тела уже на диске, json пишется следом, ошибка стирает оба.
  const staging = path.join(path.dirname(dir), `.${id}.partial`)
  try {
    live(input.signal)
    await mkdir(path.join(staging, 'post'), { recursive: true })
    await writeAtomic(path.join(staging, 'patch.diff'), input.diff)
    for (const [rel, bytes] of bodies) {
      live(input.signal)
      const target = path.join(staging, 'post', rel)
      await mkdir(path.dirname(target), { recursive: true })
      await writeAtomic(target, bytes)
    }
    if (input.hooks?.beforePublish) {
      await input.hooks.beforePublish()
    }
    live(input.signal)
    await publishDir(staging, dir)
    const proposal: Proposal = {
      schema_version: 1,
      id,
      project: input.projectId,
      bot: input.botId,
      ...(input.taskId ? { task_id: input.taskId } : {}),
      summary: input.summary.trim(),
      state: 'proposed',
      patch_sha256: sha256Buffer(Buffer.from(input.diff)),
      mode,
      files,
      history: [{ state: 'proposed', at: atIso(input.now), by: input.botId, why: 'propose' }],
      ...(git ? { git } : {}),
    }
    await writeProposal(input.dataDir, proposal)
  } catch (error) {
    await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }).catch(() => undefined)
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }).catch(() => undefined)
    await rm(proposalFile(input.dataDir, id), { force: true }).catch(() => undefined)
    throw error
  }
  return { ok: true, id, mode }
}

async function conflict(dataDir: string, item: Proposal, at: string, by: string, why: string): Promise<Proposal> {
  const next = canProposalTransition(item.state, 'conflict')
    ? move(item, 'conflict', at, by, why)
    : item
  await writeProposal(dataDir, next)
  return next
}

export async function applyProposal(input: {
  dataDir: string
  projectReal: string
  launcherCwd: string
  id: string
  patchSha: string
  now: Date
  by: string
  hooks?: EngineHooks
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return withProposalQueue(async () => {
    const item = readProposal(input.dataDir, input.id)
    if (!item) {
      return { ok: false, error: 'missing' }
    }
    if (item.patch_sha256 !== input.patchSha) {
      return { ok: false, error: 'patch_sha256' }
    }
    if (item.state !== 'proposed') {
      return { ok: false, error: 'invalid_state' }
    }
    const at = atIso(input.now)
    if (item.mode === 'git' && item.git) {
      const found = await ensureGit({
        projectReals: [input.projectReal],
        dataReal: null,
        execFile: input.hooks?.execFile,
      })
      if (!found.ok) {
        await conflict(input.dataDir, item, at, input.by, 'missing_git')
        return { ok: false, error: 'missing_git' }
      }
      const api = makeGit({
        bin: found.bin,
        cwd: input.launcherCwd,
        rootReal: input.projectReal,
        dataDir: input.dataDir,
        hooks: input.hooks,
      })
      const zero = '0'.repeat(item.git.object_format === 'sha256' ? 64 : 40)
      const result = await applyGitProposal({
        dataDir: input.dataDir,
        projectReal: input.projectReal,
        proposal: item,
        git: api,
        zero,
        at,
        by: input.by,
        hooks: input.hooks,
      })
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    }
    for (const file of item.files) {
      const post = path.join(proposalDir(input.dataDir, item.id), 'post', file.path)
      try {
        const bytes = await readNoFollow(post)
        if (sha256Buffer(bytes) !== file.post_sha256) {
          await conflict(input.dataDir, item, at, input.by, 'conflict')
          return { ok: false, error: 'conflict' }
        }
      } catch {
        await conflict(input.dataDir, item, at, input.by, 'conflict')
        return { ok: false, error: 'conflict' }
      }
      const live = path.join(input.projectReal, file.path)
      try {
        const st = await lstat(live)
        if (st.isSymbolicLink() || !st.isFile() || st.nlink > 1) {
          await conflict(input.dataDir, item, at, input.by, 'conflict')
          return { ok: false, error: 'conflict' }
        }
        if (file.base_sha256 === null || await sha256Of(live) !== file.base_sha256) {
          await conflict(input.dataDir, item, at, input.by, 'conflict')
          return { ok: false, error: 'conflict' }
        }
      } catch (error) {
        const missing = Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT')
        if (file.base_sha256 === null && missing) {
          continue
        }
        await conflict(input.dataDir, item, at, input.by, 'conflict')
        return { ok: false, error: 'conflict' }
      }
    }
    const backup = path.join(proposalDir(input.dataDir, item.id), 'backup')
    await mkdir(backup, { recursive: true })
    let applying = item
    try {
      await acceptProjectFiles({
        projectDir: input.projectReal,
        mrId: item.id,
        files: item.files.map((file) => file.path),
        stagingRoot: path.join(proposalDir(input.dataDir, item.id), 'post'),
        backupRoot: backup,
        preserveMode: true,
        beforeCopy: async () => {
          applying = move(item, 'applying', at, input.by, 'apply')
          await writeProposal(input.dataDir, applying)
        },
        beforeCommit: async (rel) => {
          const meta = item.files.find((file) => file.path === rel)
          const live = path.join(input.projectReal, rel)
          if (meta?.base_sha256) {
            if (await sha256Of(live) !== meta.base_sha256) {
              throw new Error('conflict')
            }
          }
        },
        beforeWrite: input.hooks?.beforeWrite,
        afterCopy: (index) => {
          input.hooks?.afterCopy?.(index)
        },
      })
    } catch (error) {
      if (error instanceof ApplyKilled) {
        throw error
      }
      await conflict(input.dataDir, applying.state === 'applying' ? applying : item, at, input.by, 'conflict')
      return { ok: false, error: 'conflict' }
    }
    for (const file of item.files) {
      const live = path.join(input.projectReal, file.path)
      if (await sha256Of(live) !== file.post_sha256) {
        await restoreProjectFiles({
          projectDir: input.projectReal,
          mrId: item.id,
          files: item.files.map((row) => row.path),
          backupRoot: backup,
          preserveMode: true,
        })
        await conflict(input.dataDir, applying, at, input.by, 'conflict')
        return { ok: false, error: 'conflict' }
      }
    }
    await writeProposal(input.dataDir, move(applying, 'applied', at, input.by, 'apply'))
    return { ok: true }
  })
}

export async function rejectProposal(input: {
  dataDir: string
  id: string
  patchSha: string
  now: Date
  by: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return withProposalQueue(async () => {
    const item = readProposal(input.dataDir, input.id)
    if (!item) {
      return { ok: false, error: 'missing' }
    }
    if (item.patch_sha256 !== input.patchSha) {
      return { ok: false, error: 'patch_sha256' }
    }
    if (item.state !== 'proposed' && item.state !== 'conflict' && item.state !== 'revert_conflict') {
      return { ok: false, error: 'invalid_state' }
    }
    await writeProposal(input.dataDir, move(item, 'rejected', atIso(input.now), input.by, 'reject'))
    return { ok: true }
  })
}

export async function revertProposal(input: {
  dataDir: string
  projectReal: string
  launcherCwd: string
  id: string
  patchSha: string
  now: Date
  by: string
  hooks?: EngineHooks
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return withProposalQueue(async () => {
    const item = readProposal(input.dataDir, input.id)
    if (!item) {
      return { ok: false, error: 'missing' }
    }
    if (item.patch_sha256 !== input.patchSha) {
      return { ok: false, error: 'patch_sha256' }
    }
    if (item.state !== 'applied' && item.state !== 'revert_conflict') {
      return { ok: false, error: 'invalid_state' }
    }
    const at = atIso(input.now)
    if (item.mode === 'git' && item.git) {
      const found = await ensureGit({ projectReals: [input.projectReal], dataReal: null, execFile: input.hooks?.execFile })
      if (!found.ok) {
        return { ok: false, error: 'missing_git' }
      }
      const api = makeGit({
        bin: found.bin,
        cwd: input.launcherCwd,
        rootReal: input.projectReal,
        dataDir: input.dataDir,
        hooks: input.hooks,
      })
      const result = await revertGitProposal({ dataDir: input.dataDir, proposal: item, git: api, at, by: input.by })
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    }
    for (const file of item.files) {
      const live = path.join(input.projectReal, file.path)
      try {
        const st = await lstat(live)
        if (st.isSymbolicLink() || !st.isFile() || st.nlink > 1) {
          await keepRevertConflict(input.dataDir, item, at, input.by)
          return { ok: false, error: 'revert_conflict' }
        }
        if (await sha256Of(live) !== file.post_sha256) {
          await keepRevertConflict(input.dataDir, item, at, input.by)
          return { ok: false, error: 'revert_conflict' }
        }
      } catch {
        await keepRevertConflict(input.dataDir, item, at, input.by)
        return { ok: false, error: 'revert_conflict' }
      }
    }
    let reverting = move(item, 'reverting', at, input.by, 'revert')
    await writeProposal(input.dataDir, reverting)
    await restoreProjectFiles({
      projectDir: input.projectReal,
      mrId: item.id,
      files: item.files.map((file) => file.path),
      backupRoot: path.join(proposalDir(input.dataDir, item.id), 'backup'),
      preserveMode: true,
    })
    for (const file of item.files) {
      if (file.base_sha256 === null) {
        continue
      }
      const live = path.join(input.projectReal, file.path)
      if (await sha256Of(live) !== file.base_sha256) {
        const bad = move(reverting, 'revert_conflict', at, input.by, 'revert_conflict')
        await writeProposal(input.dataDir, bad)
        return { ok: false, error: 'revert_conflict' }
      }
    }
    reverting = move(reverting, 'reverted', at, input.by, 'revert')
    await writeProposal(input.dataDir, reverting)
    return { ok: true }
  })
}

/** Старт: снять недописанные папки proposals и довести applying/reverting. Повторный вызов ничего не меняет. */
export async function recoverProposals(dataDir: string, projectRealOf: (project: string) => string | null, now: Date, hooks?: GitHooks): Promise<void> {
  // Kill между rename и json оставляет каталог без json. Он входит в квоту 256 МиБ.
  // Уборка только здесь, на старте: во время записи свой .partial ещё нужен.
  await sweepIncomplete(dataDir)
  for (const item of listProposals(dataDir)) {
    if (item.state !== 'applying' && item.state !== 'reverting') {
      continue
    }
    const at = atIso(now)
    const indexFile = path.join(proposalDir(dataDir, item.id), 'index.tmp')
    await rm(indexFile, { force: true }).catch(() => undefined)
    await rm(`${indexFile}.lock`, { force: true }).catch(() => undefined)
    if (item.mode === 'files') {
      const projectReal = projectRealOf(item.project)
      if (!projectReal) {
        continue
      }
      const backup = path.join(proposalDir(dataDir, item.id), 'backup')
      try {
        await restoreProjectFiles({
          projectDir: projectReal,
          mrId: item.id,
          files: item.files.map((file) => file.path),
          backupRoot: backup,
          preserveMode: true,
        })
      } catch {
        // снимок уже мог быть восстановлен прошлым стартом
      }
      if (item.state === 'applying') {
        await writeProposal(dataDir, move(item, 'conflict', at, 'server', 'crash_recovered'))
      } else {
        await writeProposal(dataDir, move(item, 'reverted', at, 'server', 'revert'))
      }
      continue
    }
    const projectReal = projectRealOf(item.project)
    if (!projectReal || !item.git) {
      continue
    }
    const found = await ensureGit({ projectReals: [projectReal], dataReal: null, execFile: hooks?.execFile })
    if (!found.ok) {
      continue
    }
    const api = makeGit({ bin: found.bin, cwd: process.cwd(), rootReal: projectReal, dataDir, hooks })
    const branchRef = `refs/heads/${item.git.branch}`
    const pointed = await api.verifyRef(branchRef)
    const exists = pointed.code === 0
    const same = exists && pointed.stdout.trim() === item.git.commit
    if (item.state === 'applying') {
      if (!exists) {
        await writeProposal(dataDir, move(item, 'conflict', at, 'server', 'crash_recovered'))
      } else if (same && item.git.commit) {
        await writeProposal(dataDir, move(item, 'applied', at, 'server', 'apply'))
      } else {
        await writeProposal(dataDir, move(item, 'conflict', at, 'server', 'crash_recovered'))
      }
      continue
    }
    if (!exists) {
      await writeProposal(dataDir, move(item, 'reverted', at, 'server', 'revert'))
    } else {
      await writeProposal(dataDir, move(item, 'applied', at, 'server', 'apply'))
    }
  }
}

export function proposalsOf(dataDir: string, project: string): Proposal[] {
  return listProposals(dataDir).filter((item) => item.project === project)
}

export { proposalFile }
