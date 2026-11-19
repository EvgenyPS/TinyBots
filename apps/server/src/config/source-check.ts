/**
 * FILE: apps/server/src/config/source-check.ts
 * НАЗНАЧЕНИЕ: проверить папку проекта перед записью конфига.
 * ВХОД: корень, явный путь конфига и относительный путь источника.
 * ВЫХОД: есть ли у этой папки свой git. Если нет — та же фраза, что увидит человек.
 * Свой git — это .git именно в папке и rev-parse, чей корень совпал с ней.
 * Родительский репозиторий лаунчера не считается: GIT_DIR окружения снимаем.
 */

import { execFile } from 'node:child_process'
import { existsSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { isContainedPath } from '@tinybots/schema'
import { staysInRoot } from './confine.js'
import { resolveSetupTarget } from './setup-target.js'

/** Дословно критерий B18. Экран показывает эту строку, тест ищет её целиком. */
export const GIT_HIDDEN_WARNING = 'вкладка Git будет скрыта'

export type SourceReport =
  | { ok: true; path: string; git: boolean; warning: string | null }
  | { ok: false; path: string; reason: string }

export type SourceLook = {
  exists: boolean
  directory: boolean
  ownRepo: boolean
}

/** Чистая развилка без диска: так тест покрывает все три исхода, не готовя папки. */
export function judgeSource(look: SourceLook): SourceReport {
  if (!look.exists) {
    return { ok: false, path: '', reason: 'путь не найден' }
  }
  if (!look.directory) {
    return { ok: false, path: '', reason: 'нужна папка, не файл' }
  }
  if (!look.ownRepo) {
    return { ok: true, path: '', git: false, warning: GIT_HIDDEN_WARNING }
  }
  return { ok: true, path: '', git: true, warning: null }
}

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  // Иначе git ответит про репозиторий процесса, а не про папку, которую указал человек.
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  delete env.GIT_PREFIX
  return env
}

function gitTop(dir: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', dir, 'rev-parse', '--show-toplevel'],
      { timeout: 4000, windowsHide: true, encoding: 'utf8', env: gitEnv() },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        const text = String(stdout).trim()
        resolve(text.length > 0 ? text : null)
      },
    )
  })
}

function samePlace(left: string, right: string): boolean {
  const a = path.resolve(left)
  const b = path.resolve(right)
  if (process.platform === 'win32') {
    return a.toLowerCase() === b.toLowerCase()
  }
  return a === b
}

async function ownRepo(dir: string): Promise<boolean> {
  if (!existsSync(path.join(dir, '.git'))) {
    return false
  }
  const top = await gitTop(dir)
  if (top === null) {
    return false
  }
  let realDir: string
  let realTop: string
  try {
    realDir = realpathSync(dir)
    realTop = realpathSync(top)
  } catch {
    return false
  }
  return samePlace(realDir, realTop)
}

export async function inspectSource(root: string, explicit: string | undefined, requestPath: string): Promise<SourceReport> {
  const raw = requestPath.trim()
  if (raw.length === 0 || raw.length > 300 || !isContainedPath(raw)) {
    return { ok: false, path: '', reason: 'только относительный путь' }
  }
  const target = resolveSetupTarget(root, explicit)
  if (!target.ok) {
    return { ok: false, path: '', reason: target.reason }
  }
  // Путь в конфиге живёт относительно папки самого файла, как data_dir.
  const absolute = path.resolve(path.dirname(target.absolute), raw)
  if (!staysInRoot(root, absolute)) {
    return { ok: false, path: raw, reason: 'путь выходит за корень репозитория' }
  }
  if (!existsSync(absolute)) {
    return { ok: false, path: raw, reason: 'путь не найден' }
  }
  let directory = false
  try {
    directory = statSync(absolute).isDirectory()
  } catch {
    return { ok: false, path: raw, reason: 'путь недоступен' }
  }
  const judged = judgeSource({
    exists: true,
    directory,
    ownRepo: directory ? await ownRepo(absolute) : false,
  })
  if (!judged.ok) {
    return { ok: false, path: raw, reason: judged.reason }
  }
  return { ok: true, path: raw, git: judged.git, warning: judged.warning }
}
