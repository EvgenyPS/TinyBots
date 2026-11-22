/**
 * FILE: apps/server/src/tools/roots.ts
 * НАЗНАЧЕНИЕ: не открывать инструменты на опасном корне папки проекта.
 * ВХОД: realpath папки, корень лаунчера и realpath data_dir.
 * ВЫХОД: текст ошибки для мастера или null, если корень обычный.
 * Опасно: корень диска или ФС, дом и его предок, каталог лаунчера, предок data_dir.
 */

import { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function sameOrInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function isFsRoot(real: string): boolean {
  const parsed = path.parse(real)
  return real === parsed.root || real === path.parse(parsed.root).root
}

export function dangerousRootReason(projectReal: string, launcherReal: string, dataReal: string): string | null {
  if (isFsRoot(projectReal)) {
    return 'Папка проекта — корень диска. Инструменты на таком корне не включаются.'
  }
  const homes = new Set<string>()
  const home = os.homedir()
  if (home) {
    try {
      homes.add(realpathSync(home))
    } catch {
      homes.add(path.resolve(home))
    }
  }
  for (const item of homes) {
    if (sameOrInside(projectReal, item)) {
      return 'Папка проекта — домашний каталог или его предок. Инструменты на таком корне не включаются.'
    }
  }
  if (projectReal === launcherReal) {
    return 'Папка проекта — каталог лаунчера. Инструменты на таком корне не включаются.'
  }
  if (projectReal !== dataReal && sameOrInside(projectReal, dataReal)) {
    return 'Папка проекта — предок каталога данных. Инструменты на таком корне не включаются.'
  }
  return null
}
