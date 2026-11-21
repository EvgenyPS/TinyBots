/**
 * FILE: apps/server/src/tools/sandbox.test.ts
 * НАЗНАЧЕНИЕ: I3, I4 и I6. Таблица атак на песочницу и список имён.
 * ВХОД: временный каталог. Цель вне корня лежит рядом и не должна попасть в ответ.
 * ВЫХОД: каждый отказ — ok: false, байты цели не возвращаются.
 */

import { execFileSync } from 'node:child_process'
import { link, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { compileGitignore } from './gitignore.js'
import { pathShapeReason, readSandboxedFile, resolveToolPath, spelledName, type SandboxContext } from './sandbox.js'
import { runTool, type ToolRunContext } from './call.js'

const roots: string[] = []

afterEach(async () => {
  // Два пути одного каталога (mkdtemp и realpath) и параллельный rm на Windows дают EPERM.
  const dirs = [...new Set(roots.splice(0))]
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

async function layout(): Promise<{ root: string; outside: string; ctx: SandboxContext }> {
  const made = await mkdtemp(path.join(tmpdir(), 'tinybots-sb-'))
  // realpath: на Windows mkdtemp и realpath файла расходятся (8.3), staysIn тогда говорит «вне».
  const root = await realpath(made)
  roots.push(made, root)
  const outsideMade = path.join(root, '..', `outside-${path.basename(root)}`)
  await mkdir(outsideMade, { recursive: true })
  const outside = await realpath(outsideMade)
  roots.push(outsideMade, outside)
  await writeFile(path.join(outside, 'secret.txt'), 'CANARY-OUTSIDE')
  await writeFile(path.join(root, 'note.txt'), 'hello\n')
  await mkdir(path.join(root, 'sub'), { recursive: true })
  await writeFile(path.join(root, 'sub', 'inner.txt'), 'inner\n')
  const dataMade = path.join(root, 'data-box')
  await mkdir(dataMade, { recursive: true })
  const dataReal = await realpath(dataMade)
  const ctx: SandboxContext = {
    rootReal: root,
    dataReal,
    launcherConfigReal: null,
    respectGitignore: true,
    gitignore: [],
  }
  await writeFile(path.join(dataReal, 'state.json'), 'secret-data')
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
  // Короткое имя с ~ и цифрой закрыто на любой ОС, не только на Windows.
  expect(pathShapeReason('ENV~1', 'linux')).not.toBeNull()
  expect(pathShapeReason('GIT~1', 'linux')).not.toBeNull()
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
    expect(out.reason).toBe('ссылка')
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

test('I3 TOCTOU: каталог стал симлинком на тот же файл', async () => {
  const { root, ctx } = await layout()
  // Файл тот же: nlink остаётся 1, inode не меняется. Ловит только повторный обход сегментов.
  const got = await readSandboxedFile(ctx, 'sub/inner.txt', {
    beforeOpen: async () => {
      const live = path.join(root, 'sub')
      const parked = path.join(root, 'sub-real')
      const { rename } = await import('node:fs/promises')
      await rename(live, parked)
      await symlink(parked, live)
    },
  })
  expect(got.ok).toBe(false)
  if (!got.ok) {
    expect(got.reason).toBe('подмена')
  }
})

test('двойная подмена файла до чтения', async () => {
  const { root, ctx } = await layout()
  const got = await readSandboxedFile(ctx, 'note.txt', {
    beforeOpen: async () => {
      const { rename } = await import('node:fs/promises')
      await rename(path.join(root, 'note.txt'), path.join(root, 'note-a.txt'))
      await writeFile(path.join(root, 'note.txt'), 'CANARY-A')
      await rename(path.join(root, 'note.txt'), path.join(root, 'note-b.txt'))
      await writeFile(path.join(root, 'note.txt'), 'CANARY-B')
    },
  })
  expect(got.ok).toBe(false)
  const packed = JSON.stringify(got)
  expect(packed).not.toContain('CANARY-A')
  expect(packed).not.toContain('CANARY-B')
})

test('I3 TOCTOU: файл заменили другим до чтения', async () => {
  const { root, ctx } = await layout()
  const got = await readSandboxedFile(ctx, 'note.txt', {
    beforeOpen: async () => {
      const { rename } = await import('node:fs/promises')
      await rename(path.join(root, 'note.txt'), path.join(root, 'note-parked.txt'))
      await writeFile(path.join(root, 'note.txt'), 'CANARY-SWAP')
    },
  })
  expect(got.ok).toBe(false)
  expect(JSON.stringify(got)).not.toContain('CANARY-SWAP')
})

test('ino 0 не подставляет чужое имя', () => {
  const name = spelledName('note.txt', { dev: 1n, ino: 0n }, [{ name: '.env', dev: 1n, ino: 0n }], 'linux')
  expect(name).toBe('note.txt')
})

test('жёсткая ссылка на файл вне проекта', async () => {
  const { root, outside, ctx } = await layout()
  const alias = path.join(root, 'alias.txt')
  await link(path.join(outside, 'secret.txt'), alias)
  const st = await lstat(alias, { bigint: true })
  const handle = await open(alias, 'r')
  let fstNlink = 0n
  try {
    fstNlink = (await handle.stat({ bigint: true })).nlink
  } finally {
    await handle.close()
  }
  const got = await readSandboxedFile(ctx, 'alias.txt')
  if (st.nlink > 1n || fstNlink > 1n) {
    expect(got.ok).toBe(false)
    expect(JSON.stringify(got)).not.toContain('CANARY-OUTSIDE')
    return
  }
  // Windows: и lstat, и fstat с bigint видят nlink 1. Обход дерева не возвращаем.
  expect(process.platform).toBe('win32')
  expect(st.nlink).toBe(1n)
  expect(fstNlink).toBe(1n)
})

test('ссылка после первой проверки не читается', async () => {
  const { root, ctx } = await layout()
  const got = await readSandboxedFile(ctx, 'note.txt', {
    beforeOpen: async () => {
      await link(path.join(root, 'note.txt'), path.join(root, 'extra-link.txt'))
    },
  })
  const st = await lstat(path.join(root, 'note.txt'), { bigint: true })
  if (st.nlink > 1n) {
    expect(got.ok).toBe(false)
    expect(JSON.stringify(got)).not.toContain('hello')
    return
  }
  expect(process.platform).toBe('win32')
  expect(st.nlink).toBe(1n)
})

test('I6 hardlink в другом каталоге не читается', async () => {
  const { root, ctx } = await layout()
  await mkdir(path.join(root, 'other'))
  await link(path.join(root, 'note.txt'), path.join(root, 'other', 'alias.txt'))
  const got = await readSandboxedFile(ctx, 'note.txt')
  expect(got.ok).toBe(false)
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

test('поиск обрывается сигналом и не дочитывает каталог', async () => {
  const { root, ctx } = await layout()
  await writeFile(path.join(root, 'a.txt'), 'needle\n')
  await writeFile(path.join(root, 'b.txt'), 'needle\n')
  await writeFile(path.join(root, 'c.txt'), 'needle\n')
  const ac = new AbortController()
  let opened = 0
  const tool: ToolRunContext = {
    sandbox: ctx,
    level: 'read',
    projectId: 'project-1',
    botId: 'bot-1',
    dataDir: ctx.dataReal ?? root,
    dataReal: ctx.dataReal ?? root,
    launcherCwd: root,
    configReal: null,
    respectGitignore: true,
    projectReal: root,
    now: new Date(),
    hooks: {
      beforeOpen: () => {
        opened += 1
        ac.abort()
      },
    },
  }
  await expect(runTool(tool, 'search', JSON.stringify({ query: 'needle' }), undefined, ac.signal)).rejects.toThrow('tool_timeout')
  expect(opened).toBe(1)
})

test('propose_patch обрывается сигналом и не пишет предложение', async () => {
  const { root, ctx } = await layout()
  const ac = new AbortController()
  let opened = 0
  const tool: ToolRunContext = {
    sandbox: ctx,
    level: 'propose',
    projectId: 'project-1',
    botId: 'bot-1',
    dataDir: ctx.dataReal ?? root,
    dataReal: ctx.dataReal ?? root,
    launcherCwd: root,
    configReal: null,
    respectGitignore: true,
    projectReal: root,
    now: new Date(),
    applyMode: 'files',
    hooks: {
      beforeOpen: () => {
        opened += 1
        ac.abort()
      },
    },
  }
  const diff = '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-hello\n+bye\n'
  await expect(runTool(tool, 'propose_patch', JSON.stringify({ summary: 'правка', diff }), undefined, ac.signal)).rejects.toThrow('tool_timeout')
  expect(opened).toBe(1)
})

test('list_dir с оборванным сигналом не отдаёт список', async () => {
  const { root, ctx } = await layout()
  const ac = new AbortController()
  ac.abort()
  const tool: ToolRunContext = {
    sandbox: ctx,
    level: 'read',
    projectId: 'project-1',
    botId: 'bot-1',
    dataDir: ctx.dataReal ?? root,
    dataReal: ctx.dataReal ?? root,
    launcherCwd: root,
    configReal: null,
    respectGitignore: true,
    projectReal: root,
    now: new Date(),
  }
  await expect(runTool(tool, 'list_dir', JSON.stringify({ path: '' }), undefined, ac.signal)).rejects.toThrow('tool_timeout')
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
