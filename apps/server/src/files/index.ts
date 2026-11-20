/**
 * FILE: apps/server/src/files/index.ts
 * НАЗНАЧЕНИЕ: HTTP дерева файлов и текста документации.
 * ВХОД: конфиг проекта и относительный путь внутри source.files.path.
 * ВЫХОД: узлы дерева, рёбра графа или markdown. Абсолютный путь наружу не отдаём.
 * Запрос вне папки, с .., UNC или через симлинк — 404 без содержимого.
 */

import path from 'node:path'
import { lstat, realpath } from 'node:fs/promises'
import type { ConfigFailure } from '../config/load.js'
import { loadConfigAt, selectConfigRequest } from '../config/load.js'
import { readNoFollow } from '../store/nofollow.js'
import { requestAllowed, resolveInside } from './jail.js'
import { readTree, rootLabel, type FileEdge, type FileNode } from './tree.js'

export type FilesBody = {
  ok: true
  root_label: string
  nodes: FileNode[]
  edges: FileEdge[]
}

export type DocBody = {
  ok: true
  path: string
  markdown: string
}

type Miss = { ok: false; error: 'not_found' | 'too_large' | 'project' }

function projectDir(configDirectory: string, raw: string): string {
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(configDirectory, raw)
}

async function openRoot(root: string, configPath: string | undefined, projectId: string): Promise<
  | { ok: false; status: 422; body: ConfigFailure }
  | { ok: false; status: 404; body: Miss }
  | { ok: true; rootReal: string; label: string }
> {
  const loaded = loadConfigAt(root, selectConfigRequest(root, configPath))
  if (!loaded.ok) {
    return { ok: false, status: 422, body: loaded }
  }
  const project = loaded.config.projects.find((item) => item.id === projectId)
  const raw = project?.source.files?.path
  if (!project || !raw) {
    return { ok: false, status: 404, body: { ok: false, error: 'project' } }
  }
  const abs = projectDir(loaded.directory, raw)
  // Корень — это realpath настроенной папки. Симлинк внутри неё наружу не пускаем.
  let rootReal: string
  try {
    rootReal = await realpath(abs)
    const st = await lstat(rootReal)
    if (!st.isDirectory()) {
      return { ok: false, status: 404, body: { ok: false, error: 'not_found' } }
    }
  } catch {
    return { ok: false, status: 404, body: { ok: false, error: 'not_found' } }
  }
  return { ok: true, rootReal, label: rootLabel(raw) }
}

export async function readProjectTree(
  root: string,
  configPath: string | undefined,
  projectId: string,
): Promise<{ status: 200 | 404 | 422; body: FilesBody | Miss | ConfigFailure }> {
  const opened = await openRoot(root, configPath, projectId)
  if (!opened.ok) {
    return opened
  }
  const tree = await readTree(opened.rootReal)
  return {
    status: 200,
    body: { ok: true, root_label: opened.label, nodes: tree.nodes, edges: tree.edges },
  }
}

export async function readProjectDoc(
  root: string,
  configPath: string | undefined,
  projectId: string,
  rel: string,
): Promise<{ status: 200 | 404 | 422; body: DocBody | Miss | ConfigFailure }> {
  if (!requestAllowed(rel) || !rel.endsWith('.md')) {
    return { status: 404, body: { ok: false, error: 'not_found' } }
  }
  const opened = await openRoot(root, configPath, projectId)
  if (!opened.ok) {
    return opened
  }
  const abs = await resolveInside(opened.rootReal, rel)
  if (!abs) {
    return { status: 404, body: { ok: false, error: 'not_found' } }
  }
  try {
    const st = await lstat(abs)
    if (st.isSymbolicLink() || !st.isFile()) {
      return { status: 404, body: { ok: false, error: 'not_found' } }
    }
    if (st.size > 65_536) {
      return { status: 404, body: { ok: false, error: 'too_large' } }
    }
    const markdown = (await readNoFollow(abs)).toString('utf8')
    return { status: 200, body: { ok: true, path: rel, markdown } }
  } catch {
    return { status: 404, body: { ok: false, error: 'not_found' } }
  }
}
