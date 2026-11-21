/**
 * FILE: apps/server/src/proposals/git-apply.ts
 * НАЗНАЧЕНИЕ: применить предложение коммитом на новой ветке, не трогая рабочее дерево.
 * ВХОД: предложение, обёртка git и крюки теста (обрыв до и после update-ref).
 * ВЫХОД: ветка tinybots/proposal-<id> или отказ без новой ветки.
 * Индекс пользователя — отдельный файл index.tmp. checkout и хуки не запускаются.
 */

import { rm } from 'node:fs/promises'
import path from 'node:path'
import { canProposalTransition, type Proposal } from '@tinybots/schema'
import { readNoFollow } from '../store/nofollow.js'
import { attributeBlock } from '../tools/attrs.js'
import { GitApi } from '../tools/git.js'
import { DIFF_FILE_MAX } from '../tools/limits.js'
import { proposalDir, sha256Buffer, writeProposal } from './store.js'

export type GitKill = {
  afterCommit?: () => void
  afterRef?: () => void
}

function move(item: Proposal, state: Proposal['state'], at: string, by: string, why: string): Proposal {
  if (!canProposalTransition(item.state, state)) {
    return item
  }
  return {
    ...item,
    state,
    history: [...item.history, { state, at, by, why }],
  }
}

function crlfToLf(bytes: Buffer): Buffer {
  const text = bytes.toString('latin1').replace(/\r\n/g, '\n')
  return Buffer.from(text, 'latin1')
}

function lfToCrlf(bytes: Buffer): Buffer {
  const text = bytes.toString('latin1')
  if (text.includes('\r')) {
    return bytes
  }
  return Buffer.from(text.replace(/\n/g, '\r\n'), 'latin1')
}

function allCrlf(bytes: Buffer): boolean {
  const text = bytes.toString('latin1')
  if (!text.includes('\n')) {
    return false
  }
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n' && (i === 0 || text[i - 1] !== '\r')) {
      return false
    }
  }
  return true
}

function blobFor(post: Buffer, kind: 'same' | 'live-crlf' | 'blob-crlf'): Buffer {
  if (kind === 'live-crlf') {
    return crlfToLf(post)
  }
  if (kind === 'blob-crlf') {
    return lfToCrlf(post)
  }
  return post
}

function parseTree(stdout: string): { mode: string; oid: string } | null {
  const text = stdout.replace(/\0/g, '')
  const match = /^(100644|100755|120000|160000|\d+)\s+\w+\s+([0-9a-f]+)\t/u.exec(text)
  if (!match?.[1] || !match[2]) {
    return text.trim().length === 0 ? null : { mode: '0', oid: '' }
  }
  return { mode: match[1], oid: match[2] }
}

export async function applyGitProposal(input: {
  dataDir: string
  projectReal: string
  proposal: Proposal
  git: GitApi
  zero: string
  at: string
  by: string
  hooks?: GitKill
}): Promise<{ ok: true; proposal: Proposal } | { ok: false; error: string; proposal: Proposal }> {
  const current = input.proposal
  const gitMeta = current.git
  if (!gitMeta) {
    return { ok: false, error: 'conflict', proposal: current }
  }
  const indexFile = path.join(proposalDir(input.dataDir, current.id), 'index.tmp')
  const fail = async (error: string, item: Proposal): Promise<{ ok: false; error: string; proposal: Proposal }> => {
    const next = move(item, 'conflict', input.at, input.by, error)
    await writeProposal(input.dataDir, next)
    return { ok: false, error, proposal: next }
  }
  try {
    const head = await input.git.symbolicHead()
    const headRef = head.stdout.trim()
    if (head.code !== 0 || headRef !== gitMeta.head_ref) {
      return fail(head.code !== 0 ? 'detached_head' : 'conflict', current)
    }
    const commit = (await input.git.verifyHead()).stdout.trim()
    if (commit !== gitMeta.head_commit) {
      return fail('conflict', current)
    }
    const expected: Array<{ path: string; mode: string; bytes: Buffer }> = []
    const indexBefore: string[] = []
    for (const file of current.files) {
      const postPath = path.join(proposalDir(input.dataDir, current.id), 'post', file.path)
      const post = await readNoFollow(postPath)
      if (sha256Buffer(post) !== file.post_sha256) {
        return fail('conflict', current)
      }
      const attr = await attributeBlock(input.projectReal, file.path)
      if (attr) {
        return fail('unsupported_filter', current)
      }
      const tree = parseTree((await input.git.lsTree(file.path)).stdout)
      const stage = (await input.git.lsFiles(file.path)).stdout
      indexBefore.push(stage)
      if (file.base_sha256 === null) {
        if (tree || stage.replace(/\0/g, '').trim().length > 0) {
          return fail('conflict', current)
        }
        try {
          await readNoFollow(path.join(input.projectReal, file.path))
          return fail('conflict', current)
        } catch {
          // нового файла на диске нет — так и задумано
        }
        expected.push({ path: file.path, mode: '100644', bytes: post })
        continue
      }
      if (!tree || (tree.mode !== '100644' && tree.mode !== '100755')) {
        return fail('unsupported_entry', current)
      }
      const stageMode = /^(\d+)\s+([0-9a-f]+)\s+/u.exec(stage.replace(/\0/g, ''))
      if (!stageMode || stageMode[1] !== tree.mode || stageMode[2] !== tree.oid) {
        return fail('dirty', current)
      }
      const live = await readNoFollow(path.join(input.projectReal, file.path))
      if (sha256Buffer(live) !== file.base_sha256) {
        return fail('conflict', current)
      }
      const blob = Buffer.from((await input.git.catBlob(tree.oid, DIFF_FILE_MAX + 4096)).stdout, 'utf8')
      let kind: 'same' | 'live-crlf' | 'blob-crlf' = 'same'
      if (!blob.equals(live)) {
        if (allCrlf(live) && crlfToLf(live).equals(blob)) {
          kind = 'live-crlf'
        } else if (allCrlf(blob) && crlfToLf(blob).equals(live)) {
          kind = 'blob-crlf'
        } else {
          return fail('dirty', current)
        }
      }
      expected.push({ path: file.path, mode: tree.mode, bytes: blobFor(post, kind) })
    }
    let applying = move(current, 'applying', input.at, input.by, 'apply')
    await writeProposal(input.dataDir, applying)
    const oids: string[] = []
    for (const file of expected) {
      const hashed = (await input.git.hashObject(file.bytes)).stdout.trim()
      oids.push(hashed)
    }
    await input.git.readTree(indexFile)
    const info = Buffer.concat(expected.map((file, index) => Buffer.from(`${file.mode} ${oids[index]} 0\t${file.path}\0`, 'utf8')))
    await input.git.updateIndex(indexFile, info)
    const tree = (await input.git.writeTree(indexFile)).stdout.trim()
    applying = { ...applying, git: { ...gitMeta, tree, commit: null } }
    await writeProposal(input.dataDir, applying)
    const message = [
      `tinybots: proposal ${current.id} (bot ${current.bot})`,
      '',
      ...current.files.map((file) => file.path),
    ].join('\n')
    if (message.includes(current.summary)) {
      return fail('conflict', applying)
    }
    const made = (await input.git.commitTree(tree, gitMeta.head_commit, message)).stdout.trim()
    applying = { ...applying, git: { ...gitMeta, tree, commit: made } }
    await writeProposal(input.dataDir, applying)
    input.hooks?.afterCommit?.()
    const ref = `refs/heads/tinybots/proposal-${current.id}`
    await input.git.checkRef(ref)
    try {
      await input.git.updateRefCreate(ref, made, input.zero)
    } catch {
      return fail('branch_exists', applying)
    }
    input.hooks?.afterRef?.()
    for (let index = 0; index < expected.length; index += 1) {
      const file = expected[index]
      if (!file) {
        return fail('conflict', applying)
      }
      const seen = Buffer.from((await input.git.catBlob(`${made}:${file.path}`, DIFF_FILE_MAX + 4096)).stdout, 'utf8')
      if (!seen.equals(file.bytes)) {
        await input.git.updateRefDelete(ref, made).catch(() => undefined)
        return fail('conflict', applying)
      }
      const live = file.bytes
      void live
      const fileMeta = current.files[index]
      if (fileMeta?.base_sha256) {
        const disk = await readNoFollow(path.join(input.projectReal, file.path))
        if (sha256Buffer(disk) !== fileMeta.base_sha256) {
          await input.git.updateRefDelete(ref, made).catch(() => undefined)
          return fail('conflict', applying)
        }
      }
      const stageNow = (await input.git.lsFiles(file.path)).stdout
      if (stageNow !== indexBefore[index]) {
        await input.git.updateRefDelete(ref, made).catch(() => undefined)
        return fail('conflict', applying)
      }
    }
    const headAgain = (await input.git.symbolicHead()).stdout.trim()
    const commitAgain = (await input.git.verifyHead()).stdout.trim()
    if (headAgain !== gitMeta.head_ref || commitAgain !== gitMeta.head_commit) {
      await input.git.updateRefDelete(ref, made).catch(() => undefined)
      return fail('conflict', applying)
    }
    const applied = move(applying, 'applied', input.at, input.by, 'apply')
    await writeProposal(input.dataDir, applied)
    return { ok: true, proposal: applied }
  } finally {
    await rm(indexFile, { force: true })
    await rm(`${indexFile}.lock`, { force: true })
  }
}

export async function revertGitProposal(input: {
  dataDir: string
  proposal: Proposal
  git: GitApi
  at: string
  by: string
}): Promise<{ ok: true; proposal: Proposal } | { ok: false; error: string; proposal: Proposal }> {
  const current = input.proposal
  const meta = current.git
  if (!meta?.commit || current.state !== 'applied') {
    return { ok: false, error: 'invalid_state', proposal: current }
  }
  const ref = `refs/heads/${meta.branch.replace(/^refs\/heads\//, '')}`
  const branchRef = meta.branch.startsWith('refs/') ? meta.branch : `refs/heads/${meta.branch}`
  const head = await input.git.symbolicHead()
  if (head.stdout.trim() === branchRef) {
    const stayed = move(current, 'revert_conflict', input.at, input.by, 'revert_conflict')
    await writeProposal(input.dataDir, stayed)
    return { ok: false, error: 'revert_conflict', proposal: stayed }
  }
  const pointed = await input.git.verifyRef(branchRef)
  if (pointed.code !== 0 || pointed.stdout.trim() !== meta.commit) {
    const stayed = move(current, 'revert_conflict', input.at, input.by, 'revert_conflict')
    await writeProposal(input.dataDir, stayed)
    return { ok: false, error: 'revert_conflict', proposal: stayed }
  }
  const contained = (await input.git.forEachContains(meta.commit)).stdout
  const others = contained.split('\n').map((line) => line.trim()).filter((line) => line.length > 0 && !line.endsWith(branchRef) && !line.includes(` ${branchRef}`))
  if (others.some((line) => line.includes('refs/heads/') && !line.includes(branchRef))) {
    const stayed = move(current, 'revert_conflict', input.at, input.by, 'revert_conflict')
    await writeProposal(input.dataDir, stayed)
    return { ok: false, error: 'revert_conflict', proposal: stayed }
  }
  let reverting = move(current, 'reverting', input.at, input.by, 'revert')
  await writeProposal(input.dataDir, reverting)
  await input.git.updateRefDelete(branchRef, meta.commit)
  reverting = move(reverting, 'reverted', input.at, input.by, 'revert')
  await writeProposal(input.dataDir, reverting)
  void ref
  return { ok: true, proposal: reverting }
}
