/**
 * FILE: apps/web/src/ui/files-panel.tsx
 * НАЗНАЧЕНИЕ: дерево файлов и граф связей.
 * ВХОД: id проекта, GET /api/files.
 * ВЫХОД: каждый узел на своей строке, отступ от глубины. Ребро подписано.
 * Выбранный узел подсвечен. Ошибка — текст и «Повторить», без падения страницы.
 */

import { useEffect, useState } from 'react'

type Node = { path: string; name: string; kind: 'dir' | 'file'; depth: number }
type Edge = { from: string; to: string; label: string }
type Tree = { ok: true; root_label: string; nodes: Node[]; edges: Edge[] }

function isTree(value: unknown): value is Tree {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as { ok?: unknown; nodes?: unknown; edges?: unknown }
  return row.ok === true && Array.isArray(row.nodes) && Array.isArray(row.edges)
}

export function FilesPanel(props: { projectId: string }) {
  const [tree, setTree] = useState<Tree | null>(null)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setTree(null)
    setError(false)
    fetch(`/api/files?project=${encodeURIComponent(props.projectId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body: unknown = await res.json()
        if (cancelled) {
          return
        }
        if (!res.ok || !isTree(body)) {
          setError(true)
          return
        }
        setTree(body)
        setSelected((current) => current && body.nodes.some((node) => node.path === current) ? current : body.nodes[0]?.path ?? null)
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [props.projectId, tick])

  if (error) {
    return (
      <section data-testid="files-panel">
        <p>Дерево файлов не открылось.</p>
        <button type="button" className="btn" onClick={() => setTick((n) => n + 1)}>Повторить</button>
      </section>
    )
  }
  if (!tree) {
    return <section data-testid="files-panel">Загрузка файлов</section>
  }
  const names = new Map<string, { x: number; y: number }>()
  tree.edges.forEach((edge) => {
    if (!names.has(edge.from)) {
      names.set(edge.from, { x: 70, y: 28 + names.size * 48 })
    }
    if (!names.has(edge.to)) {
      names.set(edge.to, { x: 280, y: 28 + names.size * 48 })
    }
  })
  return (
    <section data-testid="files-panel">
      <h2>Файлы и связи</h2>
      <p className="sub">Корень {tree.root_label}. Узел показывает файл, подпись ребра — за что он отвечает.</p>
      <div className="files-split">
        <div className="card tree" data-testid="file-tree">
          {tree.nodes.map((node) => (
            <button
              key={node.path}
              type="button"
              className={node.path === selected ? 'tree-row on' : 'tree-row'}
              style={{ paddingLeft: 12 + node.depth * 16 }}
              data-testid={`tree-${node.path}`}
              data-depth={node.depth}
              aria-current={node.path === selected ? 'true' : undefined}
              onClick={() => setSelected(node.path)}
            >
              {node.kind === 'dir' ? '▾ ' : ''}{node.name}
            </button>
          ))}
          {tree.nodes.length === 0 ? <p className="sub">В папке нет файлов.</p> : null}
        </div>
        <div className="card graph-card" data-testid="file-graph">
          <svg viewBox="0 0 420 220" width="100%" height="220" role="img" aria-label="Граф файлов">
            {tree.edges.map((edge) => {
              const from = names.get(edge.from)
              const to = names.get(edge.to)
              if (!from || !to) {
                return null
              }
              const x = (from.x + to.x) / 2
              const y = (from.y + to.y) / 2
              return (
                <g key={`${edge.from}-${edge.to}-${edge.label}`}>
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="rgba(180,160,255,.45)" />
                  <text className="edge-label" data-testid="edge-label" x={x} y={y - 6} textAnchor="middle">{edge.label}</text>
                </g>
              )
            })}
            {[...names.entries()].map(([filePath, pos]) => (
              <g key={filePath} className={filePath === selected ? 'graph-node on' : 'graph-node'}>
                <rect x={pos.x - 64} y={pos.y - 14} width="128" height="28" rx="8" />
                <text x={pos.x} y={pos.y + 4} textAnchor="middle">{filePath.split('/').at(-1)}</text>
              </g>
            ))}
          </svg>
          {selected ? <p data-testid="file-selected">{selected}</p> : null}
        </div>
      </div>
    </section>
  )
}
