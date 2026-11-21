/**
 * FILE: apps/server/src/tools/sandbox.test.ts
 * НАЗНАЧЕНИЕ: I3, I4 и I6. Таблица атак на песочницу и список имён.
 * ВХОД: временный каталог. Цель вне корня лежит рядом и не должна попасть в ответ.
 * ВЫХОД: каждый отказ — ok: false, байты цели не возвращаются.
 */

import { execFileSync } from 'node:child_process'
import { link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { compileGitignore } from './gitignore.js'
import { pathShapeReason, readSandboxedFile, resolveToolPath, type SandboxContext } from './sandbox.js'
import { runTool, type ToolRunContext } from './call.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function layout(): Promise<{ root: string; outside: string; ctx: SandboxContext }> {
  const root = await mkdtemp(path.join(tmpdir(), 'tinybots-sb-'))
  roots.push(root)
  const outside = path.join(root, '..', `outside-${path.basename(root)}`)
  await mkdir(outside, { recursive: true })
  roots.push(outside)
  await writeFile(path.join(outside, 'secret.txt'), 'CANARY-OUTSIDE')
  await writeFile(path.join(root, 'note.txt'), 'hello\n')
  await mkdir(path.join(root, 'sub'), { recursive: true })
  await writeFile(path.join(root, 'sub', 'inner.txt'), 'inner\n')
  const ctx: SandboxContext = {
    rootReal: root,
    dataReal: path.join(root, 'data-box'),
    launcherConfigReal: null,
    respectGitignore: true,
    gitignore: [],
  }
  await mkdir(ctx.dataReal!, { recursive: true })
  await writeFile(path.join(ctx.dataReal!, 'state.json'), 'secret-data')
  return { root, outside, ctx }
}

const ATTACKS = [
  '../x',
  'a/../../x',
  '/etc/passwd',
  'C:\\x',
  'C:x',
  '\\\\srv\\share\\x',
  '//srv/share/x',
  '\\\\?\\C:\\x',
  '\\\\.\\COM1',
  'file.txt:stream',
  'NUL',
  'CON.txt',
  'CONIN$',
  'COM\u00b9.txt',
  'lpt0',
  'notes.txt.',
  'key.pem ',
  ' .env',
  './x',
  'x//y',
  '%2e%2e/x',
]

test('I3 строковые атаки отвергаются до чтения', () => {
  for (const rel of ATTACKS) {
    expect(pathShapeReason(rel, 'linux'), rel).not.toBeNull()
  }
  expect(pathShapeReason('', 'linux')).toBeNull()
  expect(pathShapeReason('.', 'linux')).toBeNull()
  expect(pathShapeReason('ENV~1', 'win32')).not.toBeNull()
  expect(pathShapeReason('GIT~1', 'win32')).not.toBeNull()
  expect(pathShapeReason('note.txt', 'win32')).toBeNull()
  // Короткое имя 8.3 — правило Windows. На linux та же строка обычное имя файла.
  expect(pathShapeReason('ENV~1', 'linux')).toBeNull()
  expect(pathShapeReason('GIT~1', 'linux')).toBeNull()
})

test('I3 корень и точка читают каталог, выход наружу нет', async () => {
  const { ctx, outside } = await layout()
  const root = await resolveToolPath(ctx, '', 'dir')
  const dot = await resolveToolPath(ctx, '.', 'dir')
  expect(root.ok && root.kind).toBe('dir')
  expect(dot.ok && dot.abs).toBe(ctx.rootReal)
  for (const rel of ['../x', 'a/../../x', '/etc/passwd', './x', 'x//y', '%2e%2e/x']) {
    const got = await resolveToolPath(ctx, rel, 'file')
    expect(got.ok, rel).toBe(false)
  }
  const leaked = await readFile(path.join(outside, 'secret.txt'), 'utf8')
  expect(leaked).toBe('CANARY-OUTSIDE')
})

test('I3 симлинк наружу и внутрь не читается', async () => {
  const { root, outside, ctx } = await layout()
  await symlink(path.join(outside, 'secret.txt'), path.join(root, 'out.link'))
  await symlink(path.join(root, 'note.txt'), path.join(root, 'in.link'))
  const out = await readSandboxedFile(ctx, 'out.link')
  const inn = await readSandboxedFile(ctx, 'in.link')
  expect(out.ok).toBe(false)
  expect(inn.ok).toBe(false)
  if (!out.ok) {
    expect(JSON.stringify(out)).not.toContain('CANARY-OUTSIDE')
  }
})

test.skipIf(process.platform !== 'win32')('I3 junction на диске не читается', async () => {
  const { root, outside, ctx } = await layout()
  await symlink(outside, path.join(root, 'door'), 'junction')
  const got = await readSandboxedFile(ctx, 'door/secret.txt')
  expect(got.ok).toBe(false)
  if (!got.ok) {
    expect(JSON.stringify(got)).not.toContain('CANARY-OUTSIDE')
  }
})

test('I3 TOCTOU: каталог стал симлинком между проверкой и open', async () => {
  const { root, outside, ctx } = await layout()
  const got = await readSandboxedFile(ctx, 'sub/inner.txt', {
    beforeOpen: async () => {
      const live = path.join(root, 'sub')
      const parked = path.join(root, 'sub-parked')
      await rm(parked, { recursive: true, force: true }).catch(() => undefined)
      // Переименовать каталог и поставить на его место ссылку наружу.
      const { rename } = await import('node:fs/promises')
      await rename(live, parked)
      await symlink(outside, live)
    },
  })
  expect(got.ok).toBe(false)
  if (!got.ok) {
    expect(JSON.stringify(got)).not.toContain('CANARY-OUTSIDE')
  }
})

test('I4 denylist по строке и по диску, list и search молчат', async () => {
  const { root, ctx } = await layout()
  await writeFile(path.join(root, '.env'), 'TOKEN=1\n')
  await writeFile(path.join(root, '.env.local'), 'TOKEN=2\n')
  await mkdir(path.join(root, '.git'), { recursive: true })
  await writeFile(path.join(root, '.git', 'config'), '[core]\n')
  await writeFile(path.join(root, 'id_rsa'), 'key\n')
  await writeFile(path.join(root, 'key.pem'), 'pem\n')
  await mkdir(path.join(root, '.aws'), { recursive: true })
  await writeFile(path.join(root, '.aws', 'credentials'), 'aws\n')
  await writeFile(path.join(root, 'terraform.tfstate'), '{}\n')
  await writeFile(path.join(root, 'service-account-x.json'), '{}\n')
  await mkdir(path.join(root, 'node_modules'), { recursive: true })
  await writeFile(path.join(root, 'node_modules', 'x'), 'nm\n')
  await mkdir(path.join(root, 'backups'), { recursive: true })
  await writeFile(path.join(root, 'backups', 'a'), 'b\n')
  await mkdir(path.join(root, 'staging'), { recursive: true })
  await writeFile(path.join(root, 'staging', 'a'), 's\n')
  await writeFile(path.join(root, '.gitignore'), 'dist/\n*.local\n!keep.txt\n**/hidden.txt\n')
  await mkdir(path.join(root, 'dist'), { recursive: true })
  await writeFile(path.join(root, 'dist', 'app.js'), 'js\n')
  await writeFile(path.join(root, 'keep.txt'), 'keep\n')
  await writeFile(path.join(root, 'hidden.txt'), 'hid\n')
  await writeFile(path.join(root, 'plain.txt'), 'plain needle\n')
  ctx.gitignore = compileGitignore(await readFile(path.join(root, '.gitignore'), 'utf8'))
  const denied = [
    '.env',
    '.ENV',
    '.env.local',
    '.env.',
    '.git/config',
    '.Git/HEAD',
    'id_rsa',
    'key.pem',
    '.aws/credentials',
    'terraform.tfstate',
    'service-account-x.json',
    'node_modules/x',
    'backups/a',
    'staging/a',
    'dist/app.js',
    'keep.txt',
    'hidden.txt',
    '.g\u200cit/config',
    '.ſsh/id_rsa',
    '.g\u0131t/HEAD',
  ]
  for (const rel of denied) {
    const got = await resolveToolPath(ctx, rel, 'file')
    expect(got.ok, rel).toBe(false)
  }
  const nfdName = `caf\u0301.txt`
  expect(pathShapeReason(nfdName, 'linux')).toBeNull()
  expect(pathShapeReason(nfdName, 'win32')).toBeNull()
  try {
    await writeFile(path.join(root, nfdName), 'ok\n')
    const nfdFile = await resolveToolPath(ctx, nfdName, 'file')
    if (process.platform !== 'win32') {
      expect(nfdFile.ok).toBe(true)
    }
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error
    }
  }
  const tool: ToolRunContext = {
    sandbox: ctx,
    level: 'read',
    projectId: 'project-1',
    botId: 'bot-1',
    dataDir: ctx.dataReal!,
    dataReal: ctx.dataReal!,
    launcherCwd: root,
    configReal: null,
    respectGitignore: true,
    projectReal: root,
    now: new Date('2026-01-01T00:00:00.000Z'),
  }
  const listed = JSON.parse(await runTool(tool, 'list_dir', JSON.stringify({ path: '' }))) as { entries: Array<{ name: string }> }
  const names = listed.entries.map((item) => item.name)
  expect(names).toContain('plain.txt')
  expect(names).not.toContain('.env')
  expect(names).not.toContain('.git')
  expect(names).not.toContain('id_rsa')
  const found = JSON.parse(await runTool(tool, 'search', JSON.stringify({ query: 'needle' }))) as { matches: Array<{ path: string }> }
  expect(found.matches.map((item) => item.path)).toEqual(['plain.txt'])
})

test('I4 файл data_dir внутри проекта закрыт', async () => {
  const { ctx } = await layout()
  const got = await readSandboxedFile(ctx, 'data-box/state.json')
  expect(got.ok).toBe(false)
})

test('I6 hardlink не читается, бинарный файл отдаёт binary, FIFO не читается', async () => {
  const { root, ctx } = await layout()
  await link(path.join(root, 'note.txt'), path.join(root, 'note-link.txt'))
  const hard = await readSandboxedFile(ctx, 'note-link.txt')
  expect(hard.ok).toBe(false)
  if (process.platform !== 'win32') {
    const stat = await lstat(path.join(root, 'note.txt'))
    expect(stat.nlink).toBeGreaterThan(1)
  }
  const also = await readSandboxedFile(ctx, 'note.txt')
  expect(also.ok).toBe(false)
  await writeFile(path.join(root, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]))
  const tool: ToolRunContext = {
    sandbox: ctx,
    level: 'read',
    projectId: 'project-1',
    botId: 'bot-1',
    dataDir: path.join(root, 'box'),
    dataReal: path.join(root, 'box'),
    launcherCwd: root,
    configReal: null,
    respectGitignore: true,
    projectReal: root,
    now: new Date(),
  }
  await mkdir(tool.dataDir, { recursive: true })
  const binary = JSON.parse(await runTool(tool, 'read_file', JSON.stringify({ path: 'bin.dat' }))) as { binary?: boolean; text?: string }
  expect(binary.binary).toBe(true)
  expect(binary.text).toBeUndefined()
  if (process.platform !== 'win32') {
    execFileSync('mkfifo', [path.join(root, 'pipe.fifo')])
    const fifo = await readSandboxedFile(ctx, 'pipe.fifo')
    expect(fifo.ok).toBe(false)
  }
})
