/**
 * FILE: apps/server/src/config/source-check.ts
 * НАЗНАЧЕНИЕ: проверить папку проекта перед записью конфига.
 * ВХОД: корень, явный путь конфига и путь источника. Папка может быть где угодно,
 * в том числе вне папки лаунчера: абсолютный путь и выход наверх здесь допустимы.
 * ВЫХОД: есть ли у этой папки свой git. Если нет — та же фраза, что увидит человек.
 * Свой git — это .git именно в папке и пустой --show-prefix: папка сама корень.
 * Абсолютные пути не сравниваем между собой для git: на Windows короткий путь (RUNNER~1)
 * и длинный (runneradmin) расходятся, и живой репозиторий выглядел бы как «git нет».
 * Родительский репозиторий лаунчера не считается: GIT_DIR окружения снимаем.
 */

import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { isProjectFolderPath } from '@tinybots/schema'
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

function gitPrefix(dir: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      // Только этот вызов. Звёздочка не пишет конфиг: на раннере Windows владелец
      // временной папки и процесс git иногда расходятся, и rev-parse молчит.
      ['-c', 'safe.directory=*', '-C', dir, 'rev-parse', '--show-prefix'],
      { timeout: 4000, windowsHide: true, encoding: 'utf8', env: gitEnv() },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        resolve(String(stdout).replace(/\r/g, '').trim())
      },
    )
  })
}

function prefixIsRoot(prefix: string): boolean {
  return prefix === '' || prefix === '.' || prefix === './'
}

async function ownRepo(dir: string): Promise<boolean> {
  if (!existsSync(path.join(dir, '.git'))) {
    return false
  }
  const prefix = await gitPrefix(dir)
  // Пустой префикс — корень этой папки. Непустой — мы внутри чужого репозитория.
  return prefix !== null && prefixIsRoot(prefix)
}

export async function inspectSource(root: string, explicit: string | undefined, requestPath: string): Promise<SourceReport> {
  const raw = requestPath.trim()
  if (!isProjectFolderPath(raw)) {
    return { ok: false, path: '', reason: 'путь к папке проекта' }
  }
  const target = resolveSetupTarget(root, explicit)
  if (!target.ok) {
    return { ok: false, path: '', reason: target.reason }
  }
  // Относительный путь считаем от папки конфига. Абсолютный оставляем как есть:
  // проект владельца не обязан лежать внутри лаунчера.
  const absolute = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(path.dirname(target.absolute), raw)
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
