/**
 * FILE: apps/server/src/files/tree.ts
 * НАЗНАЧЕНИЕ: дерево папки проекта и рёбра графа из разметки в markdown.
 * ВХОД: абсолютная папка source.files.path.
 * ВЫХОД: узлы с глубиной и рёбра «файл → файл | подпись».
 * Обход не следует симлинкам и не выходит за realpath корня.
 * Строка графа: `plugin.gd → src/app.txt | вызывает`. Оба конца должны быть в дереве.
 */

import { type Dirent } from 'node:fs'
import { lstat, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { readNoFollow } from '../store/nofollow.js'
import { resolveInside, staysIn } from './jail.js'

export type FileNode = { path: string; name: string; kind: 'dir' | 'file'; depth: number }
export type FileEdge = { from: string; to: string; label: string }

const SKIP = new Set(['.git', 'node_modules', 'backups', 'staging'])
const MAX_NODES = 200
const MAX_DEPTH = 6

async function walk(rootReal: string, dirReal: string, rel: string, depth: number, nodes: FileNode[]): Promise<void> {
  if (nodes.length >= MAX_NODES || depth > MAX_DEPTH) {
    return
  }
  let entries: Dirent<string>[]
  try {
    entries = await readdir(dirReal, { withFileTypes: true, encoding: 'utf8' }) as Dirent<string>[]
  } catch {
    return
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
  for (const entry of entries) {
    if (nodes.length >= MAX_NODES || SKIP.has(entry.name) || entry.isSymbolicLink()) {
      continue
    }
    const childRel = rel.length === 0 ? entry.name : `${rel}/${entry.name}`
    const childPath = path.join(dirReal, entry.name)
    let st: Awaited<ReturnType<typeof lstat>>
    try {
      st = await lstat(childPath)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) {
      continue
    }
    if (st.isDirectory()) {
      let real: string
      try {
        real = await realpath(childPath)
      } catch {
        continue
      }
      if (!staysIn(rootReal, real)) {
        continue
      }
      nodes.push({ path: childRel, name: entry.name, kind: 'dir', depth })
      await walk(rootReal, real, childRel, depth + 1, nodes)
      continue
    }
    if (st.isFile()) {
      nodes.push({ path: childRel, name: entry.name, kind: 'file', depth })
    }
  }
}

export function edgesFromMarkdown(text: string, files: ReadonlySet<string>): FileEdge[] {
  const withoutFence = text.replace(/```[\s\S]*?```/g, '')
  const edges: FileEdge[] = []
  for (const line of withoutFence.split(/\r?\n/)) {
    const match = /^\s*(.+?)\s*→\s*(.+?)\s*(?:\|\s*(.+))?\s*$/.exec(line)
    if (!match) {
      continue
    }
    const from = (match[1] ?? '').trim().replace(/^`|`$/g, '')
    const to = (match[2] ?? '').trim().replace(/^`|`$/g, '')
    const label = (match[3] ?? 'отвечает за').trim()
    if (!files.has(from) || !files.has(to) || label.length === 0 || label.length > 80) {
      continue
    }
    edges.push({ from, to, label })
    if (edges.length >= 40) {
      break
    }
  }
  return edges
}

export async function readTree(rootReal: string): Promise<{ nodes: FileNode[]; edges: FileEdge[] }> {
  const nodes: FileNode[] = []
  await walk(rootReal, rootReal, '', 0, nodes)
  const files = new Set(nodes.filter((node) => node.kind === 'file').map((node) => node.path))
  const edges: FileEdge[] = []
  for (const node of nodes) {
    if (node.kind !== 'file' || !node.name.endsWith('.md')) {
      continue
    }
    const abs = await resolveInside(rootReal, node.path)
    if (!abs) {
      continue
    }
    let text = ''
    try {
      const st = await lstat(abs)
      if (st.isSymbolicLink() || !st.isFile() || st.size > 65_536) {
        continue
      }
      text = (await readNoFollow(abs)).toString('utf8')
    } catch {
      continue
    }
    edges.push(...edgesFromMarkdown(text, files))
  }
  return { nodes, edges }
}

export function rootLabel(configured: string): string {
  const normalized = configured.replace(/\\/g, '/').replace(/\/+$/, '')
  const base = path.posix.basename(normalized)
  return base.length > 0 ? base : 'файлы'
}
