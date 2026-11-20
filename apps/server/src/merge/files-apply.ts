/**
 * FILE: apps/server/src/merge/files-apply.ts
 * НАЗНАЧЕНИЕ: мерж и откат в режиме files.
 * ВХОД: папка проекта, id запроса и относительные пути.
 * ВЫХОД: снимок backups/<mr-id>/ до замены. Откат копирует снимок обратно байт в байт.
 * staging/ — откуда берём новое. Выход за папку проекта ( .. , абсолютный путь) — отказ.
 */

import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

export async function sha256Of(file: string): Promise<string> {
  const data = await readFile(file)
  return createHash('sha256').update(data).digest('hex')
}

function inside(root: string, rel: string): string | null {
  if (rel.length === 0 || rel.includes('\0') || rel.includes('\\') || path.isAbsolute(rel)) {
    return null
  }
  const parts = rel.split('/')
  if (parts.some((part) => part.length === 0 || part === '..')) {
    return null
  }
  const absolute = path.resolve(root, rel)
  const back = path.relative(root, absolute)
  if (back.startsWith('..') || path.isAbsolute(back)) {
    return null
  }
  return absolute
}

export async function acceptProjectFiles(input: {
  projectDir: string
  mrId: string
  files: readonly string[]
}): Promise<{ backupDir: string }> {
  if (!SLUG.test(input.mrId)) {
    throw new Error('id снимка')
  }
  const backupDir = path.join(input.projectDir, 'backups', input.mrId)
  for (const rel of input.files) {
    const live = inside(input.projectDir, rel)
    const staging = inside(input.projectDir, `staging/${rel}`)
    const backup = inside(input.projectDir, `backups/${input.mrId}/${rel}`)
    if (!live || !staging || !backup) {
      throw new Error('путь файла')
    }
    if (!existsSync(staging)) {
      throw new Error('нет файла в staging')
    }
    await mkdir(path.dirname(backup), { recursive: true })
    // Первый снимок не затираем: повторный перенос не должен подменить исходные байты.
    if (!existsSync(backup) && existsSync(live)) {
      await copyFile(live, backup)
    }
    await mkdir(path.dirname(live), { recursive: true })
    await copyFile(staging, live)
  }
  return { backupDir }
}

export async function restoreProjectFiles(input: {
  projectDir: string
  mrId: string
  files: readonly string[]
}): Promise<void> {
  if (!SLUG.test(input.mrId)) {
    throw new Error('id снимка')
  }
  for (const rel of input.files) {
    const live = inside(input.projectDir, rel)
    const backup = inside(input.projectDir, `backups/${input.mrId}/${rel}`)
    if (!live || !backup || !existsSync(backup)) {
      throw new Error('нет снимка')
    }
    await mkdir(path.dirname(live), { recursive: true })
    await copyFile(backup, live)
  }
}
