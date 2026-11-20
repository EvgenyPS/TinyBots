/**
 * FILE: apps/server/src/git/github.ts
 * НАЗНАЧЕНИЕ: прочитать коммиты, diffstat, PR и CI через GitHub API.
 * ВХОД: токен только для чтения, owner/name и fetch (в тестах — мок).
 * ВЫХОД: агрегаты без токена. Токен с записью или неподтверждённые права — вкладка не стартует.
 * Octokit не берём: хватает fetch, мок подменяется в тесте, в бандл фронта клиент не попадает.
 */

import { logSafe, rememberSecret } from '../redact.js'

const READ_SCOPE = /^(repo:status|read:[a-z0-9_]+)$/
const WRITE_SCOPE = /^(repo|public_repo|workflow|gist|delete_repo|project|codespace|user)$/

export type GitCommit = { sha: string; message: string; author: string; at: string }
export type GitRow = { path: string; additions: number; deletions: number }
export type GitPull = { number: number; title: string; state: string; url: string }
export type GitCheck = { name: string; state: string }

export type GitSummary = {
  ok: true
  started: boolean
  hidden: boolean
  warning: string | null
  repo: string | null
  commits: GitCommit[]
  diffstat: { files: number; additions: number; deletions: number; rows: GitRow[] }
  pulls: GitPull[]
  ci: GitCheck[]
}

export const WRITE_WARNING = 'Токен GitHub с правами записи. Вкладка Git не стартует.'
export const MISSING_WARNING = 'Токена GitHub нет. Вкладка Git не стартует.'
export const UNKNOWN_WARNING = 'Не удалось подтвердить, что токен GitHub только для чтения. Вкладка Git не стартует.'
export const DOWN_WARNING = 'GitHub не ответил. Вкладка Git не стартует.'

function emptyDiff(): GitSummary['diffstat'] {
  return { files: 0, additions: 0, deletions: 0, rows: [] }
}

export function emptyGit(warning: string | null, repo: string | null = null): GitSummary {
  return {
    ok: true,
    started: false,
    hidden: false,
    warning,
    repo,
    commits: [],
    diffstat: emptyDiff(),
    pulls: [],
    ci: [],
  }
}

type FetchLike = typeof fetch

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function scopeIsWrite(scope: string): boolean {
  const name = scope.trim().toLowerCase()
  if (name.length === 0) {
    return false
  }
  if (name.startsWith('write:') || name.startsWith('admin:') || name.startsWith('delete:')) {
    return true
  }
  return WRITE_SCOPE.test(name)
}

function scopeIsRead(scope: string): boolean {
  return READ_SCOPE.test(scope.trim().toLowerCase())
}

function permissionsWrite(body: unknown): boolean | null {
  const record = asRecord(body)
  const permissions = record ? asRecord(record.permissions) : null
  if (!permissions) {
    return null
  }
  const values = Object.values(permissions)
  if (values.length === 0) {
    return null
  }
  let sawRead = false
  for (const value of values) {
    if (value === 'write' || value === 'admin') {
      return true
    }
    if (value === 'read') {
      sawRead = true
    }
  }
  return sawRead ? false : null
}

/**
 * Классический токен: заголовок X-OAuth-Scopes.
 * Пустой заголовок — токен без scope, публичное чтение.
 * Нет заголовка — права неизвестны, пока тело не скажет permissions из одних read.
 */
export function judgeScopes(header: string | null, body: unknown): 'read' | 'write' | 'unknown' {
  if (header !== null) {
    const scopes = header.split(',').map((item) => item.trim()).filter((item) => item.length > 0)
    if (scopes.some(scopeIsWrite)) {
      return 'write'
    }
    if (scopes.length === 0 || scopes.every(scopeIsRead)) {
      return 'read'
    }
    return 'unknown'
  }
  const permissions = permissionsWrite(body)
  if (permissions === true) {
    return 'write'
  }
  if (permissions === false) {
    return 'read'
  }
  return 'unknown'
}

function firstLine(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.split(/\r?\n/)[0]?.trim().slice(0, 200) ?? ''
}

function textField(value: unknown, max = 200): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim().slice(0, max)
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (text.trim().length === 0) {
    return null
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function githubGet(fetchImpl: FetchLike, url: string, token: string): Promise<{ status: number; header: string | null; body: unknown }> {
  const res = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'tinybots',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(4000),
  })
  const body = await readJson(res)
  return { status: res.status, header: res.headers.get('x-oauth-scopes'), body }
}

function parseCommits(body: unknown): GitCommit[] {
  if (!Array.isArray(body)) {
    return []
  }
  const commits: GitCommit[] = []
  for (const item of body) {
    const row = asRecord(item)
    const commit = row ? asRecord(row.commit) : null
    const author = commit ? asRecord(commit.author) : null
    const sha = textField(row?.sha, 64)
    const message = firstLine(commit?.message)
    if (sha.length < 7 || message.length === 0) {
      continue
    }
    commits.push({
      sha,
      message,
      author: textField(author?.name, 80) || 'неизвестно',
      at: textField(author?.date, 40),
    })
    if (commits.length >= 8) {
      break
    }
  }
  return commits
}

function parseDiff(body: unknown): GitSummary['diffstat'] {
  const row = asRecord(body)
  const stats = row ? asRecord(row.stats) : null
  const files = Array.isArray(row?.files) ? row.files : []
  const rows: GitRow[] = []
  for (const item of files) {
    const file = asRecord(item)
    const filePath = textField(file?.filename, 200)
    if (filePath.length === 0) {
      continue
    }
    rows.push({
      path: filePath,
      additions: numberField(file?.additions),
      deletions: numberField(file?.deletions),
    })
    if (rows.length >= 20) {
      break
    }
  }
  return {
    files: rows.length,
    additions: numberField(stats?.additions),
    deletions: numberField(stats?.deletions),
    rows,
  }
}

function parsePulls(body: unknown): GitPull[] {
  if (!Array.isArray(body)) {
    return []
  }
  const pulls: GitPull[] = []
  for (const item of body) {
    const row = asRecord(item)
    const number = numberField(row?.number)
    const title = textField(row?.title)
    if (number <= 0 || title.length === 0) {
      continue
    }
    pulls.push({
      number,
      title,
      state: textField(row?.state, 40) || 'open',
      url: textField(row?.html_url, 300),
    })
    if (pulls.length >= 8) {
      break
    }
  }
  return pulls
}

function parseChecks(body: unknown): GitCheck[] {
  const row = asRecord(body)
  const statuses = row && Array.isArray(row.statuses) ? row.statuses : []
  const checks: GitCheck[] = []
  for (const item of statuses) {
    const status = asRecord(item)
    const name = textField(status?.context, 80)
    if (name.length === 0) {
      continue
    }
    checks.push({ name, state: textField(status?.state, 40) || 'pending' })
    if (checks.length >= 12) {
      break
    }
  }
  return checks
}

function seal(summary: GitSummary, token: string): GitSummary {
  if (token.length >= 8 && JSON.stringify(summary).includes(token)) {
    logSafe('git: ответ содержал секрет и был скрыт')
    return emptyGit(UNKNOWN_WARNING, summary.repo)
  }
  return summary
}

export async function loadGitSummary(input: {
  token: string
  repo: string
  apiBase: string
  fetchImpl?: FetchLike
}): Promise<GitSummary> {
  const token = input.token.trim()
  rememberSecret(token)
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repo)) {
    return emptyGit(null, null)
  }
  if (token.length === 0) {
    return emptyGit(MISSING_WARNING, input.repo)
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const base = input.apiBase.replace(/\/+$/, '')
  const root = `${base}/repos/${input.repo}`
  try {
    const probe = await githubGet(fetchImpl, `${base}/user`, token)
    if (probe.status < 200 || probe.status >= 300) {
      logSafe(`git: проверка прав не прошла, статус ${probe.status}`)
      return emptyGit(DOWN_WARNING, input.repo)
    }
    const rights = judgeScopes(probe.header, probe.body)
    if (rights === 'write') {
      logSafe('git: токен с правами записи, вкладка не стартует')
      return emptyGit(WRITE_WARNING, input.repo)
    }
    if (rights !== 'read') {
      logSafe('git: права токена не подтверждены, вкладка не стартует')
      return emptyGit(UNKNOWN_WARNING, input.repo)
    }
    const commitsRes = await githubGet(fetchImpl, `${root}/commits?per_page=8`, token)
    const commits = parseCommits(commitsRes.body)
    const head = commits[0]?.sha
    let diffstat = emptyDiff()
    let ci: GitCheck[] = []
    if (head && /^[0-9a-f]{7,64}$/i.test(head)) {
      const detail = await githubGet(fetchImpl, `${root}/commits/${head}`, token)
      diffstat = parseDiff(detail.body)
      const status = await githubGet(fetchImpl, `${root}/commits/${head}/status`, token)
      ci = parseChecks(status.body)
    }
    const pullsRes = await githubGet(fetchImpl, `${root}/pulls?state=open&per_page=8`, token)
    logSafe('git: чтение репозитория завершено')
    return seal({
      ok: true,
      started: true,
      hidden: false,
      warning: null,
      repo: input.repo,
      commits,
      diffstat,
      pulls: parsePulls(pullsRes.body),
      ci,
    }, token)
  } catch (error) {
    logSafe(`git: ${error instanceof Error ? error.message : 'сбой'}`)
    return emptyGit(DOWN_WARNING, input.repo)
  }
}
