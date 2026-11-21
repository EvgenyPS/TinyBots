/**
 * FILE: apps/server/src/tools/git.ts
 * НАЗНАЧЕНИЕ: единственный вызов git. Только plumbing из белого списка, без checkout и сети.
 * ВХОД: абсолютный путь к git, realpath корня, каталог лаунчера как cwd.
 * ВЫХОД: stdout или отказ до запуска процесса. Чужой -c и запретный флаг до execFile не доходят.
 * Окружение собирается с нуля. GIT_* родителя не наследуются. safe.directory не передаётся.
 * core.hooksPath смотрит в пустой каталог data_dir, поэтому хуки репозитория не стартуют.
 */

import { execFile as execFileCb, type ExecFileException } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat, mkdir, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { logSafe } from '../redact.js'
import { GIT_MAX_BUFFER, GIT_MIN, GIT_TIMEOUT_MS } from './limits.js'

type ExecResult = { stdout: Buffer; stderr: Buffer }

function execFileBuffer(
  file: string,
  args: readonly string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    timeout: number
    maxBuffer: number
    windowsHide: boolean
    shell: false
  },
  input?: Buffer,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = execFileCb(file, [...args], { ...options, encoding: 'buffer' }, (error, stdout, stderr) => {
      const out = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? ''), 'utf8')
      const err = Buffer.isBuffer(stderr) ? stderr : Buffer.from(String(stderr ?? ''), 'utf8')
      if (error) {
        const wrapped = error as ExecFileException & { stdout?: Buffer; stderr?: Buffer }
        Object.assign(wrapped, { stdout: out, stderr: err })
        reject(wrapped)
        return
      }
      resolve({ stdout: out, stderr: err })
    })
    child.stdin?.on('error', () => undefined)
    if (input) {
      child.stdin?.end(input)
    } else {
      child.stdin?.end()
    }
  })
}

const ALLOWED = new Set([
  'rev-parse',
  'symbolic-ref',
  'cat-file',
  'ls-tree',
  'ls-files',
  'hash-object',
  'read-tree',
  'update-index',
  'write-tree',
  'commit-tree',
  'update-ref',
  'for-each-ref',
  'check-ref-format',
])

/** Флаги, которые запускают фильтры, обход или сеть. Снятие любого краснеет юнит. */
export const FORBIDDEN_GIT_FLAGS = [
  '--filters',
  '--textconv',
  '--refresh',
  '--really-refresh',
  '--others',
  '--modified',
  '--exec',
  '--upload-pack',
  '--git-dir',
  '--work-tree',
] as const

export const GIT_CONFIG_KEYS = [
  'core.hooksPath',
  'core.fsmonitor',
  'core.untrackedCache',
  'commit.gpgSign',
  'protocol.allow',
  'credential.helper',
  'core.askPass',
  'core.sshCommand',
  'core.splitIndex',
  'index.sparse',
  'core.longpaths',
  'gc.auto',
  'maintenance.auto',
] as const

export type GitExec = (
  file: string,
  args: readonly string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    timeout: number
    maxBuffer: number
    windowsHide: boolean
    shell: false
  },
  input?: Buffer,
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>

export type GitHooks = {
  execFile?: GitExec
  /** Только тест: подложить HOME, не боевой путь. */
  testEnv?: NodeJS.ProcessEnv
  traceFile?: string
}

export type GitContext = {
  bin: string
  cwd: string
  rootReal: string
  dataDir: string
  hooks?: GitHooks
}

let cached: { bin: string; version: string } | { missing: string } | null = null

export function resetGitCache(): void {
  cached = null
}

export function gitVersionOk(text: string): boolean {
  const match = /git version (\d+)\.(\d+)\.(\d+)/.exec(text)
  if (!match) {
    return false
  }
  const got = [Number(match[1]), Number(match[2]), Number(match[3])]
  for (let i = 0; i < 3; i += 1) {
    const value = got[i] ?? 0
    const need = GIT_MIN[i] ?? 0
    if (value > need) {
      return true
    }
    if (value < need) {
      return false
    }
  }
  return true
}

/** Боевое окружение. HOME, USERPROFILE и XDG_CONFIG_HOME сюда не входят. */
export function buildGitEnv(input: {
  gitDir?: string
  workTree?: string
  indexFile?: string
  ceiling?: string
  author?: boolean
  testEnv?: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_ALLOW_PROTOCOL: 'none',
    GIT_NO_LAZY_FETCH: '1',
    GIT_PROTOCOL_FROM_USER: '0',
  }
  if (process.platform === 'win32') {
    if (process.env.SYSTEMROOT) {
      env.SYSTEMROOT = process.env.SYSTEMROOT
    }
    env.NoDefaultCurrentDirectoryInExePath = '1'
  }
  if (input.ceiling) {
    env.GIT_CEILING_DIRECTORIES = input.ceiling
  }
  if (input.gitDir) {
    env.GIT_DIR = input.gitDir
  }
  if (input.workTree) {
    env.GIT_WORK_TREE = input.workTree
  }
  if (input.indexFile) {
    if (!path.isAbsolute(input.indexFile)) {
      throw new Error('git: индекс не абсолютный')
    }
    env.GIT_INDEX_FILE = input.indexFile
  }
  if (input.author) {
    env.GIT_AUTHOR_NAME = 'TinyBots'
    env.GIT_AUTHOR_EMAIL = 'bot@localhost'
    env.GIT_COMMITTER_NAME = 'TinyBots'
    env.GIT_COMMITTER_EMAIL = 'bot@localhost'
  }
  if (input.testEnv) {
    for (const [key, value] of Object.entries(input.testEnv)) {
      if (key === 'HOME' || key === 'USERPROFILE' || key === 'XDG_CONFIG_HOME') {
        env[key] = value
      }
    }
  }
  return env
}

export function gitPrefix(rootReal: string, hooksPath: string): string[] {
  return [
    '--no-pager',
    '-c', `core.hooksPath=${hooksPath}`,
    '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false',
    '-c', 'commit.gpgSign=false',
    '-c', 'protocol.allow=never',
    '-c', 'credential.helper=',
    '-c', 'core.askPass=',
    '-c', 'core.sshCommand=false',
    '-c', 'core.splitIndex=false',
    '-c', 'index.sparse=false',
    '-c', 'core.longpaths=true',
    '-c', 'gc.auto=0',
    '-c', 'maintenance.auto=false',
    '-C', rootReal,
  ]
}

/** Отказ до процесса. Префикс -c сюда не приходит: его добавляет обёртка сама. */
export function assertGitInvocation(command: string, args: readonly string[]): void {
  if (!ALLOWED.has(command)) {
    throw new Error('git: команда вне списка')
  }
  for (const arg of args) {
    if (arg === '-c' || arg.startsWith('--git-dir') || arg.startsWith('--work-tree')) {
      throw new Error('git: флаг вне шаблона')
    }
    for (const flag of FORBIDDEN_GIT_FLAGS) {
      if (arg === flag || arg.startsWith(`${flag}=`)) {
        throw new Error('git: флаг вне шаблона')
      }
    }
    if (arg.includes('safe.directory')) {
      throw new Error('git: флаг вне шаблона')
    }
  }
}

async function hooksPath(dataDir: string): Promise<string> {
  const dir = path.join(dataDir, 'git-hooks')
  await mkdir(dir, { recursive: true })
  return dir
}

type RunOpt = {
  gitDir?: boolean
  indexFile?: string
  ceiling?: string
  author?: boolean
  maxBuffer?: number
  input?: Buffer | string
  allowExit1?: boolean
}

export async function runGit(
  ctx: GitContext,
  command: string,
  args: readonly string[],
  opt: RunOpt = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  assertGitInvocation(command, args)
  const hooks = await hooksPath(ctx.dataDir)
  const prefix = gitPrefix(ctx.rootReal, hooks)
  const gitDir = path.join(ctx.rootReal, '.git')
  const env = buildGitEnv({
    gitDir: opt.gitDir === false ? undefined : gitDir,
    workTree: opt.gitDir === false ? undefined : ctx.rootReal,
    indexFile: opt.indexFile,
    ceiling: opt.ceiling,
    author: opt.author,
    testEnv: ctx.hooks?.testEnv,
  })
  const full = [...prefix, command, ...args]
  const exec = ctx.hooks?.execFile ?? ((file, argv, options, input) => execFileBuffer(file, argv, options, input))
  const options = {
    cwd: ctx.cwd,
    env,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: opt.maxBuffer ?? GIT_MAX_BUFFER,
    windowsHide: true,
    shell: false as const,
  }
  if (ctx.hooks?.traceFile) {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(ctx.hooks.traceFile, `${JSON.stringify({
      bin: ctx.bin,
      args: full,
      cwd: ctx.cwd,
      shell: false,
      timeout: options.timeout,
      env: {
        GIT_TERMINAL_PROMPT: env.GIT_TERMINAL_PROMPT,
        GIT_CONFIG_NOSYSTEM: env.GIT_CONFIG_NOSYSTEM,
        GIT_ALLOW_PROTOCOL: env.GIT_ALLOW_PROTOCOL,
        GIT_NO_LAZY_FETCH: env.GIT_NO_LAZY_FETCH,
        GIT_LITERAL_PATHSPECS: env.GIT_LITERAL_PATHSPECS,
        hasHome: env.HOME !== undefined,
      },
    })}\n`)
  }
  try {
    const result = await exec(ctx.bin, full, options, Buffer.isBuffer(opt.input) ? opt.input : undefined)
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : String(result.stdout ?? '')
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr ?? '')
    logSafe(`git: ${command} exit 0`)
    return { stdout, stderr, code: 0 }
  } catch (error) {
    const err = error as { code?: unknown; stdout?: unknown; stderr?: unknown; killed?: boolean }
    const code = typeof err.code === 'number' ? err.code : 1
    logSafe(`git: ${command} exit ${code}`)
    if (opt.allowExit1 && code === 1) {
      const stdout = Buffer.isBuffer(err.stdout) ? err.stdout.toString('utf8') : String(err.stdout ?? '')
      const stderr = Buffer.isBuffer(err.stderr) ? err.stderr.toString('utf8') : String(err.stderr ?? '')
      return { stdout, stderr, code }
    }
    const stderr = Buffer.isBuffer(err.stderr) ? err.stderr.toString('utf8') : String(err.stderr ?? '')
    if (/dubious ownership/i.test(stderr)) {
      throw new Error('репозиторий принадлежит другому пользователю')
    }
    throw new Error('git: вызов не удался')
  }
}

function looksLikeGit(file: string): boolean {
  const base = path.basename(file).toLowerCase()
  return base === 'git' || base === 'git.exe'
}

/** Абсолютные элементы PATH, без точки и пустых. Файл не внутри проекта и не в data_dir. */
export async function findGitBinary(input: {
  pathEnv: string | undefined
  projectReals: readonly string[]
  dataReal: string | null
  execFile?: GitExec
}): Promise<{ ok: true; bin: string; version: string } | { ok: false; reason: string }> {
  const parts = (input.pathEnv ?? '').split(path.delimiter)
  for (const dir of parts) {
    if (dir.length === 0 || !path.isAbsolute(dir)) {
      continue
    }
    const candidate = path.join(dir, process.platform === 'win32' ? 'git.exe' : 'git')
    try {
      await access(candidate, constants.X_OK)
    } catch {
      continue
    }
    let real: string
    try {
      real = await (await import('node:fs/promises')).realpath(candidate)
    } catch {
      continue
    }
    const blocked = [input.dataReal, ...input.projectReals].filter((item): item is string => Boolean(item))
    if (blocked.some((root) => {
      const rel = path.relative(root, real)
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    })) {
      continue
    }
    if (!looksLikeGit(real)) {
      continue
    }
    const version = await readGitVersion(real, input.execFile)
    if (!version.ok) {
      return { ok: false, reason: 'git не найден или старше 2.45.1: предложения для git-проекта недоступны' }
    }
    return { ok: true, bin: real, version: version.text }
  }
  return { ok: false, reason: 'git не найден или старше 2.45.1: предложения для git-проекта недоступны' }
}

async function readGitVersion(bin: string, execFile?: GitExec): Promise<{ ok: true; text: string } | { ok: false }> {
  const env = buildGitEnv({})
  const exec = execFile ?? ((file, args, options) => execFileBuffer(file, args, options))
  try {
    const result = await exec(bin, ['--version'], {
      cwd: path.parse(bin).root,
      env,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
      shell: false,
    })
    const text = Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : String(result.stdout ?? '')
    if (!gitVersionOk(text)) {
      return { ok: false }
    }
    logSafe('git: version exit 0')
    return { ok: true, text: text.trim() }
  } catch {
    logSafe('git: version exit 1')
    return { ok: false }
  }
}

export async function ensureGit(input: {
  pathEnv?: string
  projectReals: readonly string[]
  dataReal: string | null
  execFile?: GitExec
}): Promise<{ ok: true; bin: string; version: string } | { ok: false; reason: string }> {
  if (cached && 'bin' in cached && !input.execFile) {
    return { ok: true, bin: cached.bin, version: cached.version }
  }
  if (cached && 'missing' in cached && !input.execFile) {
    return { ok: false, reason: cached.missing }
  }
  const found = await findGitBinary({
    pathEnv: input.pathEnv ?? process.env.PATH,
    projectReals: input.projectReals,
    dataReal: input.dataReal,
    execFile: input.execFile,
  })
  if (!input.execFile) {
    cached = found.ok ? { bin: found.bin, version: found.version } : { missing: found.reason }
  }
  return found
}

export function makeGit(ctx: Omit<GitContext, 'bin'> & { bin: string }): GitApi {
  return new GitApi(ctx)
}

export class GitApi {
  constructor(private readonly ctx: GitContext) {}

  /** Определение режима: без GIT_DIR, с потолком на родителя корня. */
  probe(): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'rev-parse', [
      '--show-toplevel',
      '--absolute-git-dir',
      '--git-common-dir',
      '--is-bare-repository',
      '--show-object-format',
    ], {
      gitDir: false,
      ceiling: path.dirname(this.ctx.rootReal),
    })
  }

  symbolicHead(): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'symbolic-ref', ['-q', 'HEAD'], { allowExit1: true })
  }

  verifyHead(): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'rev-parse', ['--verify', 'HEAD^{commit}'])
  }

  verifyRef(ref: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'rev-parse', ['--verify', `${ref}^{commit}`], { allowExit1: true })
  }

  catBlob(spec: string, maxBuffer: number): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'cat-file', ['blob', spec], { maxBuffer })
  }

  lsTree(file: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'ls-tree', ['-z', 'HEAD', '--', file])
  }

  lsFiles(file: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'ls-files', ['-s', '-z', '--', file])
  }

  hashObject(bytes: Buffer): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'hash-object', ['-w', '--no-filters', '--stdin'], { input: bytes })
  }

  readTree(indexFile: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'read-tree', ['HEAD'], { indexFile })
  }

  updateIndex(indexFile: string, info: Buffer): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'update-index', ['--add', '-z', '--index-info'], { indexFile, input: info })
  }

  writeTree(indexFile: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'write-tree', [], { indexFile })
  }

  commitTree(tree: string, parent: string, message: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'commit-tree', ['--no-gpg-sign', tree, '-p', parent, '-m', message], { author: true })
  }

  updateRefCreate(ref: string, commit: string, zero: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'update-ref', [ref, commit, zero])
  }

  updateRefDelete(ref: string, old: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'update-ref', ['-d', ref, old])
  }

  forEachContains(commit: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'for-each-ref', ['--contains', commit, 'refs/heads/'])
  }

  forEachPrefix(prefix: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'for-each-ref', [prefix])
  }

  checkRef(ref: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return runGit(this.ctx, 'check-ref-format', [ref])
  }
}

export const GIT_MISSING = 'git не найден или старше 2.45.1: предложения для git-проекта недоступны'
export const GIT_OWNER = 'репозиторий принадлежит другому пользователю'
export const GIT_PARTIAL = 'частичный клон не поддерживается'
export const GIT_NESTED = 'вложенный репозиторий не поддерживается'

function iniHas(text: string, sectionTest: (section: string) => boolean, key: string, valueTest: (value: string) => boolean): boolean {
  let section = ''
  let active = false
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line.startsWith('#') || line.startsWith(';') || line.length === 0) {
      continue
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).trim().toLowerCase()
      active = sectionTest(section)
      continue
    }
    if (!active || line.startsWith('[')) {
      continue
    }
    const eq = line.indexOf('=')
    if (eq === -1) {
      continue
    }
    const name = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).trim().toLowerCase()
    if (name === key && valueTest(value)) {
      return true
    }
  }
  return false
}

/** Сервер читает .git/config сам и include.path не разворачивает. */
export function configBlocksGit(text: string): 'partial' | 'root' | null {
  if (iniHas(text, (section) => section === 'extensions', 'partialclone', (value) => value.length > 0)) {
    return 'partial'
  }
  if (iniHas(text, (section) => section.startsWith('remote '), 'promisor', (value) => value === 'true')) {
    return 'partial'
  }
  if (iniHas(text, (section) => section === 'core', 'bare', (value) => value === 'true')) {
    return 'root'
  }
  if (iniHas(text, (section) => section === 'core', 'worktree', (value) => value.length > 0)) {
    return 'root'
  }
  return null
}

export async function packHasPromisor(gitDir: string): Promise<boolean> {
  const pack = path.join(gitDir, 'objects', 'pack')
  let names: string[]
  try {
    names = await readdir(pack)
  } catch {
    return false
  }
  return names.some((name) => name.toLowerCase().endsWith('.promisor'))
}

export type RepoInspect =
  | {
    ok: true
    format: 'sha1' | 'sha256'
    headRef: string
    headCommit: string
    zero: string
  }
  | { ok: false; reason: string; code: 'missing' | 'owner' | 'partial' | 'nested' | 'root' | 'git' }

/** Режим git: каталог .git, не файл и не симлинк, toplevel совпадает с корнем. */
export async function inspectGitRepo(ctx: GitContext): Promise<RepoInspect> {
  const gitDir = path.join(ctx.rootReal, '.git')
  let st: Awaited<ReturnType<typeof lstat>>
  try {
    st = await lstat(gitDir)
  } catch {
    return { ok: false, reason: 'нет git', code: 'missing' }
  }
  if (st.isSymbolicLink() || !st.isDirectory()) {
    return { ok: false, reason: GIT_NESTED, code: 'nested' }
  }
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    return { ok: false, reason: GIT_OWNER, code: 'owner' }
  }
  for (const name of ['objects', 'refs', 'HEAD']) {
    try {
      const item = await lstat(path.join(gitDir, name))
      if (item.isSymbolicLink()) {
        return { ok: false, reason: GIT_NESTED, code: 'root' }
      }
    } catch {
      return { ok: false, reason: GIT_NESTED, code: 'root' }
    }
  }
  let configText = ''
  try {
    configText = await readFile(path.join(gitDir, 'config'), 'utf8')
  } catch {
    configText = ''
  }
  const blocked = configBlocksGit(configText)
  if (blocked === 'partial' || await packHasPromisor(gitDir)) {
    return { ok: false, reason: GIT_PARTIAL, code: 'partial' }
  }
  if (blocked === 'root') {
    return { ok: false, reason: GIT_NESTED, code: 'root' }
  }
  let probed: { stdout: string; stderr: string }
  try {
    probed = await runGit(ctx, 'rev-parse', [
      '--show-toplevel',
      '--absolute-git-dir',
      '--git-common-dir',
      '--is-bare-repository',
      '--show-object-format',
    ], { gitDir: false, ceiling: path.dirname(ctx.rootReal) })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === GIT_OWNER) {
      return { ok: false, reason: GIT_OWNER, code: 'owner' }
    }
    return { ok: false, reason: GIT_MISSING, code: 'git' }
  }
  const lines = probed.stdout.split(/\n/u).map((line) => line.trim()).filter((line) => line.length > 0)
  if (lines.length < 5) {
    return { ok: false, reason: GIT_NESTED, code: 'root' }
  }
  const [top, git, common, bare, format] = lines
  const topReal = await realpathSafe(path.isAbsolute(top ?? '') ? (top ?? '') : path.resolve(ctx.rootReal, top ?? ''))
  const gitReal = await realpathSafe(path.isAbsolute(git ?? '') ? (git ?? '') : path.resolve(ctx.rootReal, git ?? ''))
  const commonReal = await realpathSafe(path.isAbsolute(common ?? '') ? (common ?? '') : path.resolve(ctx.rootReal, common ?? ''))
  const expectedGit = await realpathSafe(gitDir)
  if (topReal !== ctx.rootReal || gitReal !== expectedGit || commonReal !== expectedGit || bare !== 'false') {
    return { ok: false, reason: GIT_NESTED, code: 'root' }
  }
  if (format !== 'sha1' && format !== 'sha256') {
    return { ok: false, reason: GIT_NESTED, code: 'root' }
  }
  let head
  try {
    head = await runGit(ctx, 'symbolic-ref', ['-q', 'HEAD'], { allowExit1: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === GIT_OWNER) {
      return { ok: false, reason: GIT_OWNER, code: 'owner' }
    }
    return { ok: false, reason: GIT_MISSING, code: 'git' }
  }
  const headRef = head.stdout.trim()
  if (head.code !== 0 || !headRef.startsWith('refs/heads/')) {
    return { ok: false, reason: 'HEAD не на ветке', code: 'root' }
  }
  let commit
  try {
    commit = await runGit(ctx, 'rev-parse', ['--verify', 'HEAD^{commit}'])
  } catch {
    return { ok: false, reason: 'HEAD не на ветке', code: 'root' }
  }
  const headCommit = commit.stdout.trim()
  return {
    ok: true,
    format,
    headRef,
    headCommit,
    zero: '0'.repeat(format === 'sha256' ? 64 : 40),
  }
}

async function realpathSafe(value: string): Promise<string> {
  try {
    return await (await import('node:fs/promises')).realpath(value)
  } catch {
    return path.resolve(value)
  }
}
